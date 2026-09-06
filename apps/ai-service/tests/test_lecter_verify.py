"""Chạy lời giải NẰM TRONG content sắp lưu.

Ca gốc: `lecter:085f0cde-…`. Model gửi `print('placeholder')` cho bộ chấm, nhận 0/3, rồi lưu một
chương trình khác hẳn. Bộ chấm chưa bao giờ thấy đoạn code được ghi xuống.
"""

from app.lecter import verify


def test_failing_run_blocks():
    errors, warnings = verify.summarize([
        {
            "language": "python",
            "verdict": "wrong_answer",
            "passed": 0,
            "total": 3,
            "failing": [{"order": 1, "verdict": "wrong_answer", "expected": "", "actual": "x"}],
        }
    ])
    assert warnings == []
    assert len(errors) == 1
    assert "KHÔNG chạy qua" in errors[0] and "0/3" in errors[0]


def test_broken_judge_only_warns():
    """Sandbox stdin từng hỏng cục bộ nhiều ngày. Chặn lưu khi không chấm được sẽ làm Lecter tê
    liệt lúc dev, nên đây phải là cảnh báo."""
    errors, warnings = verify.summarize([
        {"language": "python", "unavailable": "Không kết nối được dịch vụ"}
    ])
    assert errors == []
    assert "chưa ai xác nhận" in warnings[0]


def test_passing_run_says_nothing():
    assert verify.summarize([
        {"language": "go", "verdict": "accepted", "passed": 3, "total": 3, "failing": []}
    ]) == ([], [])


def test_judge_body_drops_null_expected_and_carries_signature():
    content = {
        "signature": {"functionName": "f", "parameters": [], "returnType": {"kind": "int"}},
        "testCases": [{"order": 1, "args": [1], "expected": None}],
    }
    body = verify._judge_body(content, {"id": "go", "referenceSolution": "func f() {}"})
    assert "expected" not in body["testCases"][0]
    assert body["spec"] == content["signature"]
    assert body["language"] == "go"
