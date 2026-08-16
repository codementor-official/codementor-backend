import base64
import time
from dataclasses import dataclass

import httpx

from app.config import settings
from app.services.judgement import (
    ACCEPTED,
    COMPILE_ERROR,
    RUNTIME_ERROR,
    TIMEOUT,
    WRONG_ANSWER,
    JudgeCase,
)

HTTP_TIMEOUT = 5.0
POLL_TIMEOUT_TOTAL = 10.0
POLL_INTERVAL = 0.5

# Judge0 status.id -> description. 1/2 mean still queued/processing.
_IN_PROGRESS_STATUS_IDS = {1, 2}

_LANGUAGE_NAME_PREFIX = {
    "python": "Python (3",
    "java": "Java (OpenJDK",
    "c": "C (GCC",
    "cpp": "C++ (GCC",
    "php": "PHP (",
    "javascript": "JavaScript (Node.js",
    "typescript": "TypeScript (",
    "go": "Go (",
}

_language_id_cache: dict[str, int] | None = None


class Judge0Error(RuntimeError):
    """Raised when Judge0 is unreachable or returns an unexpected response."""


@dataclass
class TestResult:
    """Cùng hình dạng với TestResult của docker_executor, để `grading` không cần biết engine
    nào đang chạy."""

    order: int
    verdict: str
    stdout: str
    expected: str
    stderr: str
    compile_output: str
    time_ms: float | None
    peak_memory_mb: float | None = None
    peak_cpu_percent: float | None = None


def _b64encode(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


def _b64decode(text: str | None) -> str:
    if not text:
        return ""
    return base64.b64decode(text).decode(errors="replace")


def _fetch_language_ids() -> dict[str, int]:
    """GET {JUDGE0_URL}/languages once and resolve real IDs for our 4 languages.

    Judge0 language IDs vary between deployments/versions, so we never hardcode
    them (per CLAUDE.md §5.2) — we resolve them against the live instance and
    cache for the process lifetime.
    """
    try:
        resp = httpx.get(f"{settings.judge0_url}/languages", timeout=HTTP_TIMEOUT)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise Judge0Error(f"could not reach Judge0 at {settings.judge0_url}: {exc}") from exc

    languages = resp.json()
    resolved: dict[str, int] = {}
    for key, prefix in _LANGUAGE_NAME_PREFIX.items():
        matches = [lang for lang in languages if lang["name"].startswith(prefix)]
        if not matches:
            raise Judge0Error(f"no Judge0 language found matching prefix {prefix!r}")
        resolved[key] = max(matches, key=lambda lang: lang["id"])["id"]
    return resolved


def get_language_id(language: str) -> int:
    global _language_id_cache
    if _language_id_cache is None:
        _language_id_cache = _fetch_language_ids()
    try:
        return _language_id_cache[language]
    except KeyError:
        raise Judge0Error(f"unsupported language: {language!r}") from None


def submit_code(source_code: str, language_id: int, stdin: str) -> str:
    try:
        resp = httpx.post(
            f"{settings.judge0_url}/submissions",
            params={"base64_encoded": "true", "wait": "false"},
            json={
                "source_code": _b64encode(source_code),
                "language_id": language_id,
                "stdin": _b64encode(stdin),
                "cpu_time_limit": 2,
                "memory_limit": 128000,
            },
            timeout=HTTP_TIMEOUT,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise Judge0Error(f"failed to submit to Judge0: {exc}") from exc
    return resp.json()["token"]


def get_result(token: str) -> dict:
    deadline = time.monotonic() + POLL_TIMEOUT_TOTAL
    while True:
        try:
            resp = httpx.get(
                f"{settings.judge0_url}/submissions/{token}",
                params={"base64_encoded": "true"},
                timeout=HTTP_TIMEOUT,
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise Judge0Error(f"failed to poll Judge0 submission {token}: {exc}") from exc

        result = resp.json()
        if result["status"]["id"] not in _IN_PROGRESS_STATUS_IDS:
            return result

        if time.monotonic() >= deadline:
            raise Judge0Error(f"timed out waiting for Judge0 result (token={token})")
        time.sleep(POLL_INTERVAL)


def _to_verdict(status_id: int, stdout: str, expected: str) -> str:
    """Bảng trạng thái của Judge0 sang từ vựng của JudgeCompletedV1.

    Judge0 không tách riêng "vượt bộ nhớ": tràn heap rơi vào nhóm runtime error 7-12, nên
    engine này không bao giờ trả `memory_exceeded` — khác docker_executor, vốn đọc được cờ
    OOMKilled của daemon.
    """
    if status_id == 3:
        return ACCEPTED if stdout.strip() == expected.strip() else WRONG_ANSWER
    if status_id == 4:
        return WRONG_ANSWER
    if status_id == 5:
        return TIMEOUT
    if status_id == 6:
        return COMPILE_ERROR
    if 7 <= status_id <= 12:
        return RUNTIME_ERROR
    # 13/14 là lỗi nội bộ của Judge0, không phải lỗi của bài nộp.
    raise Judge0Error(f"Judge0 trả trạng thái không xử lý được: {status_id}")


def run_against_testcases(
    test_cases: list[JudgeCase],
    language: str,
    source_code: str,
    time_limit_sec: int = 5,
    memory_limit_mb: int = 256,
) -> tuple[list[TestResult], str | None]:
    """Cùng chữ ký với docker_executor.run_against_testcases.

    `time_limit_sec`/`memory_limit_mb` bị bỏ qua: Judge0 lấy giới hạn từ cấu hình phía server
    của nó, không nhận theo từng lần gọi. Nhận vào rồi lờ đi vẫn hơn là để hai engine có hai
    chữ ký khác nhau, buộc chỗ gọi phải biết engine nào đang chạy.
    """
    language_id = get_language_id(language)
    results: list[TestResult] = []
    for test_case in test_cases:
        token = submit_code(source_code, language_id, test_case.input)
        result = get_result(token)
        stdout = _b64decode(result.get("stdout"))
        compile_output = _b64decode(result.get("compile_output"))

        # Biên dịch hỏng thì không case nào chạy — trả sớm, giống docker_executor.
        if result["status"]["id"] == 6:
            return [], compile_output or "compilation failed"

        results.append(
            TestResult(
                order=test_case.order,
                verdict=_to_verdict(result["status"]["id"], stdout, test_case.expected),
                stdout=stdout,
                expected=test_case.expected,
                stderr=_b64decode(result.get("stderr")),
                compile_output=compile_output,
                time_ms=float(result["time"]) * 1000 if result.get("time") else None,
                # Judge0 có trả `memory` (KB) nhưng chỉ khi cấu hình bật; coi như không có.
                peak_memory_mb=None,
            )
        )
    return results, None
