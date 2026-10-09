"""Tutor trên stack agent chung.

Luật đối chiếu là luật của `grounded_turn` cũ — các test ở nửa đầu là bản chuyển nguyên từ
`test_rag.py`, chỉ đổi đầu vào từ JSON sang văn bản hai dấu mốc. Nửa sau kiểm những chỗ của kiến
trúc mới mà sai thì im lặng: grounding khoá theo tin nhắn người dùng, lịch sử đưa bản đã đối
chiếu, state của trình duyệt không lọt vào, và vector không bị kéo lại mỗi câu hỏi.
"""

from collections import OrderedDict
from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from langchain_core.messages import AIMessage, HumanMessage

import app.graph as graph_module
from app.graph import graph_for
from app.lecter import http
from app.rag.index import DocumentIndex
from app.tutor import graph as tutor_graph
from app.tutor.answer import EXPLAIN, QUOTES, as_history, ground, split_answer
from app.tutor.capability import TUTOR
from app.tutor.endpoint import _documents

DOC = "6f1c2c3e-1d7a-4b55-9a51-1f2b3c4d5e6f"
OTHER = "0b8a0c2e-6f41-4e1f-8f0e-2a3b4c5d6e7f"


def raw(quotes: str = "", explanation: str = "") -> str:
    return f"{QUOTES}\n{quotes}\n{EXPLAIN}\n{explanation}"


def source(excerpt: str, sid: str = "S1", page: int | None = 1) -> dict:
    return {"sourceId": sid, "documentId": DOC, "title": "Stack", "page": page, "excerpt": excerpt}


# --- luật đối chiếu (từ `grounded_turn`) ----------------------------------------------


def test_invented_source_fails_closed():
    turn = ground(raw("> Fake [S99]"), [])
    assert turn["insufficientEvidence"]
    assert turn["citations"] == []
    assert "Fake" not in turn["answer"]


def test_valid_citation_contains_real_excerpt_and_page():
    turn = ground(raw("> LIFO [S1]"), [source("LIFO", page=2)])
    assert not turn["insufficientEvidence"]
    assert turn["citations"][0]["excerpt"] == "LIFO"
    assert turn["citations"][0]["page"] == 2


def test_related_explanation_is_retained_separately_without_document_citations():
    turn = ground(raw("", "Ví dụ minh họa: Stack lấy phần tử cuối trước."), [])
    assert turn["insufficientEvidence"]
    assert turn["citations"] == []
    assert "Stack" in turn["supplementalAnswer"]
    assert "kiến thức mở rộng" in turn["answer"]


def test_mixed_response_keeps_source_claim_and_extra_example_distinct():
    turn = ground(raw("> LIFO [S1]", "Ví dụ minh họa: xếp chồng đĩa."), [source("LIFO")])
    assert turn["citations"][0]["excerpt"] == "LIFO"
    assert "đĩa" not in turn["answer"]
    assert "đĩa" in turn["supplementalAnswer"]


def test_supplement_cannot_misuse_source_markers():
    turn = ground(raw("", "Unverified claim [S1]"), [source("LIFO")])
    assert turn["supplementalAnswer"] == ""
    assert turn["citations"] == []


def test_unrelated_or_missing_private_fact_still_abstains():
    turn = ground(raw(), [source("LIFO")])
    assert turn["supplementalAnswer"] == ""
    assert "chưa có thông tin" in turn["answer"]


def test_correct_source_id_does_not_allow_invented_quote():
    turn = ground(
        raw("> Trọng số cạnh không âm. [S1]", "Kiến thức bổ sung: Dijkstra cần trọng số không âm."),
        [source("Giải thích relaxation và priority queue.")],
    )
    assert turn["insufficientEvidence"]
    assert turn["citations"] == []
    assert "Trọng số cạnh" not in turn["answer"]
    assert "Dijkstra" in turn["supplementalAnswer"]


def test_literal_quote_validation_accepts_wrapped_document_text():
    turn = ground(raw("> Stack dùng LIFO. [S1]", "Stack lấy phần tử cuối trước."), [source("Stack dùng\nLIFO.")])
    assert turn["answer"] == "> Stack dùng LIFO. [S1]"
    assert len(turn["citations"]) == 1


# --- tách định dạng ----------------------------------------------------------------------


def test_answer_without_markers_never_counts_as_quotes():
    """Sai định dạng thì toàn bộ là phần giải thích — không bao giờ lọt vào khối "từ tài liệu"."""
    quotes, explanation = split_answer("> LIFO [S1]\nStack là LIFO.")
    assert quotes == []
    assert "Stack là LIFO." in explanation
    assert ground("> LIFO [S1]", [source("LIFO")])["insufficientEvidence"]


def test_split_reads_multiline_and_wrapped_quotes():
    quotes, explanation = split_answer(
        raw('> "Stack dùng\n> LIFO." [S1]\n\n> Queue dùng FIFO. [S2]\n\n> không có mã', "Giải thích.")
    )
    assert quotes == [
        {"sourceId": "S1", "quote": "Stack dùng LIFO."},
        {"sourceId": "S2", "quote": "Queue dùng FIFO."},
    ]
    assert explanation == "Giải thích."


def test_history_uses_grounded_turn_without_source_ids():
    """Bản thô có thể mang trích dẫn bịa đã bị loại; lượt sau chỉ được thấy bản đã đối chiếu, và
    mã `[S1]` của lượt trước trỏ tới một nguồn khác nên phải bỏ."""
    turn = ground(raw("> LIFO [S1]\n\n> bịa [S1]", "Giải thích."), [source("LIFO")])
    text = as_history(turn)
    assert "bịa" not in text
    assert "[S1]" not in text
    assert "LIFO" in text and "Giải thích." in text


def test_history_keeps_last_turns_and_prefers_grounding():
    messages = []
    grounding = {}
    for i in range(5):
        messages.append(HumanMessage(f"hỏi {i}", id=f"u{i}"))
        messages.append(AIMessage(raw(f"> bịa {i} [S1]", f"thô {i}")))
        grounding[f"u{i}"] = {"answer": f"sạch {i}", "supplementalAnswer": "", "citations": []}
    kept = tutor_graph.history(messages, grounding)
    assert [message.content for message in kept] == [
        "hỏi 2", "sạch 2", "hỏi 3", "sạch 3", "hỏi 4", "sạch 4",
    ]


# --- graph chạy trọn với hàng giả ----------------------------------------------------------


class FakeIndex:
    def __init__(self, matches):
        self.matches = matches
        self.calls = []

    async def search(self, scope, sources, query, limit):
        self.calls.append((scope, sources, query, limit))
        return self.matches


class FakeModel:
    def __init__(self, text):
        self.text = text
        self.seen = None

    async def ainvoke(self, messages, _config=None):
        self.seen = messages
        return AIMessage(self.text, id="answer-1")


def config(index):
    return {
        "configurable": {
            "thread_id": f"t-{datetime.now(UTC).timestamp()}",
            "workspace_slug": "nhom",
            "workspace_id": "w1",
            "index": index,
            "auth_token": "token",
        },
        "recursion_limit": TUTOR.recursion_limit,
    }


def statuses(*states):
    async def fake(method, path, _config, json_body=None, **_kwargs):
        assert method == "POST" and path.endswith("/ai/documents/status")
        fake.calls += 1
        return [{"id": doc, "state": states[min(fake.calls, len(states)) - 1]} for doc in json_body["documentIds"]]

    fake.calls = 0
    return fake


def state(question="Stack là gì?"):
    return {
        "messages": [HumanMessage(question, id="user-1")],
        "documents": [{"id": DOC, "title": "Stack"}],
        "grounding": {},
        "polls": 0,
    }


def test_tutor_graph_is_the_fixed_pipeline():
    nodes = set(graph_for(TUTOR).get_graph().nodes)
    assert {"wait", "retrieve", "generate", "verify"} <= nodes
    assert "chat" not in nodes and "tools" not in nodes


async def test_run_waits_for_index_then_grounds_by_user_message(monkeypatch):
    monkeypatch.setattr(tutor_graph, "POLL_SECONDS", 0)
    monkeypatch.setattr(http, "workspace", statuses("queued", "ready"))
    model = FakeModel(raw("> Stack dùng LIFO. [S1]", "Giống chồng đĩa."))
    monkeypatch.setattr(graph_module, "ChatOpenAI", lambda **_kwargs: model)
    index = FakeIndex([{"text": "Stack dùng LIFO.", "page": 3, "documentId": DOC, "title": "Stack"}])

    result = await tutor_graph.build(TUTOR).ainvoke(state(), config(index))

    assert index.calls[0][0] == "workspace:w1"
    assert index.calls[0][1] == [{"id": DOC}]
    turn = result["grounding"]["user-1"]
    assert turn["answer"] == "> Stack dùng LIFO. [S1]"
    assert turn["citations"][0]["page"] == 3
    assert result["sources"][0]["sourceId"] == "S1"
    # Đoạn văn đi trong tin nhắn cuối gửi model, không nằm lại trong `messages` của state.
    assert "Stack dùng LIFO." in model.seen[-1].content
    assert [message.id for message in result["messages"]] == ["user-1", "answer-1"]


async def test_failed_document_ends_with_a_message_not_an_error(monkeypatch):
    monkeypatch.setattr(http, "workspace", statuses("failed"))
    result = await tutor_graph.build(TUTOR).ainvoke(state(), config(FakeIndex([])))
    assert isinstance(result["messages"][-1], AIMessage)
    assert result["grounding"] == {}


async def test_no_match_skips_the_model(monkeypatch):
    monkeypatch.setattr(http, "workspace", statuses("ready"))

    def must_not_build(**_kwargs):
        raise AssertionError("không có đoạn nào thì không gọi model")

    monkeypatch.setattr(graph_module, "ChatOpenAI", must_not_build)
    result = await tutor_graph.build(TUTOR).ainvoke(state(), config(FakeIndex([])))
    assert "chưa có thông tin" in result["grounding"]["user-1"]["answer"]


# --- cổng endpoint ---------------------------------------------------------------------------


def test_documents_gate_shape():
    assert _documents({"documents": [{"id": DOC, "title": "A\x00b"}]}) == [{"id": DOC, "title": "Ab"}]
    for bad in (
        {},
        {"documents": []},
        {"documents": [{"id": "not-a-uuid"}]},
        {"documents": [{"id": DOC}, {"id": DOC}]},
        {"documents": [{"id": OTHER}] * 9},
    ):
        with pytest.raises(HTTPException) as error:
            _documents(bad)
        assert error.value.status_code == 400


# --- cache vector ------------------------------------------------------------------------------


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _limit):
        return self.rows


class Collection:
    def __init__(self, row):
        self.row = row
        self.loads = 0

    def find(self, _query, projection=None):
        assert projection == {"chunks": 0}
        return Cursor([{key: value for key, value in self.row.items() if key != "chunks"}])

    async def find_one(self, _query, _projection=None):
        self.loads += 1
        return {"chunks": self.row["chunks"]}


async def test_vectors_load_once_per_index_version():
    """Trước đây mỗi câu hỏi kéo lại toàn bộ embedding từ Mongo."""
    row = {
        "_id": "k",
        "documentId": DOC,
        "source": {"title": "Stack"},
        "updatedAt": datetime(2026, 10, 9, tzinfo=UTC),
        "chunks": [{"text": "LIFO", "page": 1, "embedding": [1.0, 0.0]}],
    }
    collection = Collection(row)
    index = DocumentIndex.__new__(DocumentIndex)
    index.indexes = collection
    index.config = type("Config", (), {"openai_embedding_model": "m"})()
    index._vectors = OrderedDict()

    class Provider:
        async def embed(self, texts):
            return [[1.0, 0.0] for _ in texts]

    index.provider = Provider()
    for _ in range(3):
        found = await index.search("workspace:w", [{"id": DOC}], "stack")
        assert found[0]["text"] == "LIFO" and "embedding" not in found[0]
    assert collection.loads == 1

    row["updatedAt"] = datetime(2026, 10, 10, tzinfo=UTC)
    await index.search("workspace:w", [{"id": DOC}], "stack")
    assert collection.loads == 2


# --- luồng sự kiện AG-UI thật -----------------------------------------------------------------


async def test_agui_stream_carries_text_then_grounding(monkeypatch):
    """Chỗ dễ vỡ nhất của kiến trúc mới không nằm trong graph mà ở ag-ui-langgraph: chữ phải
    chảy ra thành TEXT_MESSAGE_CONTENT, và snapshot cuối phải mang `grounding` khoá đúng id tin
    nhắn trình duyệt đã gửi."""
    from ag_ui.core.events import EventType
    from ag_ui.core.types import RunAgentInput, UserMessage
    from ag_ui_langgraph import LangGraphAgent
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel

    monkeypatch.setattr(http, "workspace", statuses("ready"))
    answer = raw("> Stack dùng LIFO. [S1]", "Giống chồng đĩa.")
    monkeypatch.setattr(
        graph_module,
        "ChatOpenAI",
        lambda **_kwargs: GenericFakeChatModel(messages=iter([AIMessage(answer)])),
    )
    index = FakeIndex([{"text": "Stack dùng LIFO.", "page": 1, "documentId": DOC, "title": "Stack"}])
    agent = LangGraphAgent(
        name="tutor",
        graph=tutor_graph.build(TUTOR),
        emit_raw_events=False,
        config={
            "recursion_limit": TUTOR.recursion_limit,
            "configurable": {"workspace_slug": "nhom", "workspace_id": "w1", "index": index, "auth_token": "t"},
        },
    )
    run = RunAgentInput(
        thread_id="thread-agui",
        run_id="run-1",
        state={"documents": [{"id": DOC, "title": "Stack"}], "grounding": {}, "sources": [], "polls": 0},
        messages=[UserMessage(id="user-agui", role="user", content="Stack là gì?")],
        tools=[],
        context=[],
        forwarded_props={},
    )
    events = [event async for event in agent.run(run)]
    kinds = [event.type for event in events]

    assert EventType.RUN_ERROR not in kinds
    streamed = "".join(event.delta for event in events if event.type == EventType.TEXT_MESSAGE_CONTENT)
    assert "Stack dùng LIFO." in streamed
    snapshots = [event.snapshot for event in events if event.type == EventType.STATE_SNAPSHOT]
    assert any(snapshot.get("sources") for snapshot in snapshots)
    final = snapshots[-1]
    assert final["grounding"]["user-agui"]["answer"] == "> Stack dùng LIFO. [S1]"
    assert final["grounding"]["user-agui"]["supplementalAnswer"] == "Giống chồng đĩa."


# --- cổng HTTP trước khi mở stream -----------------------------------------------------------


def test_run_gate_fails_as_http_before_streaming(monkeypatch):
    """Tài liệu hỏng, chưa duyệt, hay chọn sai phải là mã HTTP thật — trình duyệt trả câu hỏi về
    ô soạn và người dùng không mất lượt nào. Sau khi SSE mở thì không còn làm được vậy."""
    from fastapi import Request
    from fastapi.testclient import TestClient

    from app.auth import require_user
    from app.lecter.http import ToolCallError
    from app.main import app

    def user(request: Request):
        request.state.access_token = "token"
        return {"sub": "u1"}

    calls = []

    async def workspace(method, path, _config, json_body=None, **_kwargs):
        calls.append(path)
        if method == "GET":
            return {"id": "w1"}
        if json_body["documentIds"] == [OTHER]:
            raise ToolCallError("không thấy", 404)
        return [{"id": doc, "state": "failed", "error": "PDF có mật khẩu."} for doc in json_body["documentIds"]]

    monkeypatch.setattr(http, "workspace", workspace)
    app.dependency_overrides[require_user] = user
    try:
        with TestClient(app) as client:
            def run(documents):
                return client.post(
                    "/api/v1/ai/tutor/workspace/nhom/run",
                    json={
                        "threadId": "t1",
                        "runId": "r1",
                        "state": {"documents": documents},
                        "messages": [{"id": "m1", "role": "user", "content": "Stack?"}],
                        "tools": [],
                        "context": [],
                        "forwardedProps": {},
                    },
                )

            assert run([]).status_code == 400
            assert calls == []  # sai hình dạng thì không hỏi ai cả
            failed = run([{"id": DOC, "title": "Stack"}])
            assert failed.status_code == 400
            assert failed.json()["message"] == "PDF có mật khẩu."
            missing = run([{"id": OTHER, "title": "Ẩn"}])
            assert missing.status_code == 404
            assert "chưa được duyệt" in missing.json()["message"]
    finally:
        app.dependency_overrides.pop(require_user, None)
