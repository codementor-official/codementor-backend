"""Chấm một bài nộp: từ payload `JudgeRunV1` ra kết quả đã tổng hợp.

Đây là phần chung của HTTP và Kafka. Cửa vào khác nhau, cách chấm thì không — nếu để mỗi cửa
tự tổng hợp verdict thì sớm muộn hai đường cho ra hai điểm số khác nhau cho cùng một bài.
"""

import asyncio
import socket
from dataclasses import dataclass

from app.services.execution_engine import ExecutionError, run_against_testcases
from app.services.judgement import (
    ACCEPTED,
    JudgeCase,
    overall_verdict,
    score_of,
)

WORKER = socket.gethostname()


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


async def grade(
    *,
    language: str,
    source_code: str,
    time_limit_ms: int,
    memory_limit_kb: int,
    cases: list[JudgeCase],
) -> GradeResult:
    """Chạy và tổng hợp. Ném `ExecutionError` khi lỗi ở tầng Docker daemon.

    docker-py là đồng bộ và một bài nộp có thể chạy hàng giây, nên nó đi qua một luồng riêng;
    chạy thẳng trong event loop sẽ chặn mọi request khác của FastAPI.
    """
    results, compile_output = await asyncio.to_thread(
        run_against_testcases,
        cases,
        language,
        source_code,
        # Backend đo bằng ms và KB, engine nhận giây và MB. Sàn 1s/64MB: làm tròn xuống 0 sẽ
        # thành "hết giờ ngay lập tức", và Docker từ chối mem_limit dưới 6MB.
        time_limit_sec=max(1, round(time_limit_ms / 1000)),
        memory_limit_mb=max(64, round(memory_limit_kb / 1024)),
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


__all__ = ["CaseOutcome", "ExecutionError", "GradeResult", "WORKER", "grade"]
