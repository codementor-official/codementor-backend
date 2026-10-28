# judge-service

Runs and grades code in Docker sandboxes. **Python/FastAPI**, unlike the other eight NestJS
services.

The grading engine was ported from `code-runner`, including the comments that record real
measurements (why `max_pool_size=128`, why tmpfs is 256m, why `peak_memory_mb` is usually empty).
Keep them when tidying the code: every number there is something that was tried and failed.

## Running

The judge is **not** part of the monorepo's `nest build`, `eslint` or `jest` — it is excluded from
`nest-cli.json`, `build:all` and the `APPS` array in `eslint.config.mjs`. Everything goes through
the `judge:*` scripts in `codementor-backend/package.json`:

```bash
npm run judge:install   # uv sync
npm run judge:images    # build the 6 sandbox images — run ONCE before development
npm run judge:dev       # uvicorn --reload on port 3007
npm run judge:test      # pytest (skips tests that need Docker)
npm run judge:lint      # ruff
```

Tests that need real containers are marked `docker`:

```bash
cd apps/judge-service
uv run pytest -m docker        # real grading; needs the daemon and the 6 images
uv run pytest -m "not docker"  # grading policy only; runs in CI without a daemon
```

## Two entry points, one engine

```
POST /api/v1/judge/run                 cmd.judge.run.v1  (Kafka)
        │                                        │
        │                                evt.judge.started.v1
        │                                        │
        └──────────► app.grading.grade() ◄───────┘
                              │
                    ┌─────────┴──────────┐
            return JSON now      write to Mongo → evt.judge.completed.v1
```

`POST /run` is the "try it" path: it returns the result synchronously, writes nothing to Mongo
and publishes no event.

Kafka is the path for real submissions: consume `cmd.judge.run.v1`, publish `started`, grade,
write `submission_run_details` to Mongo, then publish `completed` with a `runDetailRef`.

## Two grading modes

The branch is chosen by whether the payload carries a `spec` — **not** by an `io_mode` column.
Exercises written before function mode existed carry no `spec`, so they keep the old path without
any migration.

| | `stdin_stdout` (no `spec`) | `function` (with `spec`) |
|---|---|---|
| The learner writes | the whole program, including input parsing | only the function body |
| Input | an `input` string on stdin | `args`, a positional array |
| Expected answer | stdout compared as a string, trimmed | compared **by value** in `comparator.py` |
| Containers | one per test case | one for the whole submission |
| Learner stdout | *is* the submission | a debug console, returned in `consoleOutput` |
| Extra verdict | — | `skipped` (the container died before the case ran) |

### Expected answers never enter the sandbox

Unlike the original spec, the `tests.json` mounted into the container holds only `{id, args}`.
The driver returns the raw `actual` value and the comparison runs on the host. As a result there
is no answer inside the container to leak, and a new language only needs a driver, not its own
comparator.

The driver still deletes `tests.json` before `import solution` — an extra layer, not the main
defence.

**Known ceiling:** the driver and the learner's code share a process, so a determined learner can
still overwrite `results.ndjson`. The old stdin mode is no better (their stdout *is* the answer).
Closing this properly needs a process per case or AST filtering — worth doing once the judge serves
more than a classroom.

### Eight languages, eight drivers

Each language is one module in `app/services/langs/`, and that module holds the type mapping, the
starter code **and** the driver together. They live in one place because the signature in the
starter must match the signature the driver calls exactly — any drift hands the learner an
exercise that cannot be solved.

| | Compile | JSON | Per-case timeout | Notes |
|---|---|---|---|---|
| Python | — | stdlib | `signal.setitimer` | |
| JavaScript | — | stdlib | no | `new Function` driver, no `require` |
| TypeScript | `tsc` | stdlib | no | compiled to `solution.js`, then shares the JS driver |
| Java | `javac` | **Gson** (in the image) | no | the exercise is `class Solution`, the driver is `Main` |
| Go | `go build` | stdlib | goroutine + `select` | a timed-out goroutine cannot be killed |
| PHP | `php -l` | stdlib | no | `-l` turns syntax errors into `compile_error` |
| C | `gcc` | **cJSON** (apt) | `setitimer` + `sigsetjmp` | type mapping is NOT one-to-one |
| C++ | `g++` | **nlohmann** (header) | no | `siglongjmp` skips destructors, so it is not used |

**C is the type exception:** `list<int>` becomes two parameters (`int* nums, int numsSize`), and a
returned array adds `int* returnSize` — the LeetCode convention for C. `map` and `optional` are
not supported; `POST /judge/starter` lists them under `unsupported` so the author finds out while
writing the exercise.

### Time limits, two layers

Only Python, Go and C can cut off a case that runs too long → that case is `timeout` and the
following cases **still run**. Java, C++, JavaScript, TypeScript and PHP have no such mechanism;
for them a *slow* case is still caught by checking `runtime_ms` on the host afterwards.

A case that hangs completely gets the container killed (`time_limit × n + startup`) → the first
case without a record gets `timeout`/`memory_exceeded` and the rest are `skipped`. The driver
flushes after every case so finished results are not lost.

### Starter code is generated here too

`POST /api/v1/judge/starter` takes a signature and returns starter code for each language. The
frontend calls it instead of generating its own: a second type-mapping table written in TypeScript
would drift from the drivers, and nobody would notice until a learner submitted.

## Security

**This process holds `/var/run/docker.sock`, which is equivalent to root on the host.**

Learner code cannot reach that socket — it runs in its own ephemeral container with no network,
not as root, a read-only root filesystem, every capability dropped, and pid/RAM/CPU limits. But any
code-execution bug in **the judge itself** turns into a host takeover. Three constraints, none
optional:

1. **`/run` requires authentication.** Kong in this project has no JWT plugin, so the judge
   verifies the Keycloak token itself (`app/auth.py`, the same JWKS endpoint used by
   `libs/platform/.../keycloak.strategy.ts`). Dropping the `require_user` dependency means anyone
   who can reach `:8000` can run commands on the host.
2. **Input limits** — `MAX_SOURCE_BYTES`, `MAX_TEST_CASES`, `MAX_TEST_CASE_BYTES` in
   `app/config.py`. Without them a single request can exhaust the host.
3. **Isolate the judge host where possible.** Sharing a host with other services puts the Docker
   socket next to user data.

Each sandbox run uses `network=none`, `user=1000:1000`, `cap_drop=ALL`, `no-new-privileges`,
`read_only`, `tmpfs /tmp 256m`, `pids_limit=64`, a per-exercise `mem_limit` and
`nano_cpus=0.5e9`.

## Measurement limits

`memoryKb` is **usually 0**, and that is not a bug. Docker only reports resource usage through
`container.stats()`, which takes 1–2 seconds inside dockerd to produce real numbers — while a
typical AC/WA/RE container lives 200–700 ms and is gone by then. Long runs (TLE) do get numbers.
Judge0 avoids this because `isolate` reads the cgroup synchronously as soon as the process exits.

`memory_exceeded` is still detected: it reads the daemon's `OOMKilled` flag, which does not
depend on sampling in time.

## Judge0

`app/services/judge0_client.py` is kept and configurable (`JUDGE0_URL`), but **nothing calls it**:
`EXECUTION_ENGINE` defaults to `docker`. Judge0 relies on `isolate`, which needs cgroup v1, while
the current hosts run cgroup v2. Setting `EXECUTION_ENGINE=judge0` is enough to turn it back on
once a suitable host exists — `app/services/execution_engine.py` imports only the selected engine,
so choosing one never initialises the other.

## Supported languages

`python`, `c`, `cpp`, `java`, `javascript`, `typescript`, `go`, `php` — listed in
`app/services/execution_config.py`. The image tags there must match `scripts/build-images.sh`.
