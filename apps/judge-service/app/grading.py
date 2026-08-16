"""Chấm một bài nộp: từ payload `JudgeRunV1` ra kết quả đã tổng hợp.

Đây là phần chung của HTTP và Kafka. Cửa vào khác nhau, cách chấm thì không — nếu để mỗi cửa
tự tổng hợp verdict thì sớm muộn hai đường cho ra hai điểm số khác nhau cho cùng một bài.
"""

import asyncio
import json
import socket
from dataclasses import dataclass, field

from app.services.execution_engine import (
    ExecutionError,
    run_against_testcases,
    run_function_mode,
)
from app.services.judgement import (
    ACCEPTED,
    MEMORY_EXCEEDED,
    RUNTIME_ERROR,
    SKIPPED,
    TIMEOUT,
    WRONG_ANSWER,
    JudgeCase,
    overall_verdict,
    score_of,
    verdict_for_function_case,
)
from app.services.langs import DriverSpec, Param

WORKER = socket.gethostname()


@dataclass
class JudgeSpec:
    """Ảnh chụp cách chấm một bài ở chế độ chữ ký hàm — khớp `JudgeSpecV1` trong contracts.

    `parameters` và `return_type` bắt buộc phải có với ngôn ngữ kiểu tĩnh: driver Java, Go, C,
    C++ khai báo biến và gọi hàm theo đúng kiểu đó. Python và JavaScript không cần chúng, và
    chính chỗ này từng chỉ mang `function_name` — cho tới khi có ngôn ngữ thứ ba.
    """

    function_name: str
    parameters: list[dict] = field(default_factory=list)
    return_type: dict = field(default_factory=lambda: {"kind": "void"})
    checker: str = "exact"
    config: dict = field(default_factory=dict)

    def driver_spec(self, time_limit_sec: float) -> DriverSpec:
        return DriverSpec(
            function_name=self.function_name,
            parameters=tuple(
                Param(name=p["name"], type=p.get("type") or {}) for p in self.parameters
            ),
            return_type=self.return_type or {"kind": "void"},
            time_limit_sec=time_limit_sec,
        )


@dataclass
class CaseOutcome:
    order: int
    verdict: str
    input: str
    expected: str
    actual: str
    stderr: str
    runtime_ms: int
    memory_kb: int


@dataclass
class GradeResult:
    verdict: str
    score: int
    passed_tests: int
    total_tests: int
    runtime_ms: int
    memory_kb: int
    compile_output: str | None
    cases: list[CaseOutcome]
    # Những gì học viên `print` ra. Ở chế độ hàm stdout không còn là đáp án nên nó quay về
    # đúng vai trò console gỡ lỗi; ở chế độ stdin nó CHÍNH LÀ đáp án nên để rỗng.
    console_output: str = ""


def _as_text(value: object) -> str:
    """Giá trị JSON → chuỗi để hiển thị và để ghi Mongo.

    Validator `submission_run_details` khai `expected`/`actual` là string. Serialize ở đây
    thay vì nới validator: giao diện vốn hiển thị hai trường này dạng text, và `[2.0, 1.0]`
    đọc ra đúng như thế.
    """
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, default=repr)


async def grade(
    *,
    language: str,
    source_code: str,
    time_limit_ms: int,
    memory_limit_kb: int,
    cases: list[JudgeCase],
    spec: JudgeSpec | None = None,
) -> GradeResult:
    """Chạy và tổng hợp. Ném `ExecutionError` khi lỗi ở tầng Docker daemon.

    docker-py là đồng bộ và một bài nộp có thể chạy hàng giây, nên nó đi qua một luồng riêng;
    chạy thẳng trong event loop sẽ chặn mọi request khác của FastAPI.

    `spec` quyết định chế độ. Vắng mặt = stdin/stdout, đường đã có từ đầu, không đổi gì.
    """
    # Backend đo bằng ms và KB, engine nhận giây và MB. Sàn 1s/64MB: làm tròn xuống 0 sẽ
    # thành "hết giờ ngay lập tức", và Docker từ chối mem_limit dưới 6MB.
    time_limit_sec = max(1, round(time_limit_ms / 1000))
    memory_limit_mb = max(64, round(memory_limit_kb / 1024))

    if spec is not None:
        return await _grade_function_mode(
            language=language,
            source_code=source_code,
            cases=cases,
            spec=spec,
            time_limit_ms=time_limit_ms,
            time_limit_sec=time_limit_sec,
            memory_limit_mb=memory_limit_mb,
        )

    results, compile_output = await asyncio.to_thread(
        run_against_testcases,
        cases,
        language,
        source_code,
        time_limit_sec=time_limit_sec,
        memory_limit_mb=memory_limit_mb,
    )

    if compile_output is not None:
        return GradeResult(
            verdict=overall_verdict([], compile_failed=True),
            score=0,
            passed_tests=0,
            total_tests=len(cases),
            runtime_ms=0,
            memory_kb=0,
            compile_output=compile_output,
            cases=[],
        )

    by_order = {case.order: case for case in cases}
    case_verdicts = [result.verdict for result in results]

    outcomes = [
        CaseOutcome(
            order=result.order,
            verdict=result.verdict,
            input=by_order[result.order].input if result.order in by_order else "",
            expected=result.expected,
            actual=result.stdout,
            stderr=result.stderr,
            # Validator của submission_run_details khai runtimeMs/memoryKb là int; gửi float
            # vào là cả document bị từ chối.
            runtime_ms=round(result.time_ms or 0),
            memory_kb=round((result.peak_memory_mb or 0) * 1024),
        )
        for result in results
    ]

    return GradeResult(
        verdict=overall_verdict(case_verdicts),
        score=score_of(cases, case_verdicts),
        passed_tests=sum(1 for verdict in case_verdicts if verdict == ACCEPTED),
        total_tests=len(cases),
        runtime_ms=sum(outcome.runtime_ms for outcome in outcomes),
        # Đỉnh, không phải tổng. Thường là 0 — xem README §Giới hạn đo lường.
        memory_kb=max((outcome.memory_kb for outcome in outcomes), default=0),
        compile_output=None,
        cases=outcomes,
    )


async def _grade_function_mode(
    *,
    language: str,
    source_code: str,
    cases: list[JudgeCase],
    spec: JudgeSpec,
    time_limit_ms: int,
    time_limit_sec: int,
    memory_limit_mb: int,
) -> GradeResult:
    """Chấm theo chữ ký hàm: driver chạy trong sandbox, so sánh chạy ở đây.

    Cả bài nộp dùng chung một container, nên phải xử lý được trường hợp container chết giữa
    chừng: driver flush sau mỗi case, thiếu bản ghi nghĩa là case đó chưa xong.
    """
    outcome = await asyncio.to_thread(
        run_function_mode,
        cases,
        language,
        source_code,
        spec.driver_spec(time_limit_sec),
        memory_limit_mb=memory_limit_mb,
    )

    if outcome.compile_output is not None:
        # Không dựng case giả: phía trên còn phải phân biệt "0/5 case đạt" với "chưa case nào
        # được chạy" — cùng quy ước với đường stdin.
        return GradeResult(
            verdict=overall_verdict([], compile_failed=True),
            score=0,
            passed_tests=0,
            total_tests=len(cases),
            runtime_ms=0,
            memory_kb=0,
            compile_output=outcome.compile_output,
            cases=[],
        )

    outcomes: list[CaseOutcome] = []
    case_verdicts: list[str] = []
    # Case đầu tiên không có bản ghi là case đã giết container — nó chịu trách nhiệm, những
    # case sau nó chỉ là chưa tới lượt.
    blamed = False

    for case in cases:
        record = outcome.records.get(case.order) or {}

        if outcome.fatal is not None:
            # Không nạp được module học viên (lỗi cú pháp, sai tên hàm). Python không có bước
            # biên dịch riêng nên đây là lỗi khi chạy, không phải compile_error — cùng quy ước
            # với đường stdin, nơi lỗi cú pháp cũng lộ ra lúc chạy.
            verdict, detail = RUNTIME_ERROR, outcome.fatal
        else:
            verdict = verdict_for_function_case(
                outcome.records.get(case.order), case.expected, spec.checker, spec.config
            )
            detail = record.get("message", "")
            # Chỉ Python, Go và C cắt được case hết giờ ngay lúc nó đang chạy. Java, C++,
            # JavaScript, PHP thì không — nên một case CHẠY XONG nhưng quá giờ vẫn phải là
            # timeout, đối chiếu sau khi chạy. Không áp lên runtime_error: lỗi cụ thể hơn.
            elapsed = record.get("runtime_ms") or 0
            if verdict in (ACCEPTED, WRONG_ANSWER) and elapsed > time_limit_ms:
                verdict = TIMEOUT
            if verdict == SKIPPED and not blamed:
                blamed = True
                verdict = MEMORY_EXCEEDED if outcome.oom_killed else TIMEOUT

        outcomes.append(
            CaseOutcome(
                order=case.order,
                verdict=verdict,
                input=_as_text(case.args or []),
                expected=_as_text(case.expected),
                actual=_as_text(record["actual"]) if "actual" in record else "",
                stderr=detail,
                # Validator của submission_run_details khai runtimeMs là int; gửi float vào là
                # cả document bị từ chối.
                runtime_ms=round(record.get("runtime_ms") or 0),
                # Đo bộ nhớ chỉ có ở mức container, mà container này chạy mọi case — gán cho
                # từng case thì con số nào cũng sai. Đỉnh chung nằm ở GradeResult.
                memory_kb=0,
            )
        )
        case_verdicts.append(verdict)

    return GradeResult(
        verdict=overall_verdict(case_verdicts),
        score=score_of(cases, case_verdicts),
        passed_tests=sum(1 for verdict in case_verdicts if verdict == ACCEPTED),
        total_tests=len(cases),
        runtime_ms=sum(outcome_.runtime_ms for outcome_ in outcomes),
        memory_kb=round((outcome.peak_memory_mb or 0) * 1024),
        compile_output=None,
        cases=outcomes,
        console_output=outcome.console_output,
    )


__all__ = [
    "CaseOutcome",
    "ExecutionError",
    "GradeResult",
    "JudgeSpec",
    "WORKER",
    "grade",
]
