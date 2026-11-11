"""Giả lập phía trình duyệt: tool trình duyệt khai báo y như frontend, và handler trả đúng định dạng.

Nguồn đối chiếu (giữ đồng bộ khi frontend đổi):
- Codey: `codementor-frontend/apps/client/src/features/codey/codey-wiring.tsx`
  (`CodeyProblemContext`, `CodeyTools`, `numbered`, `clip`, MAX_FAILING = 3, FIELD_CHARS = 500).
- `showValue`: `codementor-frontend/packages/solve/src/types.ts`.
"""

import json
from typing import Any

from ag_ui.core.types import Context, Tool

MAX_FAILING = 3
FIELD_CHARS = 500
# `z.object({})` qua CopilotKit thành JSON schema object rỗng.
NO_PARAMS = {"type": "object", "properties": {}}

CODEY_TOOLS = [
    Tool(
        name="read_editor_code",
        description=(
            "Đọc code học viên đang viết trong trình soạn thảo, kèm số dòng. Gọi khi câu hỏi liên "
            "quan tới code của họ. Đừng đoán code trong đầu rồi nhận xét."
        ),
        parameters=NO_PARAMS,
    ),
    Tool(
        name="read_last_run",
        description=(
            "Đọc kết quả chạy gần nhất: verdict, số test đạt, vài test chưa đạt đầu tiên, lỗi biên "
            "dịch. Gọi khi câu hỏi liên quan tới lỗi, test sai hay kết quả chạy."
        ),
        parameters=NO_PARAMS,
    ),
]


def js_json(value: Any) -> str:
    """`JSON.stringify`: không khoảng trắng, giữ Unicode."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def show_value(value: Any) -> str:
    if value is None:
        return "null"
    return value if isinstance(value, str) else js_json(value)


def clip(value: Any) -> str:
    text = value if isinstance(value, str) else js_json("" if value is None else value)
    return f"{text[:FIELD_CHARS]}… (đã cắt bớt)" if len(text) > FIELD_CHARS else text


def numbered(code: str) -> str:
    return "\n".join(f"{i + 1} | {line}" for i, line in enumerate(code.split("\n")))


def codey_context(exercise: dict, statement: str | None = None) -> Context:
    """`CodeyProblemContext`: bản học viên — đề, ràng buộc, tối đa 5 test công khai."""
    value = {
        "title": exercise["title"],
        "difficulty": exercise["difficulty"],
        "statement": statement if statement is not None else exercise["statement"],
        "constraints": exercise["constraints"],
        "tags": [],
        "language": "python",
        "publicTestCases": [
            {
                "args": [show_value(a) for a in t["args"]],
                "input": None,
                "expected": show_value(t["expected"]),
            }
            for t in exercise["public_tests"][:5]
        ],
    }
    return Context(description="Bài code học viên đang mở", value=js_json(value))


def read_editor_code(code: str) -> str:
    if not code.strip():
        return "Trình soạn thảo đang trống — học viên chưa viết gì."
    return f"Ngôn ngữ: python\n\n{numbered(code)}"


def read_last_run(result: dict | None, error: str | None = None) -> str:
    """Handler `read_last_run`. `result` có dạng `JudgeRunResult` (phản hồi nộp/chạy bài)."""
    if error:
        return f"Lần chạy gần nhất hỏng ở phía hệ thống chấm: {clip(error)}"
    if not result:
        return "Học viên chưa chạy bài lần nào trong phiên này."
    failing = []
    for case in [c for c in result.get("cases", []) if c.get("verdict") != "accepted"][
        :MAX_FAILING
    ]:
        if case.get("hidden"):
            # Frontend sau bản sửa `fix/hidden-test-redaction`: test ẩn chỉ báo chưa đạt.
            failing.append(
                {
                    "order": case.get("order"),
                    "verdict": case.get("verdict"),
                    "hidden": True,
                    "note": f"Test ẩn #{case.get('order')}: chưa đạt",
                }
            )
            continue
        item = {
            "order": case.get("order"),
            "verdict": case.get("verdict"),
            "expected": clip(case.get("expected")),
            "actual": clip(case.get("actual")),
        }
        if case.get("stderr"):
            item["stderr"] = clip(case["stderr"])
        failing.append(item)
    payload = {
        "verdict": result.get("verdict"),
        "passedTests": result.get("passedTests"),
        "totalTests": result.get("totalTests"),
        "runtimeMs": result.get("runtimeMs"),
    }
    if result.get("compileOutput"):
        payload["compileOutput"] = clip(result["compileOutput"])
    payload["failingCases"] = failing
    missing = (result.get("totalTests") or 0) - (result.get("passedTests") or 0)
    if len(failing) < missing:
        payload["note"] = f"Chỉ liệt kê {len(failing)} test chưa đạt đầu tiên."
    return js_json(payload)


def codey_tool_result(name: str, scenario: dict, last_run: dict | None) -> str:
    if name == "read_editor_code":
        return read_editor_code(scenario.get("editor_code") or "")
    if name == "read_last_run":
        return read_last_run(last_run)
    return f"Không có tool tên {name}."
