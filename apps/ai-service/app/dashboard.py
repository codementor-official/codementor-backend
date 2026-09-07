"""Authenticated dashboard coaching. Sources are read by the service, never trusted from FE."""

import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app import budget
from app.auth import require_user
from app.config import settings
from app.dashboard_prompt import INSTRUCTIONS

router = APIRouter(prefix="/api/v1/ai/dashboard")


class Step(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidateId: str
    reason: str = Field(max_length=500)
    task: str = Field(max_length=500)


class Insight(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str = Field(min_length=1, max_length=1000)
    focus: str = Field(min_length=1, max_length=600)
    steps: list[Step] = Field(max_length=3)


class Visibility(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hidden: bool


def response_from(cached, pref_hash, now, configured=True):
    valid = cached and cached.get("preferencesHash") == pref_hash
    insight = cached.get("insight") if valid else None
    status = "hidden" if insight and cached.get("hiddenAt") else "ready" if insight else "empty"
    return {
        "data": {
            "status": status,
            "insight": insight,
            "generatedAt": cached.get("generatedAt").isoformat() if insight else None,
            "appliedAt": cached.get("appliedAt").isoformat()
            if insight and cached.get("appliedAt")
            else None,
            "stale": bool(insight and cached["expiresAt"] <= now),
            "configured": configured,
        }
    }


async def read(client, base, path):
    try:
        response = await client.get(f"{base.rstrip('/')}/api/v1{path}")
        if response.status_code in (401, 403):
            raise HTTPException(response.status_code, "Không có quyền đọc dữ liệu học tập.")
        response.raise_for_status()
        return response.json()["data"]
    except (httpx.HTTPError, KeyError, ValueError):
        raise HTTPException(503, "Chưa đọc được dữ liệu học tập. Vui lòng thử lại.") from None


def candidates_from(learning, recommendations):
    candidates = []
    for item in learning.get("courses") or []:
        if item["status"] == "active":
            candidates.append(
                {
                    "id": item["courseId"],
                    "title": item["title"],
                    "href": f"/courses/{item['courseId']}",
                    "progress": item["progressPercent"],
                }
            )
    for item in recommendations.get("items", []):
        candidates.append(
            {
                "id": item["id"],
                "title": item["title"],
                "href": f"/solve/{item['id']}",
                "reasons": item.get("reasons", []),
            }
        )
    return candidates[:8]


def validated_steps(raw, candidates):
    insight = Insight.model_validate(raw)
    allowed = {item["id"]: item for item in candidates}
    steps, seen = [], set()
    for step in insight.steps:
        if step.candidateId not in allowed or step.candidateId in seen:
            continue
        seen.add(step.candidateId)
        item = allowed[step.candidateId]
        steps.append(
            {"title": item["title"], "href": item["href"], "reason": step.reason, "task": step.task}
        )
    return {"summary": insight.summary, "focus": insight.focus, "steps": steps}


async def execute(request, claims, generate):
    state = request.app.state
    now = datetime.now(UTC)
    async with httpx.AsyncClient(
        headers={"Authorization": f"Bearer {request.state.access_token}"}, timeout=12
    ) as client:
        preferences = await read(client, settings.core_service_url, "/me/preferences")
        if not preferences.get("adaptiveRecommendations", False):
            return {"data": {"status": "disabled", "insight": None}}
        pref_hash = hashlib.sha256(json.dumps(preferences, sort_keys=True).encode()).hexdigest()
        collection = state.db["dashboard_insights"]
        cached = await collection.find_one({"_id": claims["sub"]})
        if not generate:
            return response_from(cached, pref_hash, now, settings.configured)

        state.provider.require_configured()
        learning, recommendations = await asyncio.gather(
            read(client, settings.learning_service_url, "/activity/me/dashboard"),
            read(client, settings.recommendation_service_url, "/recommendations/exercises?limit=4"),
        )
    if learning.get("calendar") is None or learning.get("courses") is None:
        raise HTTPException(503, "Dữ liệu tiến độ chưa đầy đủ để phân tích.")
    candidates = candidates_from(learning, recommendations)
    calendar = learning["calendar"]
    # Only minimum learning metadata is sent to the model; no email, token or profile name.
    payload = {
        "goal": preferences.get("learningGoal"),
        "weeklyStudyHours": preferences.get("weeklyStudyHours"),
        "currentLevel": preferences.get("currentLevel"),
        "topics": preferences.get("interestedTechnologies", []),
        "recentDays": calendar["days"][-14:],
        "candidates": candidates,
    }
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    if (
        cached
        and cached.get("fingerprint") == fingerprint
        and cached.get("preferencesHash") == pref_hash
        and cached.get("expiresAt", now) > now
    ):
        return response_from(cached, pref_hash, now)
    try:
        await collection.update_one(
            {"_id": claims["sub"]}, {"$setOnInsert": {"createdAt": now}}, upsert=True
        )
    except DuplicateKeyError:
        pass  # A simultaneous request has created the user's cache record.
    lock = await collection.find_one_and_update(
        {
            "_id": claims["sub"],
            "$or": [{"busyUntil": {"$exists": False}}, {"busyUntil": {"$lte": now}}],
        },
        {"$set": {"busyUntil": now + timedelta(minutes=4)}},
        return_document=ReturnDocument.AFTER,
    )
    if not lock:
        raise HTTPException(409, "AI đang phân tích. Vui lòng đợi kết quả hiện tại.")
    try:
        await budget.consume(
            state.db, claims["sub"], "dashboard", settings.ai_dashboard_daily_limit
        )
        raw = await state.provider.complete_json(
            INSTRUCTIONS,
            json.dumps(payload, ensure_ascii=False),
            "dashboard_coach",
            Insight.model_json_schema(),
            max_output_tokens=2500,
        )
        try:
            insight = validated_steps(raw, candidates)
        except ValueError:
            raise HTTPException(502, "AI trả về kết quả chưa hợp lệ. Vui lòng thử lại.") from None
        await collection.update_one(
            {"_id": claims["sub"]},
            {
                "$set": {
                    "insight": insight,
                    "fingerprint": fingerprint,
                    "preferencesHash": pref_hash,
                    "generatedAt": now,
                    "expiresAt": now + timedelta(hours=6),
                },
                "$unset": {"hiddenAt": "", "appliedAt": ""},
            },
        )
        saved = await collection.find_one({"_id": claims["sub"]})
        return response_from(saved, pref_hash, now)
    finally:
        await collection.update_one({"_id": claims["sub"]}, {"$unset": {"busyUntil": ""}})


@router.get("/insight")
async def current(request: Request, claims: dict = Depends(require_user)):
    return await execute(request, claims, False)


@router.post("/insight")
async def generate(request: Request, claims: dict = Depends(require_user)):
    return await execute(request, claims, True)


@router.post("/insight/apply")
async def apply_insight(request: Request, claims: dict = Depends(require_user)):
    now = datetime.now(UTC)
    collection = request.app.state.db["dashboard_insights"]
    saved = await collection.find_one_and_update(
        {"_id": claims["sub"], "insight": {"$exists": True}},
        {"$set": {"appliedAt": now}, "$unset": {"hiddenAt": ""}},
        return_document=ReturnDocument.AFTER,
    )
    if not saved:
        raise HTTPException(404, "Chưa có phân tích để áp dụng.")
    return response_from(saved, saved.get("preferencesHash"), now, settings.configured)


@router.delete("/insight/apply")
async def remove_applied_insight(request: Request, claims: dict = Depends(require_user)):
    now = datetime.now(UTC)
    collection = request.app.state.db["dashboard_insights"]
    saved = await collection.find_one_and_update(
        {"_id": claims["sub"], "insight": {"$exists": True}},
        {"$unset": {"appliedAt": ""}},
        return_document=ReturnDocument.AFTER,
    )
    if not saved:
        raise HTTPException(404, "Chưa có phân tích để bỏ áp dụng.")
    return response_from(saved, saved.get("preferencesHash"), now, settings.configured)


@router.patch("/insight/visibility")
async def visibility(body: Visibility, request: Request, claims: dict = Depends(require_user)):
    collection = request.app.state.db["dashboard_insights"]
    update = (
        {"$set": {"hiddenAt": datetime.now(UTC)}} if body.hidden else {"$unset": {"hiddenAt": ""}}
    )
    saved = await collection.find_one_and_update(
        {"_id": claims["sub"], "insight": {"$exists": True}},
        update,
        return_document=ReturnDocument.AFTER,
    )
    if not saved:
        raise HTTPException(404, "Chưa có phân tích để thay đổi hiển thị.")
    return {"data": {"hidden": body.hidden}}
