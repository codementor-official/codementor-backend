"""Phần RAG còn lại sau khi hỏi đáp chuyển sang `app/tutor`: provider embedding và route nội bộ
mà workspace-service gọi. Luật đối chiếu trích dẫn nằm ở `tests/test_tutor.py`."""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.config import Settings
from app.main import app, settings
from app.models import InternalRequest
from app.provider import OpenAIProvider


def request(**overrides):
    return InternalRequest(userId=uuid4(), workspaceId=uuid4(), **overrides)


def test_unknown_internal_payload_fields_rejected():
    with pytest.raises(ValidationError):
        request(admin=True)


async def test_missing_key_does_not_call_network():
    provider = OpenAIProvider(Settings(_env_file=None))
    with pytest.raises(HTTPException) as error:
        await provider.embed(["test"])
    assert error.value.status_code == 503
    assert provider.client is None


async def test_openai_embedding_payload_uses_requested_model():
    config = Settings(_env_file=None, openai_api_key="not-a-real-key")
    provider = OpenAIProvider(config)
    await provider.client.close()
    provider.client = AsyncMock()
    response = type(
        "Response", (), {"data": [type("Row", (), {"index": 0, "embedding": [0.1] * 1536})()]}
    )()
    provider.client.embeddings.create.return_value = response
    result = await provider.embed(["Stack"])
    assert len(result[0]) == 1536
    assert provider.client.embeddings.create.call_args.kwargs["model"] == "text-embedding-3-small"


def test_internal_http_auth_and_missing_key(monkeypatch):
    monkeypatch.setattr(
        settings, "internal_service_token", SecretStr("test-only-internal-token-123456")
    )
    monkeypatch.setattr(settings, "openai_api_key", SecretStr(""))
    with TestClient(app) as client:
        path = "/api/v1/internal/workspace-ai/status"
        body = {"userId": str(uuid4()), "workspaceId": str(uuid4())}
        assert client.post(path, json=body).status_code == 401
        headers = {"x-internal-service-token": "test-only-internal-token-123456"}
        result = client.post(path, json=body, headers=headers)
        assert result.status_code == 200
        assert result.json()["data"]["chatModel"] == "gpt-5-nano"
        assert result.json()["data"]["configured"] is False
        invalid = client.post(path, json={**body, "injected": "secret-text"}, headers=headers)
        assert invalid.status_code == 400
        assert "secret-text" not in invalid.text
        # Hỏi đáp đã sang `/api/v1/ai/tutor`: đường nội bộ cũ không còn trả lời câu hỏi nào.
        for action in ("ask", "create", "list", "read"):
            gone = client.post(f"/api/v1/internal/workspace-ai/{action}", json=body, headers=headers)
            assert gone.status_code == 400
