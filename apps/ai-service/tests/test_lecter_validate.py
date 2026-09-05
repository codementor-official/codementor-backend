"""Kiểm bản sao luật ở `validate.py` khớp với thứ backend thật sự từ chối.

Bốn ca đầu là bốn lỗi đã gặp hoặc sẽ gặp: `constraints` dạng chuỗi (lỗi thật, người soạn bấm xác
nhận rồi mới thấy), trường thừa (Mongo `additionalProperties: false` trả 500), `order` từ 0, và
thiếu `visibility`.
"""

from app.lecter import validate

VALID = {
    "statement": "Cho mảng nums và số k, tìm cặp có tổng bằng k.",
    "ioMode": "function",
    "signature": {
        "functionName": "two_sum",
        "parameters": [
            {"name": "nums", "type": {"kind": "list", "of": {"kind": "int"}}},
            {"name": "k", "type": {"kind": "int"}},
        ],
        "returnType": {"kind": "list", "of": {"kind": "int"}},
    },
    "constraints": ["2 <= n <= 10^5"],
    "testCases": [
        {"order": 1, "args": [[2, 7], 9], "expected": [0, 1], "visibility": "public"},
        {"order": 2, "args": [[1, 2], 8], "expected": [], "visibility": "hidden"},
        {"order": 3, "args": [[0, 0], 0], "expected": [0, 1], "visibility": "hidden"},
    ],
    "languages": [{"id": "python", "label": "Python 3.11", "referenceSolution": "def two_sum(): pass"}],
    "evaluation": {"checker": "exact"},
}


def test_valid_content_passes_both_layers():
    assert validate.check_shape(VALID) == []
    assert validate.check_submission(VALID) == []


def test_constraints_as_string_is_rejected():
    """Lỗi thật đã gặp: backend trả `constraints must be an array` sau khi người soạn bấm xác nhận."""
    errors = validate.check_shape({**VALID, "constraints": "2 <= n <= 10^5"})
    assert len(errors) == 1 and "MẢNG" in errors[0]


def test_unknown_field_is_rejected_before_mongo_sees_it():
    errors = validate.check_shape({**VALID, "difficulty": "medium"})
    assert errors == ["content: trường 'difficulty' không tồn tại trong ExerciseContent, phải bỏ đi"]


def test_test_case_shape():
    cases = [
        {"order": 0, "args": [[1], 1], "expected": 1, "visibility": "public"},
        {"order": 2, "args": [[1], 1], "expected": 1},
        {"order": 3, "args": [[1], 1], "expected": 1, "visibility": "public", "note": "x"},
    ]
    errors = validate.check_shape({**VALID, "testCases": cases})
    assert any("order phải là số nguyên >= 1" in e for e in errors)
    assert any("visibility" in e for e in errors)
    assert any("'note'" in e for e in errors)


def test_boolean_is_not_an_int():
    """`True` là `int` với Python nhưng không phải với Mongo; đừng để nó lọt vào `order`."""
    errors = validate.check_shape({**VALID, "testCases": [{"order": True, "visibility": "public"}]})
    assert any("order" in e for e in errors)


def test_submission_warnings_do_not_block_saving():
    thin = {"statement": "x", "languages": [{"id": "python", "label": "Python"}], "testCases": []}
    assert validate.check_shape(thin) == []
    warnings = validate.check_submission(thin)
    assert any("lời giải mẫu" in w for w in warnings)
    assert any("test case" in w for w in warnings)


def test_function_mode_arity_mismatch():
    broken = {**VALID, "testCases": [{**VALID["testCases"][0], "args": [[1]]}]}
    assert any("không khớp chữ ký" in w for w in validate.check_submission(broken))


def test_reserved_function_name():
    broken = {**VALID, "signature": {**VALID["signature"], "functionName": "class"}}
    assert any("từ khoá" in w for w in validate.check_submission(broken))


def test_language_id_must_be_a_judge_runner_id():
    """`"Python"` lưu được nhưng KHÔNG chấm được: bộ chấm trả lỗi "chế độ hàm chưa hỗ trợ ngôn ngữ
    'Python'". Bắt ở đây thay vì để giảng viên phát hiện khi học viên nộp bài."""
    broken = {**VALID, "languages": [{"id": "Python", "label": "Python 3.11", "referenceSolution": "x"}]}
    assert validate.check_shape(broken) == []
    assert any("id ngôn ngữ không hợp lệ" in w for w in validate.check_submission(broken))


def test_language_aliases_normalize():
    assert validate.normalize_language("Python") == "python"
    assert validate.normalize_language(" C++ ") == "cpp"
    assert validate.normalize_language("Golang") == "go"
    assert validate.normalize_language("NodeJS") == "javascript"
    # Không nhận ra thì trả nguyên văn, để câu lỗi nói đúng cái đã gửi.
    assert validate.normalize_language("Rust") == "rust"


def test_stdin_mode_requires_string_expected():
    """Bộ chấm ở chế độ stdin gọi `expected.strip()`; một số nguyên làm nó nổ và trả 500 lúc học
    viên nộp bài, không phải lúc soạn."""
    stdin_content = {
        "statement": "In ra số Fibonacci thứ n.",
        "languages": [{"id": "python", "label": "Python", "referenceSolution": "x"}],
        "testCases": [
            {"order": 1, "input": "0", "expected": 0, "visibility": "public"},
            {"order": 2, "input": "1", "expected": "1", "visibility": "hidden"},
            {"order": 3, "input": "5", "expected": "5", "visibility": "hidden"},
        ],
    }
    assert validate.check_shape(stdin_content) == []
    warnings = validate.check_submission(stdin_content)
    assert any("dạng chuỗi" in w for w in warnings)
