"""Kiểm bốn chỗ của Codey mà sai thì im lặng, không nổ.

Codey không có tool server, nên phần lớn `graph.py` không chạm tới nó. Cái đáng kiểm là những
chỗ chính sự VẮNG MẶT đó tạo ra: graph phải compile được khi không có node `tools`, và một tên
tool model bịa ra phải quay về `chat` thay vì đâm vào một node không tồn tại.
"""

from urllib.parse import quote

import pytest
from langchain_core.messages import AIMessage, ToolMessage

from app import budget
from app.codey.capability import CODEY
from app.codey.endpoint import _scope
from app.graph import build, graph_for


class FakeRequest:
    def __init__(self, headers: dict):
        self.headers = headers


def test_codey_has_no_server_tools():
    """`tools=()` là biên bảo mật, không phải chi tiết: nó là thứ đảm bảo lời giải mẫu và test
    case ẩn không có đường nào vào context. Một tool server thêm vào đây phải là quyết định có
    ý thức, không phải thứ trôi vào lúc refactor."""
    assert CODEY.tools == ()
    assert CODEY.write_tool == ""


def test_codey_graph_compiles_without_a_tools_node():
    """`compile()` từng ném "Found edge ending at unknown node `tools`": LangGraph suy ra cạnh
    từ annotation `Command[Literal[...]]` của `chat`, mà annotation là hằng số của hàm còn đích
    đi được thì tuỳ capability."""
    nodes = set(graph_for(CODEY).get_graph().nodes)
    assert "tools" not in nodes
    assert {"chat", "__start__", "__end__"} <= nodes


def test_graph_is_built_once_per_capability():
    assert graph_for(CODEY) is graph_for(CODEY)
    assert graph_for(CODEY) is not build(CODEY)


@pytest.mark.asyncio
async def test_hallucinated_tool_returns_to_chat_instead_of_a_missing_node(monkeypatch):
    """Model bịa tên tool là chuyện có thật. Với bề mặt không có node `tools`, để nó đi tiếp
    theo nhánh cũ nghĩa là cả lượt chết giữa chừng — trình duyệt treo ở dòng tool đang chạy,
    không câu trả lời, không lỗi. Phải trả lời cho lời gọi đó rồi quay lại `chat`."""
    import app.graph as graph_module

    class FakeModel:
        def bind_tools(self, _tools):
            return self

        async def ainvoke(self, _messages, _config=None):
            message = AIMessage(content="")
            message.tool_calls = [{"id": "call-1", "name": "read_hidden_tests", "args": {}}]
            return message

    monkeypatch.setattr(graph_module, "ChatOpenAI", lambda **_kwargs: FakeModel())

    chat = graph_module.make_chat(CODEY)
    command = await chat({"messages": [], "tools": []}, {})

    assert command.goto == "chat"
    answers = [m for m in command.update["messages"] if isinstance(m, ToolMessage)]
    assert len(answers) == 1
    assert answers[0].tool_call_id == "call-1"
    assert "read_hidden_tests" in answers[0].content


@pytest.mark.asyncio
async def test_frontend_tool_ends_the_turn(monkeypatch):
    """Tool của trình duyệt kết thúc lượt: trình duyệt đọc code/kết quả chạy rồi mở lượt mới."""
    import app.graph as graph_module

    class FakeModel:
        def bind_tools(self, _tools):
            return self

        async def ainvoke(self, _messages, _config=None):
            message = AIMessage(content="")
            message.tool_calls = [{"id": "c", "name": "read_editor_code", "args": {}}]
            return message

    monkeypatch.setattr(graph_module, "ChatOpenAI", lambda **_kwargs: FakeModel())

    chat = graph_module.make_chat(CODEY)
    command = await chat({"messages": [], "tools": [{"name": "read_editor_code"}]}, {})

    assert command.goto == "__end__"
    assert command.update["step"] == "awaiting_user"


def test_scope_reads_a_vietnamese_title_through_the_header():
    """Header HTTP là latin-1 còn tên bài thì có dấu, nên trình duyệt phải `encodeURIComponent`.
    Bỏ giải mã ở đây thì danh sách lịch sử hiện chuỗi `%C3%ACm%20...`."""
    title = "Tìm cặp có tổng bằng K"
    scope = _scope(FakeRequest({"x-agent-scope": "ex-1", "x-agent-scope-label": quote(title)}))
    assert scope == {"exerciseId": "ex-1", "exerciseTitle": title}


def test_scope_is_empty_without_an_exercise_id():
    """Không có bài thì không gắn nhãn nào — một dòng lịch sử mang tên bài mà không mang id là
    thứ không bấm vào được."""
    assert _scope(FakeRequest({})) == {}
    assert _scope(FakeRequest({"x-agent-scope-label": quote("Bài gì đó")})) == {}


def test_scope_trims_control_characters_and_length():
    """Chuỗi này được hiện lại nguyên văn trong droplist của chính người gửi."""
    scope = _scope(
        FakeRequest({"x-agent-scope": "ex\n-2", "x-agent-scope-label": quote("A" * 300 + "\x00")})
    )
    assert scope["exerciseId"] == "ex-2"
    assert scope["exerciseTitle"] == "A" * 120


def test_scope_falls_back_when_the_title_is_missing():
    scope = _scope(FakeRequest({"x-agent-scope": "ex-3"}))
    assert scope == {"exerciseId": "ex-3", "exerciseTitle": "Bài không rõ tên"}


@pytest.mark.asyncio
async def test_budget_uses_the_message_of_the_surface_that_ran_out():
    """Hạn mức chia theo `kind`, nhưng người dùng không biết điều đó — họ chỉ biết vừa bấm gì.
    Câu chung "hết lượt AI" gửi họ đi kiểm tra AI Tutor, nơi vẫn còn nguyên lượt."""

    class Usage:
        async def find_one_and_update(self, *_args, **_kwargs):
            return {"count": 99}

    db = {"ai_usage": Usage()}
    with pytest.raises(Exception) as caught:
        await budget.consume(db, "u1", "codey", limit=1, message=CODEY.budget_message)
    assert "Codey" in caught.value.detail

    with pytest.raises(Exception) as fallback:
        await budget.consume(db, "u1", "codey", limit=1)
    assert fallback.value.detail == budget.DEFAULT_MESSAGE


def test_codey_asks_for_a_low_reasoning_effort():
    """Mặc định của dòng gpt-5 là `medium`, và đo được ~10 giây im lặng trước chữ đầu tiên.

    `minimal` thì nhanh hơn nữa nhưng đo 0/3 lần chịu gọi tool đọc code — Codey không đọc được
    code của học viên thì nó chỉ còn là một con chatbot chung chung. `low` cho 5/5 với prompt
    hiện tại, nên đây là điểm cân bằng, không phải một con số tuỳ tiện.
    """
    assert CODEY.reasoning_effort == "low"


def test_lecter_keeps_the_provider_default():
    """Lecter đi một chuỗi gọi tool 5 bước; 10 giây suy luận ở đó đổi lấy một chuỗi đi đúng.

    `None` nghĩa là KHÔNG truyền khoá đó lên nhà cung cấp — khác hẳn truyền một giá trị rỗng.
    """
    from app.lecter.capability import LECTURER, WORKSPACE

    assert LECTURER.reasoning_effort is None
    assert WORKSPACE.reasoning_effort is None
