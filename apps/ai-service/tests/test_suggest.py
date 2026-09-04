"""Kiểm phần quyết định của gợi ý testcase: chặn cái gì trước khi tiêu một lời gọi model,
và giữ lại cái gì trong thứ model trả về."""

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.suggest import (
    DEFAULT_SUGGESTIONS,
    MAX_SUGGESTIONS,
    MIN_SUGGESTIONS,
    SuggestTestCasesRequest,
    parse_cases,
    validate_request,
)

STATEMENT = "Cho mảng số nguyên và số k, tìm cặp phần tử có tổng bằng k."
SIGNATURE = {
    "functionName": "find_pair",
    "parameters": [
        {"name": "nums", "type": {"kind": "list", "of": {"kind": "int"}}},
        {"name": "k", "type": {"kind": "int"}},
    ],
    "returnType": {"kind": "list", "of": {"kind": "int"}},
}


def build(**overrides) -> SuggestTestCasesRequest:
    return SuggestTestCasesRequest(
        **{"statement": STATEMENT, "ioMode": "stdin_stdout", **overrides}
    )


def test_rejects_blank_statement():
    for blank in ("", "   ", "ngắn quá"):
        with pytest.raises(ValidationError):
            build(statement=blank)


def test_count_defaults_to_three_and_stays_inside_one_to_five():
    assert build().count == DEFAULT_SUGGESTIONS == 3
    for allowed in range(MIN_SUGGESTIONS, MAX_SUGGESTIONS + 1):
        assert build(count=allowed).count == allowed
    for rejected in (MIN_SUGGESTIONS - 1, MAX_SUGGESTIONS + 1, -3):
        with pytest.raises(ValidationError):
            build(count=rejected)


def test_parse_honours_the_requested_count_not_the_ceiling():
    """Người soạn xin 1 case thì nhận 1, dù model có hào phóng gửi về 5."""
    body = build(count=1)
    cases = parse_cases(
        [{"value": f"{n}\n", "rationale": "case"} for n in range(5)], body
    )
    assert len(cases) == 1


def test_function_mode_needs_a_signature_with_parameters():
    with pytest.raises(HTTPException) as missing:
        validate_request(build(ioMode="function"))
    assert missing.value.status_code == 400

    empty = {**SIGNATURE, "parameters": []}
    with pytest.raises(HTTPException):
        validate_request(build(ioMode="function", signature=empty))

    validate_request(build(ioMode="function", signature=SIGNATURE))
    validate_request(build())  # stdin không cần chữ ký


def test_parse_drops_cases_with_the_wrong_arity_or_broken_json():
    body = build(ioMode="function", signature=SIGNATURE, count=5)
    cases = parse_cases(
        [
            {"value": "[[1, 2, 3], 5]", "rationale": "case thường"},
            {"value": "[[1, 2, 3]]", "rationale": "thiếu tham số"},
            {"value": "không phải JSON", "rationale": "hỏng"},
            {"value": "{\"nums\": []}", "rationale": "không phải mảng"},
            {"value": "   ", "rationale": "rỗng"},
        ],
        body,
    )
    assert [case.args for case in cases] == [[[1, 2, 3], 5]]


def test_parse_skips_duplicates_of_existing_and_of_each_other():
    body = build(
        ioMode="function",
        signature=SIGNATURE,
        existing=[{"args": [[1, 2, 3], 5]}],
        count=5,
    )
    cases = parse_cases(
        [
            {"value": "[[1,2,3], 5]", "rationale": "trùng existing"},
            {"value": "[[], 0]", "rationale": "mảng rỗng"},
            {"value": "[[], 0]", "rationale": "trùng chính nó"},
        ],
        body,
    )
    assert [case.args for case in cases] == [[[], 0]]


def test_parse_never_returns_more_than_requested():
    body = build(count=2)
    cases = parse_cases(
        [{"value": f"{n}\n", "rationale": "case"} for n in range(5)], body
    )
    assert len(cases) == 2
    assert all(case.args is None and case.input for case in cases)


def test_parse_never_invents_expected_values():
    """Ranh giới phạm vi: model chỉ sinh đầu vào, `expected` do judge chạy lời giải mẫu."""
    body = build(ioMode="function", signature=SIGNATURE)
    cases = parse_cases([{"value": "[[1], 1]", "rationale": "một phần tử"}], body)
    assert "expected" not in cases[0].model_dump(exclude_none=True)
