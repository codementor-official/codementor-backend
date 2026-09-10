"""Lịch sử hội thoại của mọi bề mặt agent, trong `ai_agent_sessions`.

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

TITLE_CHARS = 80
# Dài hơn `ai_document_indexes` (30 ngày) vì đây là việc người dùng quay lại đọc, không phải cache;
# vẫn có hạn để hội thoại bỏ quên không nằm lại vô thời hạn.
TTL_DAYS = 90


def _now() -> datetime:
    return datetime.now(UTC)


def _doc_id(agent_id: str, workspace_id: str | None, thread_id: str) -> str:
    """Khoá của một hội thoại.

    Có `workspace_id` thì nó nằm TRONG khoá, không chỉ trong một trường: một người ở hai nhóm
    phải thấy hai danh sách rời nhau, và một `threadId` trùng nhau giữa hai nhóm không được
    trỏ về cùng một bản ghi.
    """
    return ":".join(part for part in (agent_id, workspace_id, thread_id) if part)


def _title(messages: list) -> str:
    for message in messages:
        if message.get("role") == "user" and isinstance(message.get("content"), str):
            text = " ".join(message["content"].split())
            if text:
                return text[:TITLE_CHARS]
    return "Hội thoại mới"


async def save(
    db,
    user_id: str,
    thread_id: str,
    graph,
    *,
    agent_id: str,
    workspace_id: str | None = None,
    extra: dict | None = None,
) -> None:
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
        fields = {
            "userId": user_id,
            "agentId": agent_id,
            "threadId": thread_id,
            "title": _title(messages),
            "messages": messages,
            "updatedAt": now,
            "expiresAt": now + timedelta(days=TTL_DAYS),
        }
        if workspace_id:
            fields["workspaceId"] = workspace_id
        # Trường HIỂN THỊ do bề mặt gọi tự quyết (Codey gửi `exerciseId`/`exerciseTitle`), tách
        # hẳn khỏi `workspace_id` vốn là khoá PHẠM VI. Trộn hai vai đó lại thì thêm một nhãn để
        # hiện trong danh sách hoá ra lại thu hẹp cả bộ lọc quyền đọc.
        fields.update(extra or {})
        await db["ai_agent_sessions"].update_one(
            {"_id": _doc_id(agent_id, workspace_id, thread_id)},
            {"$set": fields, "$setOnInsert": {"createdAt": now}},
            upsert=True,
        )
    except Exception:  # noqa: BLE001 - xem docstring
        logger.warning("Không lưu được hội thoại Lecter cho thread %s", thread_id, exc_info=True)


def _scope(user_id: str, agent_id: str, workspace_id: str | None) -> dict:
    """Bộ lọc của mọi truy vấn lịch sử. `userId` và `workspaceId` luôn đi cùng nhau — bỏ một
    trong hai là hội thoại của nhóm khác (hoặc của người khác) lọt vào danh sách."""
    scope = {"userId": user_id, "agentId": agent_id}
    if workspace_id:
        scope["workspaceId"] = workspace_id
    return scope


async def listing(
    db,
    user_id: str,
    *,
    agent_id: str,
    workspace_id: str | None = None,
    limit: int = 30,
    include: tuple[str, ...] = (),
) -> list[dict]:
    """`include`: tên các trường phụ đi kèm mỗi dòng — thứ `save(extra=…)` đã ghi xuống.

    Danh sách trắng chứ không trả nguyên bản ghi: `messages` phải ở ngoài (nặng), và một dòng
    lịch sử không nên mang theo mọi thứ bề mặt khác lỡ ghi vào cùng collection.
    """
    cursor = (
        db["ai_agent_sessions"]
        .find(_scope(user_id, agent_id, workspace_id), {"messages": 0})
        .sort("updatedAt", -1)
        .limit(limit)
    )
    return [
        {
            # Hàng cũ (trước khi có `threadId`) vẫn đọc được: khoá của chúng là
            # `"lecter:<threadId>"`, và phần sau dấu hai chấm đầu tiên chính là thread.
            "id": doc.get("threadId") or doc["_id"].split(":", 1)[1],
            "title": doc.get("title") or "Hội thoại mới",
            "updatedAt": doc["updatedAt"].isoformat(),
            **{key: doc[key] for key in include if key in doc},
        }
        async for doc in cursor
    ]


async def read(
    db, user_id: str, thread_id: str, *, agent_id: str, workspace_id: str | None = None
) -> dict | None:
    doc = await db["ai_agent_sessions"].find_one(
        {
            "_id": _doc_id(agent_id, workspace_id, thread_id),
            **_scope(user_id, agent_id, workspace_id),
        }
    )
    if not doc:
        return None
    return {
        "id": thread_id,
        "title": doc.get("title") or "Hội thoại mới",
        "messages": doc.get("messages") or [],
        "updatedAt": doc["updatedAt"].isoformat(),
    }


async def remove(
    db, user_id: str, thread_id: str, *, agent_id: str, workspace_id: str | None = None
) -> bool:
    result = await db["ai_agent_sessions"].delete_one(
        {
            "_id": _doc_id(agent_id, workspace_id, thread_id),
            **_scope(user_id, agent_id, workspace_id),
        }
    )
    return result.deleted_count > 0
