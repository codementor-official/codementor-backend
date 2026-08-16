"""Runs student code in ephemeral, locked-down Docker containers (Docker-out-of-Docker).

Replaces judge0_client on this branch: the host's Docker daemon uses cgroup v2
directly (no `isolate`), so it doesn't hit the cgroup v1/v2 incompatibility
that broke Judge0 on this host. We trade isolate's kernel-level sandboxing for
Docker's own isolation (network=none, non-root user, dropped capabilities,
pids/memory/cpu limits, read-only root fs) — good enough for a classroom
judge, not for hostile multi-tenant production use.
"""

import shutil
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from docker.models.containers import Container

import docker
from app.config import settings
from app.services.execution_config import LANGUAGE_CONFIG
from app.services.judgement import JudgeCase, determine_verdict

# docker-py's default max_pool_size=10 -- verified empirically that it's an
# actual ceiling, not just a perf knob: at concurrency=20 the shared client
# started raising raw urllib3 "queue.Full" / AttributeError instead of a
# clean error, because each in-flight run holds a connection for wait() *and*
# the resource sampler thread (_sample_peak_resources) holds another for
# concurrent stats() polling -- two connections per submission. Sized with
# headroom above 2x the highest concurrency this has actually been tested at
# (50 -> 100 connections needed), not just 2x the semaphore default.
_client = docker.from_env(max_pool_size=128)

# Bounds how many containers run at once across all requests on this host.
# THIS, not CPU or RAM, was the actual cause of the "breaking point at
# concurrency=10" result in earlier benchmarking -- verified by rerunning the
# identical workload with the semaphore raised to match concurrency: P95 went
# from 20.9s to 5.1s (concurrency=10) and held up cleanly through
# concurrency=50 (P95=10.0s) once docker-py's connection pool was also fixed
# (see max_pool_size above). The value here is a deliberately safe default
# for small/shared hosts, not evidence of a Docker daemon/orchestration
# ceiling -- tune app.config.settings.docker_execution_concurrency to actual
# host capacity (see tests/execution_engine/README.md).
execution_semaphore = threading.Semaphore(settings.docker_execution_concurrency)

MAX_OUTPUT_BYTES = 64_000
COMPILE_TIMEOUT_SEC = 10

_COMMON_RUN_KWARGS = {
    "network_disabled": True,
    "network_mode": "none",
    "user": "1000:1000",
    "cap_drop": ["ALL"],
    "security_opt": ["no-new-privileges"],
    "read_only": True,
    # 256m, not 64m: Go's build cache needs ~67MB for anything importing
    # net/http (crypto/tls's dependency tree) since every submission cold-
    # compiles the whole subgraph -- no cache persists between ephemeral
    # containers. Verified empirically ("no space left on device" at 64m).
    # tmpfs is sparse (only real bytes written cost RAM), so this costs
    # nothing for languages that don't need it.
    "tmpfs": {"/tmp": "rw,size=256m,mode=1777"},
    "detach": True,
}


class ExecutionError(RuntimeError):
    """Raised for Docker-daemon-level failures (image missing, daemon unreachable)."""


@dataclass
class RunOutcome:
    exit_code: int | None
    stdout: str
    stderr: str
    timed_out: bool
    time_ms: float
    peak_memory_mb: float | None
    peak_cpu_percent: float | None
    # Docker's OOM killer sends SIGKILL, which surfaces as exit code 137 — but so does any
    # other SIGKILL, so the exit code alone cannot tell "used too much memory" apart from
    # "was killed". The daemon records the real answer on the container.
    oom_killed: bool = False


@dataclass
class TestResult:
    order: int
    verdict: str
    stdout: str
    expected: str
    stderr: str
    compile_output: str
    time_ms: float | None
    peak_memory_mb: float | None = None
    peak_cpu_percent: float | None = None


def _truncate(data: bytes) -> str:
    return data[:MAX_OUTPUT_BYTES].decode("utf-8", errors="replace")


RESOURCE_POLL_INTERVAL_SEC = 0.02  # 20ms: containers here often live <300ms


def _sample_peak_resources(container: Container, stop_event: threading.Event) -> dict:
    """Poll `docker stats` in a tight loop for as long as the container lives.

    `docker run` doesn't return resource usage after exit (unlike Judge0, which
    gets it for free from isolate/cgroup accounting), and cgroup's own peak
    files (memory.peak) get reaped by systemd within milliseconds of the
    process exiting -- reading them after container.wait() returns is already
    too late (verified empirically: the cgroup directory is gone by then).

    KNOWN LIMITATION, verified empirically, not a bug to keep chasing:
    `container.stats(stream=False)` itself has ~1-2s of latency *inside
    dockerd* before it returns real numbers (consecutive calls land ~2s apart
    no matter how tight the polling loop is). Our AC/WA/RE/CE containers
    typically finish in 200-700ms -- they're gone before the first stats()
    call even returns, so peak_memory_mb/peak_cpu_percent are None for most
    submissions. Only long-running ones (TLE, or a deliberately slow
    submission) live long enough to get a real sample. This is a genuine
    edge Judge0 doesn't have: isolate reads cgroup accounting synchronously
    right after the process exits, no polling race at all.
    """
    peak_mem_mb = 0.0
    peak_cpu_percent = 0.0
    while not stop_event.is_set():
        try:
            stats = container.stats(stream=False)
        except Exception:
            # container.stats() can raise DockerException, or a JSONDecodeError
            # from requests when the daemon returns an empty body -- this
            # happens transiently right after container creation too (not
            # just on exit), so skip this sample rather than aborting the
            # whole loop; stop_event (set right after wait() returns) is
            # what actually bounds this.
            time.sleep(RESOURCE_POLL_INTERVAL_SEC)
            continue

        mem_usage = (stats.get("memory_stats") or {}).get("usage")
        if mem_usage:
            peak_mem_mb = max(peak_mem_mb, mem_usage / (1024 * 1024))

        cpu_stats = stats.get("cpu_stats") or {}
        precpu_stats = stats.get("precpu_stats") or {}
        cpu_usage = (cpu_stats.get("cpu_usage") or {}).get("total_usage")
        precpu_usage = (precpu_stats.get("cpu_usage") or {}).get("total_usage")
        system_usage = cpu_stats.get("system_cpu_usage")
        presystem_usage = precpu_stats.get("system_cpu_usage")
        if (cpu_usage is not None and precpu_usage is not None
                and system_usage and presystem_usage):
            cpu_delta = cpu_usage - precpu_usage
            system_delta = system_usage - presystem_usage
            if system_delta > 0 and cpu_delta >= 0:
                num_cpus = cpu_stats.get("online_cpus") or 1
                sample = (cpu_delta / system_delta) * num_cpus * 100
                peak_cpu_percent = max(peak_cpu_percent, sample)

        time.sleep(RESOURCE_POLL_INTERVAL_SEC)

    return {
        "peak_memory_mb": round(peak_mem_mb, 2) if peak_mem_mb else None,
        "peak_cpu_percent": round(peak_cpu_percent, 2) if peak_cpu_percent else None,
    }


def _remove_container(container: Container | None) -> None:
    """Best-effort cleanup, retried once. Catches Exception broadly, not just
    DockerException: verified empirically that container.remove()/.kill() can
    raise raw urllib3/requests errors (connection pool pressure at high
    concurrency) that aren't DockerException subclasses -- catching only
    DockerException here left containers running indefinitely, undetected,
    because the caller's finally block completed "successfully" from
    Python's perspective while the actual removal silently failed."""
    if container is None:
        return
    for attempt in range(2):
        try:
            container.remove(force=True)
            return
        except Exception:
            if attempt == 0:
                time.sleep(0.1)


def _safe_kill(container: Container | None) -> None:
    if container is None:
        return
    try:
        container.kill()
    except Exception:
        pass


def compile_step(language: str, workdir: str) -> str | None:
    """Compile source already written into workdir. Returns the compiler's
    diagnostic output on failure, or None if compilation succeeded (or the
    language needs none)."""
    config = LANGUAGE_CONFIG[language]
    if not config["compile_cmd"]:
        return None

    container: Container | None = None
    try:
        container = _client.containers.run(
            image=config["image"],
            command=config["compile_cmd"],
            volumes={workdir: {"bind": "/home/runner", "mode": "rw"}},
            working_dir="/home/runner",
            mem_limit="256m",
            **_COMMON_RUN_KWARGS,
        )
        try:
            result = container.wait(timeout=COMPILE_TIMEOUT_SEC)
            exit_code = result["StatusCode"]
        except Exception:
            _safe_kill(container)
            return "compilation timed out"

        if exit_code != 0:
            # Compilers don't agree on which stream diagnostics go to --
            # gcc/g++/javac use stderr, tsc writes everything to stdout and
            # leaves stderr empty (verified directly). Capture both rather
            # than assuming stderr always has the useful text.
            stdout = _truncate(container.logs(stdout=True, stderr=False))
            stderr = _truncate(container.logs(stdout=False, stderr=True))
            output = "\n".join(part for part in (stdout, stderr) if part)
            return output or f"compilation failed with exit code {exit_code}"
        return None
    except Exception as exc:
        # Not just DockerException: containers.run() itself can raise raw
        # urllib3/requests errors under connection-pool pressure at high
        # concurrency. Surface all of it as a clean ExecutionError (-> 502)
        # instead of a raw stack trace reaching the caller.
        raise ExecutionError(f"docker error during compile: {exc}") from exc
    finally:
        _remove_container(container)


def _was_oom_killed(container: Container) -> bool:
    """Ask the daemon whether this container died to the OOM killer.

    Only reliable *after* wait() returns and before removal — reload() re-reads the
    container's state from the daemon, which still has it until we remove it. Any failure
    here means "we do not know", and not knowing must not be reported as a memory verdict.
    """
    try:
        container.reload()
        return bool(container.attrs.get("State", {}).get("OOMKilled"))
    except Exception:
        return False


def _run_once(
    language: str,
    workdir: str,
    stdin: str,
    time_limit_sec: int,
    memory_limit_mb: int,
) -> RunOutcome:
    config = LANGUAGE_CONFIG[language]
    stdin_path = Path(workdir) / "stdin.txt"
    stdin_path.write_text(stdin or "")

    run_cmd = " ".join(config["run_cmd"])
    shell_cmd = f"{run_cmd} < stdin.txt"

    container: Container | None = None
    start = time.monotonic()
    try:
        container = _client.containers.run(
            image=config["image"],
            command=["sh", "-c", shell_cmd],
            volumes={workdir: {"bind": "/home/runner", "mode": "rw"}},
            working_dir="/home/runner",
            mem_limit=f"{memory_limit_mb}m",
            nano_cpus=int(0.5 * 1e9),
            pids_limit=64,
            **_COMMON_RUN_KWARGS,
        )

        stop_sampling = threading.Event()
        sample_result: dict = {}
        sampler = threading.Thread(
            target=lambda: sample_result.update(_sample_peak_resources(container, stop_sampling)),
            daemon=True,
        )
        sampler.start()

        try:
            result = container.wait(timeout=time_limit_sec)
            elapsed_ms = (time.monotonic() - start) * 1000
            stdout = _truncate(container.logs(stdout=True, stderr=False))
            stderr = _truncate(container.logs(stdout=False, stderr=True))
            stop_sampling.set()
            sampler.join(timeout=1)
            return RunOutcome(
                exit_code=result["StatusCode"],
                stdout=stdout,
                stderr=stderr,
                timed_out=False,
                time_ms=elapsed_ms,
                peak_memory_mb=sample_result.get("peak_memory_mb"),
                peak_cpu_percent=sample_result.get("peak_cpu_percent"),
                oom_killed=_was_oom_killed(container),
            )
        except Exception:
            _safe_kill(container)
            elapsed_ms = (time.monotonic() - start) * 1000
            stop_sampling.set()
            sampler.join(timeout=1)
            return RunOutcome(
                exit_code=None,
                stdout="",
                stderr="",
                timed_out=True,
                time_ms=elapsed_ms,
                peak_memory_mb=sample_result.get("peak_memory_mb"),
                peak_cpu_percent=sample_result.get("peak_cpu_percent"),
            )
    except Exception as exc:
        raise ExecutionError(f"docker error during run: {exc}") from exc
    finally:
        _remove_container(container)


def run_against_testcases(
    test_cases: list[JudgeCase],
    language: str,
    source_code: str,
    time_limit_sec: int = 5,
    memory_limit_mb: int = 256,
) -> tuple[list[TestResult], str | None]:
    """Chạy một bài nộp qua tất cả test case.

    Trả về `(results, compile_output)`. Biên dịch hỏng thì `results` rỗng và
    `compile_output` có nội dung — không dựng ra một TestResult giả cho từng case như engine
    tham khảo, vì phía trên còn phải phân biệt "0/5 case đạt" với "chưa case nào được chạy".
    """
    if language not in LANGUAGE_CONFIG:
        raise ExecutionError(f"unsupported language: {language!r}")
    config = LANGUAGE_CONFIG[language]

    with execution_semaphore:
        workdir = tempfile.mkdtemp(prefix="codementor_judge_")
        try:
            source_path = Path(workdir) / config["filename"]
            source_path.write_text(source_code)

            compile_output = compile_step(language, workdir)
            if compile_output is not None:
                return [], compile_output

            results: list[TestResult] = []
            for test_case in test_cases:
                outcome = _run_once(
                    language, workdir, test_case.input, time_limit_sec, memory_limit_mb
                )
                verdict = determine_verdict(
                    exit_code=outcome.exit_code,
                    timed_out=outcome.timed_out,
                    stdout=outcome.stdout,
                    expected_output=test_case.expected,
                    oom_killed=outcome.oom_killed,
                )
                results.append(
                    TestResult(
                        order=test_case.order,
                        verdict=verdict,
                        stdout=outcome.stdout,
                        expected=test_case.expected,
                        stderr=outcome.stderr,
                        compile_output="",
                        time_ms=outcome.time_ms,
                        peak_memory_mb=outcome.peak_memory_mb,
                        peak_cpu_percent=outcome.peak_cpu_percent,
                    )
                )
            return results, None
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
