"""Lịch sử hội thoại của Lecter, trong `ai_agent_sessions`.

KHÔNG tái dùng `ai_conversations`: validator của nó bắt mọi turn phải có `citations` và
`insufficientEvidence` (bằng chứng trích dẫn của RAG) và chặn ở 50 turn. Hội thoại agent không có
những trường đó, nên ghi vào là bị Mongo từ chối — schema riêng ở
`codementor-infra/database/mongo/schemas/08-ai-agent-sessions.js`.

Ghi sau khi stream xong, đọc thẳng từ checkpoint của graph thay vì tự gom sự kiện SSE: gom tay là
viết lại đúng thứ `ag-ui-langgraph` đã làm, và sẽ lệch ngay lần đầu nó đổi cách ghép tool call.
"""

import logging
from datetime import UTC, datetime, timedelta

from ag_ui_langgraph.utils import langchain_messages_to_agui

logger = logging.getLogger("codementor.ai")

AGENT_ID = "lecter"
TITLE_CHARS = 80
# Dài hơn `ai_document_indexes` (30 ngày) vì đây là việc người dùng quay lại đọc, không phải cache;
# vẫn có hạn để hội thoại bỏ quên không nằm lại vô thời hạn.
TTL_DAYS = 90


def _now() -> datetime:
    return datetime.now(UTC)


def _title(messages: list) -> str:
    for message in messages:
        if message.get("role") == "user" and isinstance(message.get("content"), str):
            text = " ".join(message["content"].split())
            if text:
                return text[:TITLE_CHARS]
    return "Hội thoại mới"


async def save(db, user_id: str, thread_id: str, graph) -> None:
    """Lưu toàn bộ hội thoại của thread. Hỏng thì log rồi thôi — mất lịch sử là phiền, mất câu
    trả lời vừa stream xong vì một lỗi ghi mới là hỏng thật.

    Dựng `config` tại đây thay vì mượn của `LangGraphAgent`: agent `copy()` config rồi mới gắn
    `thread_id` vào bản sao, nên đối tượng gốc không bao giờ có khoá để tra checkpoint.
    """
    try:
        state = await graph.aget_state({"configurable": {"thread_id": thread_id}})
        # `langchain_messages_to_agui` trả về model Pydantic của ag-ui; pymongo không mã hoá
        # được chúng, phải đổi sang dict trước.
        #
        # `by_alias=True` không phải tuỳ chọn: model của ag-ui đặt tên trường theo snake_case còn
        # dây dẫn AG-UI là camelCase (`tool_calls` → `toolCalls`, `tool_call_id` → `toolCallId`).
        # Thiếu nó thì bản ghi lưu xuống không hợp lệ với schema TypeScript, và lịch sử nạp lại
        # sẽ rụng mất toàn bộ tool call.
        messages = [
            message.model_dump(exclude_none=True, by_alias=True)
            for message in langchain_messages_to_agui(state.values.get("messages", []))
        ]
        if not messages:
            return
        now = _now()
        await db["ai_agent_sessions"].update_one(
            {"_id": f"{AGENT_ID}:{thread_id}"},
            {
                "$set": {
                    "userId": user_id,
                    "agentId": AGENT_ID,
                    "title": _title(messages),
                    "messages": messages,
                    "updatedAt": now,
                    "expiresAt": now + timedelta(days=TTL_DAYS),
                },
                "$setOnInsert": {"createdAt": now},
            },
            upsert=True,
        )
    except Exception:  # noqa: BLE001 - xem docstring
        logger.warning("Không lưu được hội thoại Lecter cho thread %s", thread_id, exc_info=True)


async def listing(db, user_id: str, limit: int = 30) -> list[dict]:
    cursor = (
        db["ai_agent_sessions"]
        .find({"userId": user_id, "agentId": AGENT_ID}, {"messages": 0})
        .sort("updatedAt", -1)
        .limit(limit)
    )
    return [
        {
            "id": doc["_id"].split(":", 1)[1],
            "title": doc.get("title") or "Hội thoại mới",
            "updatedAt": doc["updatedAt"].isoformat(),
        }
        async for doc in cursor
    ]


async def read(db, user_id: str, thread_id: str) -> dict | None:
    doc = await db["ai_agent_sessions"].find_one(
        {"_id": f"{AGENT_ID}:{thread_id}", "userId": user_id}
    )
    if not doc:
        return None
    return {
        "id": thread_id,
        "title": doc.get("title") or "Hội thoại mới",
        "messages": doc.get("messages") or [],
        "updatedAt": doc["updatedAt"].isoformat(),
    }


async def remove(db, user_id: str, thread_id: str) -> bool:
    result = await db["ai_agent_sessions"].delete_one(
        {"_id": f"{AGENT_ID}:{thread_id}", "userId": user_id}
    )
    return result.deleted_count > 0
