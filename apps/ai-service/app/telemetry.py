"""Ghi mỗi lời gọi model vào `ai_call_events` — nguồn số liệu của trang Vận hành AI bên admin.

Hai đường gọi model, một chỗ ghi:
- `OpenAIProvider` (RAG, gợi ý testcase, dashboard, embedding) gọi `record_call` quanh lời gọi SDK.
- LangChain (Codey, Lecter) báo qua `UsageCallback`, gắn vào `ChatOpenAI` ở `graph.py`.

Ai gọi (agent, người dùng, nhóm) không truyền qua tham số mà qua `ContextVar`, đặt một lần ở cửa
vào (`set_scope`). Lời gọi model nằm sâu dưới `index.search` hay dưới một tool của Lecter; luồn
agent qua từng tầng đó là sửa chữ ký của cả chuỗi chỉ để đo đếm. ContextVar đi theo task của
asyncio, nên mỗi request có phạm vi riêng và không rò sang request khác.

Ghi là fire-and-forget: lỗi ở đây chỉ để lại log, không bao giờ làm hỏng câu trả lời.
Không ghi prompt, câu hỏi hay nội dung tài liệu.
"""

import asyncio
import logging
import time
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from langchain_core.callbacks import AsyncCallbackHandler

logger = logging.getLogger("codementor.ai")

COLLECTION = "ai_call_events"
MAX_ERROR_MESSAGE = 300

_scope: ContextVar[dict[str, str] | None] = ContextVar("ai_call_scope", default=None)
_db = None
# Giữ tham chiếu tới task đang ghi: asyncio chỉ giữ weakref, task không ai giữ có thể bị GC giữa
# chừng.
_pending: set[asyncio.Task] = set()


def init(db) -> None:
    global _db
    _db = db


def set_scope(
    agent: str,
    user_id: str | None = None,
    workspace_id: str | None = None,
    thread_id: str | None = None,
) -> None:
    """Đặt ở cửa vào của một bề mặt. Trường `None` bị bỏ: validator của collection là strict."""
    values = {"agent": agent, "userId": user_id, "workspaceId": workspace_id, "threadId": thread_id}
    _scope.set({key: str(value) for key, value in values.items() if value is not None})


def record(*, ok: bool, model: str | None = None, **fields: Any) -> None:
    """Ghi một sự kiện trong phạm vi hiện tại. Ngoài mọi phạm vi (không có agent) thì bỏ qua."""
    scope = _scope.get()
    if _db is None or not scope:
        return
    event = {"at": datetime.now(UTC), "ok": ok, "model": model, **scope}
    event.update({key: value for key, value in fields.items() if value is not None})
    if "errorMessage" in event:
        event["errorMessage"] = str(event["errorMessage"])[:MAX_ERROR_MESSAGE]
    try:
        task = asyncio.get_running_loop().create_task(_insert(event))
    except RuntimeError:
        return  # không có event loop (test đồng bộ) — không có gì để ghi vào
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def _insert(event: dict) -> None:
    try:
        await _db[COLLECTION].insert_one(event)
    except Exception:  # noqa: BLE001 - đo đếm không được làm hỏng câu trả lời
        logger.warning("Không ghi được ai_call_events (%s)", event.get("agent"), exc_info=True)


def elapsed_ms(started: float) -> int:
    return max(0, round((time.perf_counter() - started) * 1000))


def usage_tokens(usage: Any) -> tuple[int, int]:
    """(vào, ra) từ `usage` của OpenAI SDK — Responses API hoặc Embeddings — hoặc từ
    `usage_metadata` của LangChain. Thiếu thì 0, không đoán."""
    if usage is None:
        return 0, 0
    read = usage.get if isinstance(usage, dict) else lambda key, default=0: getattr(usage, key, default)
    input_tokens = read("input_tokens", None)
    if input_tokens is None:
        input_tokens = read("prompt_tokens", 0)  # Embeddings chỉ có prompt_tokens
    return int(input_tokens or 0), int(read("output_tokens", 0) or 0)


def record_call(model: str, started: float, *, usage: Any = None, error: Exception | None = None):
    """Cho `OpenAIProvider`: một lời gọi SDK vừa xong (có `usage`) hoặc vừa ném lỗi."""
    input_tokens, output_tokens = usage_tokens(usage)
    record(
        ok=error is None,
        model=model,
        inputTokens=input_tokens,
        outputTokens=output_tokens,
        latencyMs=elapsed_ms(started),
        errorType=type(error).__name__ if error else None,
        errorMessage=_describe(error) if error else None,
    )


def _describe(error: Exception) -> str:
    """Mã HTTP + lớp lỗi, KHÔNG phải thân phản hồi: thân lỗi của nhà cung cấp có thể chứa prompt."""
    status = getattr(error, "status_code", None)
    return f"HTTP {status} · {type(error).__name__}" if status else type(error).__name__


class UsageCallback(AsyncCallbackHandler):
    """Đo lời gọi model của LangChain. Một instance cho mỗi `ChatOpenAI`, biết sẵn tên model."""

    def __init__(self, model: str):
        self.model = model
        self._started: dict[UUID, float] = {}

    async def on_chat_model_start(self, serialized, messages, *, run_id: UUID, **kwargs) -> None:
        self._started[run_id] = time.perf_counter()

    async def on_llm_end(self, response, *, run_id: UUID, **kwargs) -> None:
        started = self._started.pop(run_id, time.perf_counter())
        usage = None
        for generations in response.generations:
            for generation in generations:
                usage = getattr(getattr(generation, "message", None), "usage_metadata", None) or usage
        input_tokens, output_tokens = usage_tokens(usage)
        record(
            ok=True,
            model=self.model,
            inputTokens=input_tokens,
            outputTokens=output_tokens,
            latencyMs=elapsed_ms(started),
        )

    async def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs) -> None:
        started = self._started.pop(run_id, time.perf_counter())
        record(
            ok=False,
            model=self.model,
            latencyMs=elapsed_ms(started),
            errorType=type(error).__name__,
            errorMessage=_describe(error),  # type: ignore[arg-type]
        )
