import asyncio
from datetime import UTC, date, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app import telemetry
from app.admin import fill_daily, merge_agents, window_start
from app.auth import require_admin


class FakeCollection:
    def __init__(self, fail: bool = False):
        self.rows: list[dict] = []
        self.fail = fail

    async def insert_one(self, row):
        if self.fail:
            raise RuntimeError("mongo down")
        self.rows.append(row)


def run_scoped(body):
    """Mỗi test chạy trong một event loop mới — cũng là một context mới, nên phạm vi không rò."""

    async def main():
        result = await body()
        await asyncio.gather(*telemetry._pending)
        return result

    return asyncio.run(main())


@pytest.fixture
def events(monkeypatch):
    collection = FakeCollection()
    monkeypatch.setattr(telemetry, "_db", {telemetry.COLLECTION: collection})
    return collection


def test_record_carries_scope_and_drops_empty_fields(events):
    async def body():
        telemetry.set_scope("codey", "user-1", None, "thread-1")
        telemetry.record(ok=True, model="gpt", inputTokens=10, outputTokens=5, errorType=None)

    run_scoped(body)
    [row] = events.rows
    assert row["agent"] == "codey" and row["userId"] == "user-1" and row["threadId"] == "thread-1"
    # Validator strict: trường None không được có mặt.
    assert "workspaceId" not in row and "errorType" not in row
    assert (row["inputTokens"], row["outputTokens"], row["ok"]) == (10, 5, True)


def test_record_outside_any_scope_writes_nothing(events):
    async def body():
        telemetry.record(ok=True, model="gpt")

    run_scoped(body)
    assert events.rows == []


def test_insert_failure_never_raises(monkeypatch):
    monkeypatch.setattr(telemetry, "_db", {telemetry.COLLECTION: FakeCollection(fail=True)})

    async def body():
        telemetry.set_scope("rag")
        telemetry.record(ok=True, model="gpt")

    run_scoped(body)  # không ném


def test_error_message_is_truncated_and_never_the_provider_body(events):
    error = type("RateLimitError", (Exception,), {"status_code": 429})("prompt bí mật " * 100)

    async def body():
        telemetry.set_scope("suggest")
        telemetry.record_call("gpt", 0.0, error=error)

    run_scoped(body)
    [row] = events.rows
    assert row["ok"] is False and row["errorType"] == "RateLimitError"
    assert row["errorMessage"] == "HTTP 429 · RateLimitError"


@pytest.mark.parametrize(
    ("usage", "expected"),
    [
        (SimpleNamespace(input_tokens=12, output_tokens=3), (12, 3)),  # Responses API
        (SimpleNamespace(prompt_tokens=40, total_tokens=40), (40, 0)),  # Embeddings
        ({"input_tokens": 7, "output_tokens": 2}, (7, 2)),  # LangChain usage_metadata
        (None, (0, 0)),
    ],
)
def test_usage_tokens_reads_every_shape(usage, expected):
    assert telemetry.usage_tokens(usage) == expected


def test_langchain_callback_records_usage(events):
    callback = telemetry.UsageCallback("gpt-smart")
    run_id = uuid4()
    message = SimpleNamespace(usage_metadata={"input_tokens": 100, "output_tokens": 20})
    response = SimpleNamespace(generations=[[SimpleNamespace(message=message)]])

    async def body():
        telemetry.set_scope("lecter", "user-2")
        await callback.on_chat_model_start({}, [], run_id=run_id)
        await callback.on_llm_end(response, run_id=run_id)

    run_scoped(body)
    [row] = events.rows
    assert (row["agent"], row["model"], row["inputTokens"], row["outputTokens"]) == (
        "lecter",
        "gpt-smart",
        100,
        20,
    )


@pytest.mark.parametrize("role", ["ADMIN", "admin"])
def test_require_admin_accepts_either_case(role):
    claims = {"sub": "u", "realm_access": {"roles": [role]}}
    assert require_admin(claims) is claims


def test_require_admin_rejects_others():
    with pytest.raises(HTTPException) as error:
        require_admin({"sub": "u", "realm_access": {"roles": ["LECTURER"]}})
    assert error.value.status_code == 403


def test_window_starts_at_vietnam_midnight():
    # 00:00 ngày 21/9 giờ VN = 17:00 ngày 20/9 UTC.
    assert window_start(7, date(2026, 9, 27)) == datetime(2026, 9, 20, 17, tzinfo=UTC)


def test_fill_daily_has_one_point_per_day():
    series = fill_daily([{"_id": "2026-09-26", "tokens": 50, "calls": 2, "errors": 1}], 3, date(2026, 9, 27))
    assert [point["date"] for point in series] == ["2026-09-25", "2026-09-26", "2026-09-27"]
    assert series[1] == {"date": "2026-09-26", "tokens": 50, "calls": 2, "errors": 1}
    assert series[0]["tokens"] == 0


def test_merge_agents_lists_every_agent():
    rows = merge_agents(
        [{"_id": "codey", "calls": 3, "users": ["a", "b", None], "latency": [120.4, 900.6]}],
        {"codey": 2, "rag": 0},
    )
    assert [row["agent"] for row in rows][:2] == ["codey", "lecter"]
    codey = rows[0]
    assert (codey["calls"], codey["users"], codey["p50LatencyMs"], codey["p95LatencyMs"]) == (3, 2, 120, 901)
    assert codey["conversations"] == 2
    assert rows[1]["p95LatencyMs"] is None and rows[1]["conversations"] is None
