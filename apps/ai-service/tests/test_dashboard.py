from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app import dashboard


def test_steps_only_link_to_server_candidates():
    raw = {
        "summary": "Nhịp học",
        "focus": "Ôn tập",
        "steps": [
            {"candidateId": "safe", "reason": "Tiếp tục", "task": "Học bài"},
            {"candidateId": "safe", "reason": "Trùng", "task": "Học lại"},
            {"candidateId": "https://evil.test", "reason": "Lạ", "task": "Mở link"},
        ],
    }
    result = dashboard.validated_steps(
        raw, [{"id": "safe", "title": "Khóa học", "href": "/courses/safe"}]
    )
    assert len(result["steps"]) == 1
    assert result["steps"][0]["href"] == "/courses/safe"


def test_extra_model_fields_rejected():
    with pytest.raises(ValidationError):
        dashboard.validated_steps(
            {"summary": "x", "focus": "y", "steps": [], "userId": "other"}, []
        )


def test_candidates_do_not_include_completed_courses():
    learning = {
        "courses": [
            {"courseId": "done", "status": "completed"},
            {"courseId": "ongoing", "status": "active", "title": "A", "progressPercent": 50},
        ]
    }
    assert [item["id"] for item in dashboard.candidates_from(learning, {"items": []})] == [
        "ongoing"
    ]


def test_response_keeps_plan_lifecycle_on_matching_preferences():
    now = dashboard.datetime.now(dashboard.UTC)
    cached = {
        "preferencesHash": "same",
        "insight": {"summary": "x", "focus": "y", "steps": []},
        "generatedAt": now,
        "expiresAt": now + dashboard.timedelta(hours=1),
        "hiddenAt": now,
        "appliedAt": now,
    }
    response = dashboard.response_from(cached, "same", now)
    assert response["data"]["status"] == "hidden"
    assert response["data"]["appliedAt"] is not None
    assert dashboard.response_from(cached, "changed", now)["data"]["insight"] is None


@pytest.mark.asyncio
async def test_opt_out_never_reads_cache_or_calls_provider(monkeypatch):
    read = AsyncMock(return_value={"adaptiveRecommendations": False})
    monkeypatch.setattr(dashboard, "read", read)
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(rag=SimpleNamespace())),
        state=SimpleNamespace(access_token="test"),
    )
    result = await dashboard.execute(request, {"sub": "user"}, True)
    assert result["data"]["status"] == "disabled"
    assert read.await_count == 1
