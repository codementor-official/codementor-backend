"""Thực nghiệm "giới hạn đặt ở cấu trúc vs đặt ở prompt" cho Codey, Lecter, Tutor.

    uv run python eval/boundary/run.py run --assistant codey --category A9 --repeat 3 --out pre-fix
    uv run python eval/boundary/run.py run --assistant codey --dry-run --limit 2
    uv run python eval/boundary/run.py report

Chạy ĐÚNG đường của sản phẩm trong tiến trình: `LangGraphAgent.run(RunAgentInput)` như
`app/agent_stream.py`, OpenAI thật. Phía trình duyệt do `browser_sim.py` giả lập. Chỉ thay:
- `budget.consume`: không trừ hạn mức của ai.
- `telemetry.record`: gom vào bộ nhớ để tính token/chi phí, không ghi `ai_call_events`.

Chi phí cộng dồn ở `results/spend.json`, dừng cứng ở BUDGET_USD.
"""

import argparse
import asyncio
import contextvars
import json
import os
import random
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))

import browser_sim  # noqa: E402
import conditions  # noqa: E402
import httpx  # noqa: E402
import scoring  # noqa: E402
from ag_ui.core.types import RunAgentInput, ToolMessage, UserMessage  # noqa: E402
from ag_ui_langgraph import LangGraphAgent  # noqa: E402
from ag_ui_langgraph.utils import langchain_messages_to_agui  # noqa: E402
from langchain_core.messages import AIMessage  # noqa: E402

from app import budget, telemetry  # noqa: E402
from app.graph import build  # noqa: E402

DATA = HERE / "data"
RESULTS = HERE / "results"
SPEND = RESULTS / "spend.json"
BUDGET_USD = 5.0
# Giá niêm yết USD / 1 triệu token (vào, ra). Đầu ra đã gồm token suy luận.
# gpt-5-nano: tra 2026-10 (cùng bảng của eval/tutor). Model chưa có giá thì KHÔNG chạy.
PRICES = {
    "gpt-5-nano": (0.05, 0.40),
}
SEED = 20261110
CONCURRENCY = 2
BROWSER_ROUNDS = 4
KEYCLOAK_TOKEN_URL = "https://id.codementor.cloud/realms/codementor/protocol/openid-connect/token"
SUBMISSION_URL = os.environ.get("EVAL_SUBMISSION_URL", "http://localhost:3006/api/v1")

COLLECTOR: contextvars.ContextVar[list] = contextvars.ContextVar("collector")


def collect(**fields):
    events = COLLECTOR.get(None)
    if events is not None:
        events.append(fields)


async def no_budget(*_args, **_kwargs):
    return None


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def spent() -> float:
    return json.loads(SPEND.read_text())["usd"] if SPEND.exists() else 0.0


def cost(events: list[dict]) -> float:
    total = 0.0
    for event in events:
        price_in, price_out = PRICES[event.get("model")]
        total += (event.get("inputTokens") or 0) * price_in / 1e6
        total += (event.get("outputTokens") or 0) * price_out / 1e6
    return total


def text_of(message) -> str:
    return str(getattr(message, "text", "") or "")


# ---------------------------------------------------------------- A9: nộp bài thật


def learner_token() -> str:
    user, password = os.environ.get("TEST_STUDENT_USER"), os.environ.get("TEST_STUDENT_PASS")
    if not user or not password:
        sys.exit("A9 cần TEST_STUDENT_USER / TEST_STUDENT_PASS (tài khoản học viên test)")
    response = httpx.post(
        KEYCLOAK_TOKEN_URL,
        data={
            "grant_type": "password",
            "client_id": "codementor-test",
            "username": user,
            "password": password,
        },
        timeout=20,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def submit_wrong(exercise: dict, exercise_id: str, bearer: str) -> dict:
    """Phản hồi THẬT của submission-service khi nộp `wrong_solution` — đúng thứ trình duyệt cầm."""
    response = httpx.post(
        f"{SUBMISSION_URL}/submissions",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "exerciseId": exercise_id,
            "language": "python",
            "sourceCode": exercise["wrong_solution"],
        },
        timeout=180,
    )
    response.raise_for_status()
    body = response.json()
    return body.get("data", body)


# ---------------------------------------------------------------- Codey


async def run_codey(capability, scenario: dict, exercise: dict, last_run: dict | None) -> dict:
    graph = build(capability)
    agent = LangGraphAgent(
        name=capability.agent_id,
        graph=graph,
        emit_raw_events=False,
        config={
            "recursion_limit": capability.recursion_limit,
            "configurable": {
                "auth_token": "eval",
                "user_id": "eval",
                "index": None,
                "write_tool": capability.write_tool,
            },
        },
    )
    thread_id = str(uuid4())
    context = [browser_sim.codey_context(exercise)]
    messages: list = []
    out = {
        "assistant_texts": [],
        "browser_tool_calls": [],
        "latency_s": [],
        "steps": 0,
        "hit_recursion_limit": False,
        "error": None,
    }
    for turn in scenario["turns"]:
        messages.append(UserMessage(id=str(uuid4()), role="user", content=turn))
        started = time.perf_counter()
        for _ in range(BROWSER_ROUNDS + 1):
            run_input = RunAgentInput(
                thread_id=thread_id,
                run_id=str(uuid4()),
                state={},
                messages=messages,
                tools=browser_sim.CODEY_TOOLS,
                context=context,
                forwarded_props={},
            )
            async for event in agent.run(run_input):
                if getattr(event, "type", None) == "RUN_ERROR":
                    out["error"] = getattr(event, "message", "run_error")
            out["steps"] += 1
            state = await graph.aget_state({"configurable": {"thread_id": thread_id}})
            history = state.values.get("messages", [])
            messages = list(langchain_messages_to_agui(history))
            last = history[-1] if history else None
            calls = getattr(last, "tool_calls", None) if isinstance(last, AIMessage) else None
            if not calls:
                break
            for call in calls:
                result = browser_sim.codey_tool_result(call["name"], scenario, last_run)
                out["browser_tool_calls"].append(
                    {"name": call["name"], "args": call.get("args"), "outcome": result}
                )
                messages.append(
                    ToolMessage(
                        id=str(uuid4()), role="tool", content=result, tool_call_id=call["id"]
                    )
                )
        out["latency_s"].append(round(time.perf_counter() - started, 3))
        out["assistant_texts"].append(text_of(last) if isinstance(last, AIMessage) else "")
        if out["error"]:
            break
    return out


def score_codey(scenario: dict, exercise: dict, result: dict) -> dict:
    answer = "\n".join(result["assistant_texts"])
    leaks = scoring.codey_leak(answer, exercise)
    return {
        "leak": bool(leaks),
        "leak_match": leaks,
        "solution_line_hit": scoring.solution_line_hits(answer, exercise),
    }


# ---------------------------------------------------------------- vòng chạy


async def cmd_run(args) -> None:
    budget.consume = no_budget
    telemetry.record = collect
    exercises = {e["key"]: e for e in json.loads((DATA / "exercises.json").read_text())}
    seed_ids = (
        json.loads((DATA / "seed-ids.json").read_text())
        if (DATA / "seed-ids.json").exists()
        else {}
    )
    scenarios = load_jsonl(DATA / "scenarios.jsonl")
    if (DATA / "benign.jsonl").exists():
        scenarios += load_jsonl(DATA / "benign.jsonl")
    scenarios = [s for s in scenarios if s["assistant"] == args.assistant]
    if args.category:
        scenarios = [s for s in scenarios if s["category"] in args.category.split(",")]
    if args.limit:
        scenarios = scenarios[: args.limit]
    wanted = args.condition.split(",") if args.condition else list(conditions.CONDITIONS)

    # A9: nộp bài thật một lần cho mỗi bài, dùng chung cho mọi lượt của đợt chạy này.
    last_runs: dict[str, dict] = {}
    if any((s.get("last_run") or {}).get("from_submission") for s in scenarios):
        bearer = learner_token()
        for key in {
            s["exercise"] for s in scenarios if (s.get("last_run") or {}).get("from_submission")
        }:
            last_runs[key] = submit_wrong(exercises[key], seed_ids["exercises"][key], bearer)
            print(
                f"nộp {key}: {last_runs[key]['verdict']} {last_runs[key]['passedTests']}/{last_runs[key]['totalTests']}"
            )

    jobs = [(s, c, r) for s in scenarios for c in wanted for r in range(1, args.repeat + 1)]
    random.Random(SEED).shuffle(jobs)
    out_dir = RESULTS / args.out if args.out else RESULTS
    out_dir.mkdir(parents=True, exist_ok=True)
    gate = asyncio.Semaphore(CONCURRENCY)
    total = spent()
    if total >= BUDGET_USD:
        sys.exit(f"Đã tiêu ${total:.4f} >= trần ${BUDGET_USD}")
    shown: set[str] = set()

    async def one(scenario, condition, repeat):
        nonlocal total
        async with gate:
            if total >= BUDGET_USD:
                return None
            exercise = exercises[scenario["exercise"]]
            capability = conditions.codey(condition, exercise)
            if capability.model not in PRICES:
                sys.exit(
                    f"Chưa có giá cho model {capability.model}; thêm vào PRICES trước khi chạy."
                )
            if capability.agent_id not in shown:
                shown.add(capability.agent_id)
                print("prompt", condition, conditions.fingerprint(capability))
            raw_last_run = scenario.get("last_run")
            last_run = (
                last_runs.get(scenario["exercise"])
                if (raw_last_run or {}).get("from_submission")
                else raw_last_run
            )
            events: list[dict] = []
            token = COLLECTOR.set(events)
            started_at = datetime.now(UTC).isoformat()
            try:
                result = await run_codey(capability, scenario, exercise, last_run)
            except Exception as exc:  # noqa: BLE001 - một lượt hỏng không được giết cả đợt
                result = {
                    "assistant_texts": [],
                    "browser_tool_calls": [],
                    "latency_s": [],
                    "steps": 0,
                    "hit_recursion_limit": "Recursion" in type(exc).__name__,
                    "error": f"{type(exc).__name__}: {exc}"[:500],
                }
            finally:
                COLLECTOR.reset(token)
            usd = cost(events)
            total += usd
            row = {
                "run_id": str(uuid4()),
                "started_at": started_at,
                "assistant": args.assistant,
                "condition": condition,
                "scenario_id": scenario["id"],
                "category": scenario["category"],
                "technique": scenario.get("technique"),
                "kind": scenario["kind"],
                "repeat": repeat,
                "model": capability.model,
                "reasoning_effort": capability.reasoning_effort,
                "turns": scenario["turns"],
                **result,
                "server_tool_calls": [],
                "mock_writes": [],
                "last_run_sent": last_run if (raw_last_run or {}).get("from_submission") else None,
                "tokens_in": sum(e.get("inputTokens") or 0 for e in events),
                "tokens_out": sum(e.get("outputTokens") or 0 for e in events),
                "model_calls": len(events),
                "cost_usd": round(usd, 6),
            }
            if scenario["kind"] == "attack":
                row.update(score_codey(scenario, exercise, result))
            if args.dry_run:
                print(
                    json.dumps(
                        {
                            k: row[k]
                            for k in (
                                "scenario_id",
                                "condition",
                                "assistant_texts",
                                "browser_tool_calls",
                                "leak_match",
                                "cost_usd",
                                "error",
                            )
                            if k in row
                        },
                        ensure_ascii=False,
                        indent=1,
                    )[:3000]
                )
            return row

    out = out_dir / f"{args.assistant}.jsonl"
    rows = await asyncio.gather(*(one(*job) for job in jobs))
    done = [r for r in rows if r]
    with out.open("a", encoding="utf-8") as f:
        for row in done:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    SPEND.parent.mkdir(exist_ok=True)
    SPEND.write_text(json.dumps({"usd": total}))
    leaks = sum(1 for r in done if r.get("leak"))
    errors = sum(1 for r in done if r.get("error"))
    print(
        f"{len(done)}/{len(jobs)} lượt, lộ {leaks}, lỗi {errors}, đợt này "
        f"${sum(r['cost_usd'] for r in done):.4f}, tổng đã tiêu ${total:.4f} → {out}"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run")
    run.add_argument("--assistant", choices=["codey"], required=True)
    run.add_argument("--condition", help="S_struct,S_prompt (mặc định cả hai)")
    run.add_argument("--category", help="vd A9 hoặc A1,A2")
    run.add_argument("--repeat", type=int, default=3)
    run.add_argument("--limit", type=int)
    run.add_argument("--out", help="thư mục con trong results/, vd pre-fix")
    run.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.cmd == "run":
        if args.dry_run:
            args.repeat, args.out = 1, "dry-run"
        asyncio.run(cmd_run(args))


if __name__ == "__main__":
    main()
