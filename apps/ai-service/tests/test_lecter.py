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
