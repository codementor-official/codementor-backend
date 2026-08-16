"""Chính sách chấm: cái gì tính là đạt, verdict nào thắng, điểm tính ra sao.

Tách khỏi docker_executor để chính sách nằm một chỗ rõ ràng, và để phần này kiểm thử được
mà không cần Docker.

Từ vựng verdict ở đây là của `JudgeCompletedV1` (libs/contracts), không phải của engine tham
khảo — bên đó dùng "Passed"/"Wrong Answer", CodeMentor dùng snake_case.
"""

from dataclasses import dataclass
from typing import Any

from app.services.comparator import compare

# Khớp JudgeCompletedV1.verdict.
ACCEPTED = "accepted"
WRONG_ANSWER = "wrong_answer"
COMPILE_ERROR = "compile_error"
RUNTIME_ERROR = "runtime_error"
TIMEOUT = "timeout"
MEMORY_EXCEEDED = "memory_exceeded"
# Chỉ có ở chế độ hàm: cả bài nộp chạy trong MỘT container, nên container chết giữa chừng để
# lại những case chưa kịp chạy. Ở chế độ stdin mỗi case một container nên không có trạng thái
# này — không case nào bị bỏ dở vì case khác.
SKIPPED = "skipped"


@dataclass
class JudgeCase:
    """Một test case trong `JudgeRunV1.testCases[]`.

    Hai chế độ dùng chung một lớp: stdin/stdout đọc `input` + `expected` dạng chuỗi, chế độ
    hàm đọc `args` + `expected` dạng giá trị JSON. Tách thành hai lớp thì mọi hàm nhận test
    case đều phải nhận union, mà phần khác nhau chỉ có hai trường.
    """

    order: int
    input: str = ""
    expected: Any = ""
    args: list[Any] | None = None
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


def verdict_for_function_case(
    record: dict | None,
    expected: Any,
    checker: str = "exact",
    config: dict | None = None,
) -> str:
    """Verdict của MỘT case ở chế độ hàm, từ bản ghi driver ghi ra `results.ndjson`.

    `record is None` nghĩa là driver chưa kịp ghi gì cho case này — container đã chết. Người
    gọi phân biệt "case gây ra cái chết đó" với "case chưa tới lượt"; ở đây cả hai đều là
    `skipped` và người gọi nâng case đầu tiên lên `timeout`.
    """
    if record is None:
        return SKIPPED
    status = record.get("status")
    if status == "timeout":
        return TIMEOUT
    if status == "runtime_error":
        return RUNTIME_ERROR
    if status != "ok":
        return RUNTIME_ERROR
    return ACCEPTED if compare(record.get("actual"), expected, checker, config) else WRONG_ANSWER


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
