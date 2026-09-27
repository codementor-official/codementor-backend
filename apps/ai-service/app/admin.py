"""Số liệu cho trang Vận hành AI bên admin: `GET /api/v1/ai/admin/stats`.

Đọc `ai_call_events` (do `telemetry.py` ghi, giữ 90 ngày) cùng hai collection hội thoại. Số liệu
chỉ có từ lúc telemetry được deploy; hội thoại có TTL nên số hội thoại chỉ đúng trong thời gian
chúng còn được giữ.
"""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth import require_admin
from app.config import settings
from app.telemetry import COLLECTION

router = APIRouter(prefix="/api/v1/ai/admin")

TIMEZONE = "Asia/Ho_Chi_Minh"
AGENTS = ["codey", "lecter", "lecter_workspace", "rag", "rag_index", "suggest", "dashboard"]
RECENT_ERRORS = 20
# Lời gọi model = sự kiện có `model`. Chặn hạn mức và run hỏng không có model.
IS_CALL = {"$ne": ["$model", None]}
IS_ERROR = {"$and": [{"$eq": ["$ok", False]}, {"$ne": ["$errorType", "daily_limit"]}]}


def window_start(days: int, today: date) -> datetime:
    """00:00 giờ Việt Nam của (hôm nay − days + 1): chuỗi theo ngày có đúng `days` cột."""
    first = today - timedelta(days=days - 1)
    return datetime(first.year, first.month, first.day, tzinfo=ZoneInfo(TIMEZONE)).astimezone(UTC)


def fill_daily(rows: list[dict], days: int, today: date) -> list[dict]:
    """Ngày không có sự kiện nào vẫn phải có cột (bằng 0), nếu không trục thời gian bị co lại."""
    by_date = {row["_id"]: row for row in rows}
    series = []
    for offset in range(days - 1, -1, -1):
        key = (today - timedelta(days=offset)).isoformat()
        row = by_date.get(key, {})
        series.append(
            {
                "date": key,
                "tokens": row.get("tokens", 0),
                "calls": row.get("calls", 0),
                "errors": row.get("errors", 0),
            }
        )
    return series


def merge_agents(stats: list[dict], sessions: dict[str, int]) -> list[dict]:
    """Mọi agent đều có một dòng, kể cả agent chưa từng được gọi — bảng không đổi hình dạng."""
    by_agent = {row["_id"]: row for row in stats}
    rows = []
    for agent in AGENTS:
        row = by_agent.get(agent, {})
        latency = row.get("latency") or [None, None]
        rows.append(
            {
                "agent": agent,
                "calls": row.get("calls", 0),
                "errors": row.get("errors", 0),
                "limitHits": row.get("limitHits", 0),
                "inputTokens": row.get("inputTokens", 0),
                "outputTokens": row.get("outputTokens", 0),
                "users": len([user for user in row.get("users", []) if user]),
                "p50LatencyMs": round(latency[0]) if latency[0] is not None else None,
                "p95LatencyMs": round(latency[1]) if latency[1] is not None else None,
                # `rag_index`, `suggest`, `dashboard` không có khái niệm hội thoại.
                "conversations": sessions.get(agent),
            }
        )
    return rows


async def aggregate(collection, pipeline: list[dict]) -> list[dict]:
    # pymongo async: `aggregate` là coroutine trả về cursor, cursor mới có `to_list`.
    return await (await collection.aggregate(pipeline)).to_list()


def runtime_config() -> dict:
    """Cấu hình đang chạy, chỉ đọc. Không bao giờ trả khoá — chỉ `configured`."""
    return {
        "configured": settings.configured,
        "chatModel": settings.openai_chat_model,
        "smartModel": settings.smart_model,
        "embeddingModel": settings.openai_embedding_model,
        "codeyReasoningEffort": settings.ai_codey_reasoning_effort,
        "dailyLimits": {
            "codey": settings.ai_codey_daily_limit,
            "lecter": settings.ai_lecter_daily_limit,
            "lecter_workspace": settings.ai_lecter_workspace_daily_limit,
            "rag": settings.ai_daily_request_limit,
            "suggest": settings.ai_suggest_daily_limit,
            "dashboard": settings.ai_dashboard_daily_limit,
        },
    }


@router.get("/stats")
async def stats(
    request: Request,
    # `int` rồi kiểm tay: `Literal[7, 30]` không ép chuỗi query "7" thành số.
    days: int = Query(7),
    _claims: dict = Depends(require_admin),
):
    if days not in (7, 30):
        raise HTTPException(400, "days chỉ nhận 7 hoặc 30.")
    db = request.app.state.db
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    since = window_start(days, today)
    events = db[COLLECTION]

    per_agent = await aggregate(
        events,
        [
            {"$match": {"at": {"$gte": since}}},
            {
                "$group": {
                    "_id": "$agent",
                    "calls": {"$sum": {"$cond": [IS_CALL, 1, 0]}},
                    "errors": {"$sum": {"$cond": [IS_ERROR, 1, 0]}},
                    "limitHits": {"$sum": {"$cond": [{"$eq": ["$errorType", "daily_limit"]}, 1, 0]}},
                    "inputTokens": {"$sum": {"$ifNull": ["$inputTokens", 0]}},
                    "outputTokens": {"$sum": {"$ifNull": ["$outputTokens", 0]}},
                    "users": {"$addToSet": "$userId"},
                    # Chỉ độ trễ của lời gọi model: sự kiện hạn mức có latency 0 kéo p50 về 0.
                    "latency": {
                        "$percentile": {
                            "input": {"$cond": [IS_CALL, "$latencyMs", None]},
                            "p": [0.5, 0.95],
                            "method": "approximate",
                        }
                    },
                }
            },
        ],
    )

    daily = await aggregate(
        events,
        [
            {"$match": {"at": {"$gte": since}}},
            {
                "$group": {
                    "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$at", "timezone": TIMEZONE}},
                    "tokens": {
                        "$sum": {
                            "$add": [
                                {"$ifNull": ["$inputTokens", 0]},
                                {"$ifNull": ["$outputTokens", 0]},
                            ]
                        }
                    },
                    "calls": {"$sum": {"$cond": [IS_CALL, 1, 0]}},
                    "errors": {"$sum": {"$cond": [IS_ERROR, 1, 0]}},
                }
            },
        ],
    )

    sessions = {
        row["_id"]: row["count"]
        for row in await aggregate(
            db["ai_agent_sessions"],
            [
                {"$match": {"createdAt": {"$gte": since}}},
                {"$group": {"_id": "$agentId", "count": {"$sum": 1}}},
            ],
        )
    }
    sessions["rag"] = await db["ai_conversations"].count_documents({"createdAt": {"$gte": since}})

    recent_errors = await (
        events.find(
            {"at": {"$gte": since}, "ok": False, "errorType": {"$ne": "daily_limit"}},
            {"_id": 0, "at": 1, "agent": 1, "model": 1, "errorType": 1, "errorMessage": 1},
        )
        .sort("at", -1)
        .limit(RECENT_ERRORS)
        .to_list()
    )

    return {
        "data": {
            "days": days,
            "agents": merge_agents(per_agent, sessions),
            "daily": fill_daily(daily, days, today),
            "recentErrors": [{**row, "at": row["at"].isoformat()} for row in recent_errors],
            "config": runtime_config(),
        }
    }
