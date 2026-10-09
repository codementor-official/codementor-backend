"""Jev trong Tutor: tuỳ chọn, và không bao giờ làm hỏng một lượt.

Ba yêu cầu cứng: thiếu key thì service vẫn start (chỉ warning); lỗi Jev lúc chạy (429, 529, mạng,
timeout, phản hồi sai) chỉ log rồi rơi về luồng không Jev; và khi Jev trả lời được thì ba node
gate / rerank / sufficiency làm đúng việc của chúng.
"""

import json
import logging

import httpx
import pytest
from langchain_core.messages import AIMessage, HumanMessage

import app.graph as graph_module
from app import telemetry
from app.lecter import http
from app.tutor import graph as tutor_graph
from app.tutor import jev as jev_module
from app.tutor import jev_policy as policy
from app.tutor.answer import EXPLAIN, QUOTES
from app.tutor.capability import TUTOR
from tests.test_tutor import DOC, FakeIndex, config, state, statuses


@pytest.fixture(autouse=True)
def no_retry_delay(monkeypatch):
    monkeypatch.setattr(jev_module, "RETRY_DELAY", 0)


# --- cấu hình ---------------------------------------------------------------------------------


def test_missing_key_is_a_warning_not_an_error(caplog):
    with caplog.at_level(logging.WARNING, logger="codementor.ai"):
        assert jev_module.from_settings("") is None
        assert jev_module.from_settings("   ") is None
    assert "TYPESAFE_API_KEY" in caplog.text


def test_service_starts_without_jev_key(monkeypatch):
    from fastapi.testclient import TestClient
    from pydantic import SecretStr

    from app.main import app, settings

    monkeypatch.setattr(settings, "typesafe_api_key", SecretStr(""))
    with TestClient(app) as client:
        assert client.get("/api/v1/health").status_code == 200
        assert app.state.jev is None


# --- client: mọi lỗi thành `None` + warning ----------------------------------------------------


def client_with(handler):
    client = jev_module.JevClient("test-key")
    client.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return client


QUESTIONS = {"ok": {"type": "noul", "instructions": "?"}}
GOOD = {"answers": {"ok": {"type": "noul", "noul": 0.9}}, "usage": {"input_tokens": 300, "output_tokens": 20}}


@pytest.mark.parametrize(
    "respond",
    [
        lambda request: httpx.Response(429, json={"error": "rate"}),
        lambda request: httpx.Response(529, json={"error": "overloaded"}),
        lambda request: httpx.Response(200, text="không phải json"),
        lambda request: httpx.Response(200, json={"answers": {}}),
    ],
    ids=["rate-limit", "overloaded", "bad-json", "missing-answers"],
)
async def test_runtime_errors_return_none_and_warn(respond, caplog, monkeypatch):
    events = []
    monkeypatch.setattr(telemetry, "record", lambda **fields: events.append(fields))
    with caplog.at_level(logging.WARNING, logger="codementor.ai"):
        assert await client_with(respond).ask("rerank", {}, QUESTIONS) is None
    assert "Jev rerank lỗi" in caplog.text
    assert events and events[-1]["ok"] is False and events[-1]["errorType"].startswith("jev_")


async def test_network_and_timeout_are_retried_once_then_dropped(caplog):
    calls = []

    def broken(request):
        calls.append(request)
        raise httpx.ConnectError("không có mạng", request=request)

    with caplog.at_level(logging.WARNING, logger="codementor.ai"):
        assert await client_with(broken).ask("gate", {}, QUESTIONS) is None
    assert len(calls) == 2

    def slow(request):
        raise httpx.ReadTimeout("chậm", request=request)

    assert await client_with(slow).ask("gate", {}, QUESTIONS) is None


async def test_client_errors_are_not_retried():
    calls = []

    def invalid(request):
        calls.append(request)
        return httpx.Response(422, json={"detail": "questions.ok.instructions"})

    assert await client_with(invalid).ask("gate", {}, QUESTIONS) is None
    assert len(calls) == 1


async def test_transient_error_then_success(monkeypatch):
    monkeypatch.setattr(telemetry, "record", lambda **_fields: None)
    responses = iter([httpx.Response(529), httpx.Response(200, json=GOOD)])
    answers = await client_with(lambda request: next(responses)).ask("gate", {}, QUESTIONS)
    assert answers == GOOD["answers"]


async def test_request_shape():
    seen = {}

    def capture(request):
        seen.update(json.loads(request.content), auth=request.headers["authorization"])
        return httpx.Response(200, json=GOOD)

    await client_with(capture).ask("gate", {"question": "x"}, QUESTIONS)
    assert seen["model"] == "jev-1.13.0"
    assert seen["auth"] == "Bearer test-key"
    assert seen["questions"] == QUESTIONS


# --- ba node trong graph ----------------------------------------------------------------------


class FakeJev:
    """Trả lời theo node; `None` cho node nào thì node đó coi như Jev hỏng."""

    def __init__(self, gate=None, rerank=None, sufficiency=None):
        self.answers = {"gate": gate, "rerank": rerank, "sufficiency": sufficiency}
        self.calls = []

    async def ask(self, node, jev_state, questions):
        self.calls.append((node, jev_state, questions))
        answer = self.answers[node]
        return answer(questions) if callable(answer) else answer


def route(**probabilities):
    choice = max(probabilities, key=probabilities.get)
    return {"route": {"choice": choice, "probabilities": probabilities}}


IN_SCOPE = route(in_scope=0.95, chitchat=0.0, out_of_scope=0.05, unsafe=0.0)


def matches(n):
    return [
        {"text": f"đoạn {i}", "page": i + 1, "documentId": DOC, "title": "Python"} for i in range(n)
    ]


class Model:
    def __init__(self, text):
        self.text = text
        self.payloads = []

    async def ainvoke(self, messages, _config=None):
        self.payloads.append(messages[-1].content)
        return AIMessage(self.text, id="answer")


async def run(monkeypatch, jev, n=10, text=None):
    monkeypatch.setattr(tutor_graph, "POLL_SECONDS", 0)
    monkeypatch.setattr(http, "workspace", statuses("ready"))
    model = Model(text or f"{QUOTES}\n> đoạn 1 [S1]\n{EXPLAIN}\nGiải thích.")
    monkeypatch.setattr(graph_module, "ChatOpenAI", lambda **_kwargs: model)
    index = FakeIndex(matches(n))
    cfg = config(index)
    cfg["configurable"]["jev"] = jev
    result = await tutor_graph.build(TUTOR).ainvoke(state(), cfg)
    return result, model, index


async def test_out_of_scope_is_refused_before_retrieval_and_llm(monkeypatch):
    jev = FakeJev(gate=route(in_scope=0.05, chitchat=0.05, out_of_scope=0.9, unsafe=0.0))
    result, model, index = await run(monkeypatch, jev)
    assert model.payloads == [] and index.calls == []
    assert result["grounding"]["user-1"]["answer"] == policy.REFUSE_OUT_OF_SCOPE
    assert isinstance(result["messages"][-1], AIMessage)


async def test_unsafe_is_refused(monkeypatch):
    jev = FakeJev(gate=route(in_scope=0.3, chitchat=0.0, out_of_scope=0.1, unsafe=0.6))
    result, model, _ = await run(monkeypatch, jev)
    assert model.payloads == []
    assert result["grounding"]["user-1"]["answer"] == policy.REFUSE_UNSAFE


async def test_rerank_filters_sorts_and_renumbers(monkeypatch):
    scores = [0.1, 0.9, 0.2, 0.7, 0.95, 0.0, 0.0, 0.0, 0.0, 0.0]
    jev = FakeJev(
        gate=IN_SCOPE,
        rerank={f"p{i}": {"noul": p} for i, p in enumerate(scores)},
        sufficiency={"sufficient": {"noul": 0.9}},
    )
    result, model, index = await run(monkeypatch, jev)
    assert index.calls[0][3] == policy.RETRIEVE_K  # có Jev thì lấy rộng
    assert [s["excerpt"] for s in result["sources"]] == ["đoạn 4", "đoạn 1", "đoạn 3"]
    assert [s["sourceId"] for s in result["sources"]] == ["S1", "S2", "S3"]
    assert tutor_graph.INSUFFICIENT_NOTE not in model.payloads[0]
    assert result["jev"]["sufficiency"] == 0.9


async def test_nothing_relevant_keeps_a_few_for_explanation_and_flags_it(monkeypatch):
    jev = FakeJev(gate=IN_SCOPE, rerank=lambda questions: {key: {"noul": 0.1} for key in questions})
    result, model, _ = await run(monkeypatch, jev)
    assert len(result["sources"]) == policy.FALLBACK_KEEP
    assert tutor_graph.INSUFFICIENT_NOTE in model.payloads[0]
    # sufficiency không cần hỏi lại khi rerank đã kết luận
    assert [call[0] for call in jev.calls] == ["gate", "rerank"]


async def test_low_sufficiency_tells_the_model(monkeypatch):
    jev = FakeJev(
        gate=IN_SCOPE,
        rerank=lambda questions: {key: {"noul": 0.9} for key in questions},
        sufficiency={"sufficient": {"noul": 0.4}},
    )
    _, model, _ = await run(monkeypatch, jev)
    assert tutor_graph.INSUFFICIENT_NOTE in model.payloads[0]


async def test_every_jev_failure_falls_back_to_the_plain_pipeline(monkeypatch):
    """Jev hỏng ở cả ba node phải cho đúng kết quả của luồng không có Jev."""
    plain, plain_model, _ = await run(monkeypatch, None)
    broken, broken_model, _ = await run(monkeypatch, FakeJev())
    assert [s["excerpt"] for s in broken["sources"]] == [s["excerpt"] for s in plain["sources"]]
    assert len(broken["sources"]) == 8
    assert broken_model.payloads == plain_model.payloads
    assert broken["grounding"]["user-1"]["answer"] == plain["grounding"]["user-1"]["answer"]
    assert broken["jev"] == {"gate": "error", "rerank": "error", "sufficiency": "error"}


async def test_follow_up_sends_previous_question_to_jev(monkeypatch):
    jev = FakeJev(gate=IN_SCOPE)
    monkeypatch.setattr(tutor_graph, "POLL_SECONDS", 0)
    monkeypatch.setattr(http, "workspace", statuses("ready"))
    monkeypatch.setattr(graph_module, "ChatOpenAI", lambda **_kwargs: Model("x"))
    cfg = config(FakeIndex(matches(2)))
    cfg["configurable"]["jev"] = jev
    first = state("Đệ quy là gì?")
    first["messages"] = [
        HumanMessage("Đệ quy là gì?", id="u0"),
        AIMessage("..."),
        HumanMessage("còn gì nữa?", id="user-1"),
    ]
    await tutor_graph.build(TUTOR).ainvoke(first, cfg)
    assert jev.calls[0][1] == {"question": "còn gì nữa?", "previous_question": "Đệ quy là gì?"}
