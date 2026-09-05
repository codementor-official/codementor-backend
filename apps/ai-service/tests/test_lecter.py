"""Kiểm những chỗ sai thì im lặng, không phải những chỗ sai thì nổ.

Ba thứ ở đây đều là bẫy thật: tool trùng tên có thể chiếm chỗ tool server (bịa kết quả chạy thử),
bộ chấm hỏng có thể làm chết cả lượt thay vì báo lại, và kết quả judge không cắt sẽ nổ context.
"""

import json

import pytest

from app.lecter import http, tools
from app.lecter.graph import _frontend_names


def test_frontend_names_excludes_server_tools():
    """Trang bị chèn mã khai một tool tên `run_solution` thì tool server vẫn thắng — nếu không,
    model sẽ nhận kết quả 'chạy thử' do trình duyệt bịa ra."""
    state = {"tools": [{"name": "run_solution"}, {"name": "create_exercise"}]}
    assert _frontend_names(state) == {"create_exercise"}


def test_frontend_names_empty_state():
    assert _frontend_names({}) == set()


def test_clip_truncates_and_says_so():
    out = http.clip("x" * 900)
    assert len(out) < 900 and "cắt bớt" in out
    assert http.clip("ngắn") == "ngắn"
    assert http.clip([1, 2]) == json.dumps([1, 2])


async def test_run_solution_reports_broken_judge_instead_of_raising(monkeypatch):
    """Sandbox judge hỏng phần stdin trên máy dev. Vòng verify phải nói ra, không được ném lỗi:
    ném lỗi thì cả lượt chết và giảng viên chỉ thấy 'đã xảy ra lỗi'."""

    async def broken(*_args, **_kwargs):
        raise http.ToolCallError("cannot open stdin.txt")

    monkeypatch.setattr(http, "judge", broken)
    result = await tools.run_solution.ainvoke(
        {"language": "python", "source_code": "print(1)", "test_cases": [{"order": 1}]},
        config={"configurable": {"auth_token": "t"}},
    )
    assert result.startswith("CHƯA XÁC NHẬN ĐƯỢC")


async def test_run_solution_keeps_only_three_failing_cases(monkeypatch):
    async def judged(*_args, **_kwargs):
        return {
            "verdict": "wrong_answer",
            "passedTests": 0,
            "totalTests": 50,
            "runtimeMs": 12,
            "cases": [
                {"order": i, "verdict": "wrong_answer", "expected": "a" * 900, "actual": "b", "stderr": ""}
                for i in range(1, 51)
            ],
        }

    monkeypatch.setattr(http, "judge", judged)
    result = await tools.run_solution.ainvoke(
        {"language": "python", "source_code": "print(1)", "test_cases": [{"order": 1}]},
        config={"configurable": {"auth_token": "t"}},
    )
    assert result.count("- case #") == tools.MAX_FAILING_CASES
    assert "a" * 900 not in result


def test_auth_token_missing_is_an_explained_error():
    with pytest.raises(http.ToolCallError):
        http.auth_token({"configurable": {}})


async def test_tool_error_becomes_a_message_not_a_crash():
    """`ToolNode` của LangGraph ném lại lỗi theo mặc định, và một lỗi 404 sẽ giết cả run: trình
    duyệt treo ở dòng tool đang chạy, không câu trả lời, không thông báo."""
    from app.lecter.graph import tool_error

    assert tool_error(http.ToolCallError("Không tìm thấy")) == "Tool thất bại: Không tìm thấy"
    # Lỗi ngoài dự tính không được đưa chi tiết vào lịch sử hội thoại.
    message = tool_error(RuntimeError("connect to 10.0.0.5:5432 failed"))
    assert "10.0.0.5" not in message and "lỗi hệ thống" in message


def test_dangling_tool_call_is_dropped_so_the_thread_survives():
    """Một run đứt giữa chừng để lại `tool_call` không có output; OpenAI từ chối cả yêu cầu vì nó,
    nên hội thoại đó sẽ chết vĩnh viễn nếu không dọn."""
    from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

    from app.lecter.graph import drop_dangling_tool_calls

    call = {"name": "read_exercise", "args": {}, "id": "c1", "type": "tool_call"}
    dangling = [HumanMessage("hỏi"), AIMessage("", tool_calls=[call]), HumanMessage("hỏi lại")]
    assert [type(m).__name__ for m in drop_dangling_tool_calls(dangling)] == [
        "HumanMessage",
        "HumanMessage",
    ]

    complete = [HumanMessage("hỏi"), AIMessage("", tool_calls=[call]), ToolMessage("ok", tool_call_id="c1")]
    assert drop_dangling_tool_calls(complete) == complete


async def test_run_solution_rejects_a_bad_language_id_before_calling_judge(monkeypatch):
    """Trước đây lỗi này đi tới judge và quay về dưới dạng 5xx không kèm lý do, nên model thử lại
    y hệt ba lần."""

    async def must_not_run(*_args, **_kwargs):  # pragma: no cover - chỉ để phát hiện gọi nhầm
        raise AssertionError("không được gọi judge với id ngôn ngữ sai")

    monkeypatch.setattr(http, "judge", must_not_run)
    result = await tools.run_solution.ainvoke(
        {"language": "Rust", "source_code": "fn main(){}", "test_cases": []},
        config={"configurable": {"auth_token": "t"}},
    )
    assert result.startswith("SAI ID NGÔN NGỮ") and "python" in result


async def test_backend_error_text_survives_for_both_nest_and_fastapi(monkeypatch):
    """Nest dùng khoá `message`, judge (FastAPI) dùng `detail`. Chỉ đọc một khoá thì lỗi thành câu
    rỗng, model không biết mình sai gì và gửi lại y hệt — đúng thứ đã xảy ra với
    "chế độ hàm chưa hỗ trợ ngôn ngữ 'Python'"."""
    import httpx

    real_client = httpx.AsyncClient

    def with_body(body: dict):
        transport = httpx.MockTransport(lambda _request: httpx.Response(422, json=body))

        def build(*args, **kwargs):
            return real_client(*args, transport=transport, **kwargs)

        return build

    for body, needle in (
        ({"message": "Chưa gửi duyệt được, còn thiếu: đề bài"}, "còn thiếu"),
        ({"detail": "chế độ hàm chưa hỗ trợ ngôn ngữ 'Python'"}, "chưa hỗ trợ ngôn ngữ"),
    ):
        monkeypatch.setattr(httpx, "AsyncClient", with_body(body))
        with pytest.raises(http.ToolCallError) as caught:
            await http.call(
                "GET", "http://nowhere.invalid", "/x", {"configurable": {"auth_token": "t"}}
            )
        assert needle in str(caught.value)


async def test_run_solution_blocks_the_two_payloads_that_crash_judge(monkeypatch):
    """Judge trả 500 trần (không lý do) cho cả hai; model mất ba lượt thử lại y hệt."""

    async def must_not_run(*_args, **_kwargs):  # pragma: no cover - chỉ để bắt gọi nhầm
        raise AssertionError("không được gọi judge với payload làm nó nổ")

    monkeypatch.setattr(http, "judge", must_not_run)
    config = {"configurable": {"auth_token": "t"}}

    # `args` là chế độ hàm, nhưng thiếu `signature` nên judge chạy chế độ stdin.
    missing_spec = await tools.run_solution.ainvoke(
        {"language": "python", "source_code": "x", "test_cases": [{"order": 1, "args": [0], "expected": 0}]},
        config=config,
    )
    assert missing_spec.startswith("THIẾU `signature`")

    # Chế độ stdin nhưng `expected` là số: judge gọi `.strip()` trên int.
    bad_type = await tools.run_solution.ainvoke(
        {"language": "python", "source_code": "x", "test_cases": [{"order": 1, "input": "3", "expected": 55}]},
        config=config,
    )
    assert bad_type.startswith("SAI KIỂU Ở CHẾ ĐỘ STDIN")


def test_dropping_a_message_takes_its_answered_siblings_too():
    """Hai lời gọi song song, run chết sau khi mới có kết quả của cái thứ nhất. Bỏ AIMessage mà
    giữ `ToolMessage` còn lại thì nó thành message mồ côi — OpenAI từ chối y hệt."""
    from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

    from app.lecter.graph import drop_dangling_tool_calls

    calls = [
        {"name": "list_topics", "args": {}, "id": "a", "type": "tool_call"},
        {"name": "read_exercise", "args": {}, "id": "b", "type": "tool_call"},
    ]
    messages = [
        HumanMessage("hỏi"),
        AIMessage("", tool_calls=calls),
        ToolMessage("xong", tool_call_id="a"),  # "b" không bao giờ có kết quả
    ]
    assert drop_dangling_tool_calls(messages) == [messages[0]]
