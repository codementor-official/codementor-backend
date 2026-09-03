from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.config import Settings
from app.main import app, settings
from app.models import GroundedAnswer, InternalRequest
from app.provider import OpenAIProvider
from app.rag import RagService, grounded_turn, validate_sources


def request(**overrides):
    return InternalRequest(
        userId=uuid4(),
        workspaceId=uuid4(),
        requestId=uuid4(),
        question="Stack là gì?",
        **overrides,
    )


def test_invented_source_fails_closed():
    turn = grounded_turn(
        request(),
        {"sourceQuotes": [{"sourceId": "S99", "quote": "Fake"}], "insufficientEvidence": False},
        [],
    )
    assert turn["insufficientEvidence"]
    assert turn["citations"] == []
    assert "Fake" not in turn["answer"]


def test_valid_citation_contains_real_excerpt_and_page():
    source = {"documentId": str(uuid4()), "title": "Stack", "page": 2, "text": "LIFO"}
    turn = grounded_turn(
        request(),
        {"sourceQuotes": [{"sourceId": "S1", "quote": "LIFO"}], "insufficientEvidence": False},
        [source],
    )
    assert not turn["insufficientEvidence"]
    assert turn["citations"][0]["excerpt"] == "LIFO"
    assert turn["citations"][0]["page"] == 2


def test_missing_or_revised_sources_blocks_old_conversation():
    row = {"sources": [{"id": "one", "revision": "v1"}]}
    with pytest.raises(HTTPException):
        validate_sources(row, [])
    with pytest.raises(HTTPException):
        validate_sources(row, [{"id": "one", "revision": "v2"}])
    validate_sources(row, [{"id": "one", "revision": "v1"}])


def test_unknown_internal_payload_fields_rejected():
    with pytest.raises(ValidationError):
        request(admin=True)


def test_schema_forbids_unexpected_model_output_fields():
    schema = GroundedAnswer.model_json_schema()
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {
        "sourceQuotes",
        "supplementalAnswer",
        "insufficientEvidence",
    }


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


async def test_openai_response_payload_does_not_send_unbounded_history():
    config = Settings(_env_file=None, openai_api_key="not-a-real-key")
    provider = OpenAIProvider(config)
    await provider.client.close()
    provider.client = AsyncMock()
    provider.client.responses.create.return_value = type(
        "Result",
        (),
        {
            "status": "completed",
            "output_text": '{"sourceQuotes":[{"sourceId":"S1","quote":"LIFO"}],"supplementalAnswer":"Stack lấy phần tử cuối trước.","insufficientEvidence":false}',
        },
    )()
    await provider.answer("Stack?", [{"id": "S1", "text": "LIFO"}], [])
    payload = provider.client.responses.create.call_args.kwargs
    assert payload["model"] == "gpt-5-nano"
    assert payload["store"] is False
    assert payload["reasoning"] == {"effort": "low"}
    assert payload["text"]["verbosity"] == "low"
    assert "temperature" not in payload


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


def test_request_id_is_bound_to_question():
    req = request()
    with pytest.raises(HTTPException):
        RagService.replay({"question": "Different"}, req)


def test_related_explanation_is_retained_separately_without_document_citations():
    turn = grounded_turn(
        request(),
        {
            "sourceQuotes": [],
            "supplementalAnswer": "Ví dụ minh họa: Stack lấy phần tử cuối trước.",
            "insufficientEvidence": True,
        },
        [],
    )
    assert turn["insufficientEvidence"]
    assert turn["citations"] == []
    assert "Stack" in turn["supplementalAnswer"]
    assert "kiến thức mở rộng" in turn["answer"]


def test_mixed_response_keeps_source_claim_and_extra_example_distinct():
    turn = grounded_turn(
        request(),
        {
            "sourceQuotes": [{"sourceId": "S1", "quote": "LIFO"}],
            "supplementalAnswer": "Ví dụ minh họa: xếp chồng đĩa.",
            "insufficientEvidence": False,
        },
        [{"documentId": "one", "title": "Stack", "page": 1, "text": "LIFO"}],
    )
    assert turn["citations"][0]["excerpt"] == "LIFO"
    assert "đĩa" not in turn["answer"]
    assert "đĩa" in turn["supplementalAnswer"]


def test_supplement_cannot_misuse_source_markers():
    turn = grounded_turn(
        request(),
        {
            "sourceQuotes": [],
            "supplementalAnswer": "Unverified claim [S1]",
            "insufficientEvidence": True,
        },
        [],
    )
    assert turn["supplementalAnswer"] == ""
    assert turn["citations"] == []


def test_unrelated_or_missing_private_fact_still_abstains():
    turn = grounded_turn(
        request(),
        {
            "sourceQuotes": [],
            "supplementalAnswer": "",
            "insufficientEvidence": True,
        },
        [],
    )
    assert turn["supplementalAnswer"] == ""
    assert "chưa có thông tin" in turn["answer"]


def test_correct_source_id_does_not_allow_invented_quote():
    turn = grounded_turn(
        request(),
        {
            "sourceQuotes": [{"sourceId": "S1", "quote": "Trọng số cạnh không âm."}],
            "supplementalAnswer": "Kiến thức bổ sung: Dijkstra cần trọng số không âm.",
            "insufficientEvidence": False,
        },
        [{"documentId": "one", "title": "Dijkstra", "page": 1, "text": "Giải thích relaxation và priority queue."}],
    )
    assert turn["insufficientEvidence"]
    assert turn["citations"] == []
    assert "Trọng số cạnh" not in turn["answer"]
    assert "Dijkstra" in turn["supplementalAnswer"]


def test_literal_quote_validation_accepts_wrapped_document_text():
    turn = grounded_turn(
        request(),
        {
            "sourceQuotes": [{"sourceId": "S1", "quote": "Stack dùng LIFO."}],
            "supplementalAnswer": "Stack lấy phần tử cuối trước.",
            "insufficientEvidence": False,
        },
        [{"documentId": "one", "title": "Stack", "page": 1, "text": "Stack dùng\nLIFO."}],
    )
    assert turn["answer"] == "> Stack dùng LIFO. [S1]"
    assert len(turn["citations"]) == 1
