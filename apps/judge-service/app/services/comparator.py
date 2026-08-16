"""So sánh giá trị trả về ở chế độ chữ ký hàm.

Chạy **phía host**, không phải trong container. Đó là khác biệt cố ý so với đặc tả: đáp án
không bao giờ được nạp vào sandbox, nên trong đó không có gì để học viên đọc trộm. Đổi lại,
mọi ngôn ngữ mới chỉ phải viết driver (chạy hàm, in JSON) chứ không viết lại phần so sánh.

Đầu vào là giá trị đã qua JSON, không phải chuỗi stdout: `[2.0, 1.0]` là một list, không phải
`"2.00 1.00"`. Nhờ vậy chấm không còn phụ thuộc cách in ấn.
"""

import json
import math
from typing import Any

EXACT = "exact"
FLOAT = "float"
UNORDERED = "unordered"

DEFAULT_ABS_EPS = 1e-6
DEFAULT_REL_EPS = 1e-6


def _is_number(value: Any) -> bool:
    """bool đứng ngoài. Python coi `True == 1`, nhưng học viên trả `True` cho bài cần `1`
    thì đó là sai kiểu, không phải đúng."""
    return isinstance(value, int | float) and not isinstance(value, bool)


def _numbers_equal(actual: Any, expected: Any, config: dict, tolerant: bool) -> bool:
    if not tolerant:
        # `2 == 2.0` là True trong Python — đúng ý muốn: học viên Python trả int cho bài khai
        # kiểu float không nên bị đánh sai.
        return actual == expected
    if math.isnan(actual) or math.isnan(expected):
        return math.isnan(actual) and math.isnan(expected)
    if math.isinf(actual) or math.isinf(expected):
        return actual == expected
    abs_eps = config.get("absEps", DEFAULT_ABS_EPS)
    rel_eps = config.get("relEps", DEFAULT_REL_EPS)
    return abs(actual - expected) <= max(abs_eps, rel_eps * abs(expected))


def _equal(actual: Any, expected: Any, config: dict, tolerant: bool) -> bool:
    if _is_number(actual) and _is_number(expected):
        return _numbers_equal(actual, expected, config, tolerant)
    # None/null/undefined đều về None sau khi qua JSON. Chỉ bằng chính nó — `[]` và `null`
    # là hai kết quả khác nhau và lẫn chúng là lỗi kinh điển.
    if actual is None or expected is None:
        return actual is None and expected is None
    if isinstance(actual, bool) or isinstance(expected, bool):
        return actual is expected
    if isinstance(actual, list) and isinstance(expected, list):
        return len(actual) == len(expected) and all(
            _equal(a, e, config, tolerant) for a, e in zip(actual, expected, strict=True)
        )
    if isinstance(actual, dict) and isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(
            _equal(actual[key], expected[key], config, tolerant) for key in expected
        )
    return type(actual) is type(expected) and actual == expected


def _canonical(value: Any) -> str:
    """Khoá sắp xếp cho so sánh đa tập.

    Mọi số về float để `2` và `2.0` cho cùng một khoá — cùng quy ước với `_numbers_equal`.
    ponytail: int rất lớn mất chính xác khi ép float; đổi sang khoá (type_tag, value) nếu có
    bài thật cần so đa tập trên số nguyên ngoài 2^53.
    """
    if _is_number(value):
        return json.dumps(float(value))
    if isinstance(value, list):
        return json.dumps([_canonical(item) for item in value])
    if isinstance(value, dict):
        return json.dumps({key: _canonical(value[key]) for key in sorted(value)})
    return json.dumps(value, default=repr)


def compare(actual: Any, expected: Any, mode: str = EXACT, config: dict | None = None) -> bool:
    """`True` nếu kết quả được coi là đạt.

    `mode` lấy thẳng từ `evaluation.checker` của đề bài. Giá trị của chế độ stdin cũ
    (`trimmed`, `custom`) rơi về `exact` — ở chế độ hàm chúng không còn nghĩa, và im lặng
    chấp nhận vẫn tốt hơn là ném lỗi hạ tầng vào mặt học viên.
    """
    config = config or {}

    if mode == UNORDERED:
        # So đa tập chỉ có nghĩa với danh sách; kiểu khác thì không có "thứ tự" để bỏ qua.
        if not isinstance(actual, list) or not isinstance(expected, list):
            return _equal(actual, expected, config, tolerant=False)
        if len(actual) != len(expected):
            return False
        return sorted(map(_canonical, actual)) == sorted(map(_canonical, expected))

    return _equal(actual, expected, config, tolerant=(mode == FLOAT))
