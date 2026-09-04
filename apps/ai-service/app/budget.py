"""Hạn mức AI theo ngày, một chỗ cho mọi bề mặt.

Tách khỏi `rag.py` khi có bề mặt thứ hai: gợi ý testcase gọi model nhiều lần hơn hỏi đáp tài
liệu, và trộn chung một bộ đếm nghĩa là một người soạn bài dùng hết lượt của chính họ ở AI
Tutor. Khoá mang `kind` nên mỗi bề mặt có ngân sách riêng.
"""

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError


def _now() -> datetime:
    return datetime.now(UTC)


async def consume(db, user_id: str, kind: str, limit: int, cost: int = 1) -> None:
    """Tăng bộ đếm của (user, kind, ngày UTC) và 429 khi vượt hạn mức."""
    key = f"{user_id}:{kind}:{_now().date().isoformat()}"
    update = {"$inc": {"count": cost}, "$setOnInsert": {"expiresAt": _now() + timedelta(days=3)}}
    try:
        usage = await db["ai_usage"].find_one_and_update(
            {"_id": key}, update, upsert=True, return_document=ReturnDocument.AFTER
        )
    except DuplicateKeyError:
        usage = await db["ai_usage"].find_one_and_update(
            {"_id": key}, {"$inc": {"count": cost}}, return_document=ReturnDocument.AFTER
        )
    if usage["count"] > limit:
        raise HTTPException(
            429, "Bạn đã dùng hết lượt AI hôm nay. Vui lòng thử lại vào ngày mai (UTC)."
        )
