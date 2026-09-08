"""Kiểm bề mặt Lecter của nhóm học.

Hai thứ ở đây là hàng rào, không phải tiện ích:

1. `workspace_id` phải đến từ config do route đặt vào sau khi kiểm quyền. Nếu tool đọc được
   nhóm nào đó từ tham số model đưa, một câu chèn trong tài liệu có thể chỉ nó sang nhóm khác.
2. Trước khi đọc index, tool hỏi workspace-service — chỉ service đó biết tài liệu đã được duyệt
   chưa và người đang hỏi có phải thành viên không.
"""

import pytest

from app.lecter import http, tools
from app.lecter.http import ToolCallError

WORKSPACE = "11111111-1111-4111-8111-111111111111"
DOC = "22222222-2222-4222-8222-222222222222"
SLUG = "nhom-ai"


class FakeIndex:
    def __init__(self, full=None, matches=None):
        self.full = full
        self.matches = matches or []
        self.scopes: list[str] = []

    async def full_text(self, scope, _source):
        self.scopes.append(scope)
        return self.full

    async def search(self, scope, _sources, query, limit=8):
        self.scopes.append(scope)
        return self.matches[:limit]


def config(index=None, *, workspace=True):
    configurable = {"auth_token": "t", "index": index or FakeIndex()}
    if workspace:
        configurable |= {"workspace_slug": SLUG, "workspace_id": WORKSPACE}
    return {"configurable": configurable}


async def test_document_tool_refuses_without_a_workspace_in_config():
    """Không có nhóm trong config nghĩa là route chưa kiểm quyền — không đọc gì cả."""
    with pytest.raises(ToolCallError):
        await tools.read_workspace_document.ainvoke(
            {"document_id": DOC}, config=config(workspace=False)
        )


async def test_document_read_uses_the_workspace_scope(monkeypatch):
    index = FakeIndex(full={"text": "nội dung", "tokens": 10, "chunkCount": 1, "pageCount": 1})

    async def fake_workspace(method, path, _config, **kwargs):
        assert method == "POST" and path.endswith("/ai/documents/status")
        assert kwargs["json_body"] == {"documentIds": [DOC]}
        return [{"id": DOC, "state": "ready", "chunkCount": 1}]

    monkeypatch.setattr(http, "workspace", fake_workspace)
    out = await tools.read_workspace_document.ainvoke({"document_id": DOC}, config=config(index))
    assert "nội dung" in out
    # Scope phải là của NHÓM, không phải `lecturer:<userId>` — đọc nhầm scope là đọc kho
    # tài liệu cá nhân của một người khác.
    assert index.scopes == [f"workspace:{WORKSPACE}"]


async def test_document_read_waits_when_the_index_is_not_ready(monkeypatch):
    async def fake_workspace(*_args, **_kwargs):
        return [{"id": DOC, "state": "pending", "chunkCount": 0}]

    monkeypatch.setattr(http, "workspace", fake_workspace)
    out = await tools.read_workspace_document.ainvoke(
        {"document_id": DOC}, config=config(FakeIndex(full=None))
    )
    assert "đang được xử lý" in out and "đừng soạn nội dung" in out


async def test_document_read_reports_a_failed_index(monkeypatch):
    async def fake_workspace(*_args, **_kwargs):
        return [{"id": DOC, "state": "failed", "error": "PDF scan cần OCR"}]

    monkeypatch.setattr(http, "workspace", fake_workspace)
    out = await tools.read_workspace_document.ainvoke({"document_id": DOC}, config=config())
    assert "KHÔNG thành công" in out and "OCR" in out


async def test_exercise_search_stays_inside_the_group(monkeypatch):
    seen: dict = {}

    async def fake_workspace(method, path, _config, **kwargs):
        seen["path"] = path
        seen["params"] = kwargs.get("params")
        return {"items": [{"id": "ge-1", "title": "Two Sum", "difficulty": "easy",
                           "publicationStatus": "published"}]}

    monkeypatch.setattr(http, "workspace", fake_workspace)
    out = await tools.search_workspace_exercises.ainvoke({"query": "two sum"}, config=config())
    assert seen["path"] == f"/api/v1/workspaces/{SLUG}/exercises"
    assert "ge-1" in out and "Two Sum" in out


async def test_validate_names_the_write_tool_of_this_surface():
    """Câu "HỢP LỆ, gọi X NGAY BÂY GIỜ" là mệnh lệnh model nghe theo. Ở nhóm học mà nhắc
    `save_exercise_content` thì nó được bảo gọi một tool KHÔNG có trong giấy phép — và khi không
    gọi được, nó tuyên bố đã xong bằng văn xuôi trong lúc biểu mẫu vẫn trống. Đã xảy ra thật."""
    content = {
        "statement": "Đề bài",
        "ioMode": "stdin_stdout",
        "testCases": [
            {"order": 1, "input": "1", "expected": "1", "visibility": "public"},
            {"order": 2, "input": "2", "expected": "2", "visibility": "hidden"},
            {"order": 3, "input": "3", "expected": "3", "visibility": "hidden"},
        ],
        "languages": [{"id": "python", "label": "Python", "referenceSolution": "print(1)"}],
    }
    out = await tools.validate_exercise_content.ainvoke(
        {"content": content},
        config={"configurable": {"write_tool": "apply_exercise_draft"}},
    )
    assert "HỢP LỆ" in out and "apply_exercise_draft" in out
    assert "save_exercise_content" not in out

    # Không khai gì thì vẫn là bề mặt giảng viên — mặc định không được đổi lặng lẽ.
    out = await tools.validate_exercise_content.ainvoke(
        {"content": content}, config={"configurable": {}}
    )
    assert "save_exercise_content" in out
