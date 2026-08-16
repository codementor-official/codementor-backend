"""Chính sách chấm — chạy được mà không cần Docker.

Đây là chỗ dễ sai nhất của service: thứ tự ưu tiên verdict, và công thức điểm khi trọng số
bất thường.
"""

from app.services.judgement import (
    ACCEPTED,
    COMPILE_ERROR,
    MEMORY_EXCEEDED,
    RUNTIME_ERROR,
    TIMEOUT,
    WRONG_ANSWER,
    JudgeCase,
    determine_verdict,
    overall_verdict,
    score_of,
)


def test_accepted_ignores_surrounding_whitespace():
    assert determine_verdict(0, False, "42\n", "42") == ACCEPTED
    assert determine_verdict(0, False, "  42  ", "42\n") == ACCEPTED


def test_wrong_answer_when_output_differs():
    assert determine_verdict(0, False, "41", "42") == WRONG_ANSWER


def test_nonzero_exit_is_runtime_error():
    assert determine_verdict(1, False, "", "42") == RUNTIME_ERROR


def test_timeout_beats_exit_code():
    # Container bị giết vì hết giờ cũng trả exit code khác 0; hỏi exit code trước thì mọi
    # TLE đều thành runtime error.
    assert determine_verdict(137, True, "", "42") == TIMEOUT


def test_oom_beats_timeout():
    # OOM thường chạm luôn giới hạn thời gian. Nguyên nhân thật là bộ nhớ.
    assert determine_verdict(137, True, "", "42", oom_killed=True) == MEMORY_EXCEEDED


def test_overall_compile_error_wins():
    assert overall_verdict([ACCEPTED, ACCEPTED], compile_failed=True) == COMPILE_ERROR


def test_overall_reports_first_failure_not_last():
    assert overall_verdict([ACCEPTED, TIMEOUT, WRONG_ANSWER]) == TIMEOUT


def test_overall_all_passed():
    assert overall_verdict([ACCEPTED, ACCEPTED]) == ACCEPTED


def test_overall_without_cases_is_not_accepted():
    # Bài chưa có test case nào mà cho accepted thì nó đạt điểm tuyệt đối miễn phí.
    assert overall_verdict([]) == WRONG_ANSWER


def _cases(*weights: float) -> list[JudgeCase]:
    return [JudgeCase(order=i + 1, input="", expected="", weight=w) for i, w in enumerate(weights)]


def test_score_is_weighted():
    cases = _cases(1, 3)
    assert score_of(cases, [ACCEPTED, WRONG_ANSWER]) == 25
    assert score_of(cases, [WRONG_ANSWER, ACCEPTED]) == 75


def test_score_all_passed_is_100():
    assert score_of(_cases(2, 2, 1), [ACCEPTED] * 3) == 100


def test_score_survives_zero_total_weight():
    assert score_of(_cases(0, 0), [ACCEPTED, ACCEPTED]) == 0


def test_score_without_cases_is_zero():
    assert score_of([], []) == 0
