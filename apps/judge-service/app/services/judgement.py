"""Chính sách chấm: cái gì tính là đạt, verdict nào thắng, điểm tính ra sao.

Tách khỏi docker_executor để chính sách nằm một chỗ rõ ràng, và để phần này kiểm thử được
mà không cần Docker.

Từ vựng verdict ở đây là của `JudgeCompletedV1` (libs/contracts), không phải của engine tham
khảo — bên đó dùng "Passed"/"Wrong Answer", CodeMentor dùng snake_case.
"""

from dataclasses import dataclass

# Khớp JudgeCompletedV1.verdict.
ACCEPTED = "accepted"
WRONG_ANSWER = "wrong_answer"
COMPILE_ERROR = "compile_error"
RUNTIME_ERROR = "runtime_error"
TIMEOUT = "timeout"
MEMORY_EXCEEDED = "memory_exceeded"


@dataclass
class JudgeCase:
    """Một test case trong `JudgeRunV1.testCases[]`."""

    order: int
    input: str
    expected: str
    weight: float = 1.0


def determine_verdict(
    exit_code: int | None,
    timed_out: bool,
    stdout: str,
    expected_output: str,
    oom_killed: bool = False,
) -> str:
    """Verdict của MỘT test case.

    Thứ tự kiểm tra không tuỳ tiện: hết giờ và hết bộ nhớ đều kết thúc bằng SIGKILL, nên nếu
    hỏi exit code trước thì cả hai đều thành runtime error. OOM đứng trước timeout vì
    container bị giết vì bộ nhớ cũng thường chạm luôn giới hạn thời gian.
    """
    if oom_killed:
        return MEMORY_EXCEEDED
    if timed_out:
        return TIMEOUT
    if exit_code != 0:
        return RUNTIME_ERROR
    # So sánh sau khi bỏ khoảng trắng hai đầu: dòng mới cuối file là chuyện của trình in ấn,
    # không phải chuyện của lời giải.
    return ACCEPTED if stdout.strip() == expected_output.strip() else WRONG_ANSWER


def overall_verdict(case_verdicts: list[str], compile_failed: bool = False) -> str:
    """Verdict của cả bài nộp.

    Biên dịch hỏng thì không case nào chạy, nên nó thắng tất cả. Ngược lại, verdict đầu tiên
    khác `accepted` là thứ người học cần sửa trước — báo nó, không phải cái cuối cùng.
    """
    if compile_failed:
        return COMPILE_ERROR
    if not case_verdicts:
        # Không có case nào để chấm. Gọi là accepted thì một bài chưa có test case sẽ đạt
        # điểm tuyệt đối; wrong_answer sát thực tế hơn.
        return WRONG_ANSWER
    for verdict in case_verdicts:
        if verdict != ACCEPTED:
            return verdict
    return ACCEPTED


def score_of(cases: list[JudgeCase], case_verdicts: list[str]) -> int:
    """Điểm 0–100 theo trọng số của các case đã đạt.

    `weight` có sẵn trong hợp đồng nhưng trước nay chưa ai dùng. Bài toàn case weight 0, hoặc
    bài không có case nào, cho 0 chứ không chia cho 0.
    """
    total_weight = sum(case.weight for case in cases)
    if total_weight <= 0:
        return 0
    passed_weight = sum(
        case.weight
        for case, verdict in zip(cases, case_verdicts, strict=False)
        if verdict == ACCEPTED
    )
    return round(passed_weight / total_weight * 100)
