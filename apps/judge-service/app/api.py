"""HTTP: chạy thử một bài ngay, không qua Kafka.

Đường này tồn tại vì submission-service chưa được viết — chưa ai phát `cmd.judge.run.v1`, nên
nếu judge chỉ nghe Kafka thì không có bài nào được chấm. Nó cũng đúng với nút "Chạy thử" ở
studio: giảng viên muốn kết quả ngay, không muốn tạo một bài nộp.

Không ghi Mongo và không phát event: đây là chạy thử, không phải bài nộp.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import require_user
from app.config import settings
from app.grading import ExecutionError, grade
from app.services.judgement import JudgeCase

router = APIRouter(prefix="/api/v1/judge", tags=["judge"])


class TestCaseIn(BaseModel):
    order: int = Field(ge=1)
    input: str = ""
    expected: str = ""
    weight: float = 1.0


class RunRequest(BaseModel):
    """Khớp `JudgeRunV1`, bỏ `submissionId` vì chạy thử không gắn với bài nộp nào."""

    language: str
    sourceCode: str
    timeLimitMs: int = Field(default=1000, ge=100, le=60_000)
    memoryLimitKb: int = Field(default=262_144, ge=1024, le=4_194_304)
    testCases: list[TestCaseIn] = Field(default_factory=list)


class CaseOut(BaseModel):
    order: int
    verdict: str
    expected: str
    actual: str
    stderr: str
    runtimeMs: int
    memoryKb: int


class RunResult(BaseModel):
    verdict: str
    score: int
    passedTests: int
    totalTests: int
    runtimeMs: int
    memoryKb: int
    compileOutput: str | None
    cases: list[CaseOut]


class RunResponse(BaseModel):
    """Bọc `{ data }` giống ResponseInterceptor của các service Nest.

    Client dùng chung một hàm `unwrap` đọc `response.data`; trả JSON trần ở đây thì mọi lời
    gọi tới judge nhận về undefined trong khi HTTP vẫn 200.
    """

    data: RunResult


def _reject_oversized(payload: RunRequest) -> None:
    """Chặn đầu vào quá khổ trước khi chạm tới Docker.

    Không có nó thì một request là một cách làm cạn host, và tiến trình này giữ socket Docker.
    Giới hạn nằm ở config để chỉnh theo máy, không rải rác trong code.
    """
    if len(payload.sourceCode.encode()) > settings.max_source_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"mã nguồn vượt {settings.max_source_bytes} byte",
        )
    if len(payload.testCases) > settings.max_test_cases:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"quá {settings.max_test_cases} test case",
        )
    for case in payload.testCases:
        if (
            len(case.input.encode()) > settings.max_test_case_bytes
            or len(case.expected.encode()) > settings.max_test_case_bytes
        ):
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"test case {case.order} vượt {settings.max_test_case_bytes} byte",
            )


@router.post("/run", response_model=RunResponse)
async def run(payload: RunRequest, _user: dict = Depends(require_user)) -> RunResponse:
    _reject_oversized(payload)

    cases = [
        JudgeCase(order=c.order, input=c.input, expected=c.expected, weight=c.weight)
        for c in payload.testCases
    ]

    try:
        result = await grade(
            language=payload.language,
            source_code=payload.sourceCode,
            time_limit_ms=payload.timeLimitMs,
            memory_limit_kb=payload.memoryLimitKb,
            cases=cases,
        )
    except ExecutionError as exc:
        # Lỗi ở tầng daemon (thiếu image, daemon không phản hồi) là lỗi hạ tầng của chúng ta,
        # không phải lỗi của bài nộp — 502, không phải 400.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    return RunResponse(
        data=RunResult(
            verdict=result.verdict,
            score=result.score,
            passedTests=result.passed_tests,
            totalTests=result.total_tests,
            runtimeMs=result.runtime_ms,
            memoryKb=result.memory_kb,
            compileOutput=result.compile_output,
            cases=[
                CaseOut(
                    order=case.order,
                    verdict=case.verdict,
                    expected=case.expected,
                    actual=case.actual,
                    stderr=case.stderr,
                    runtimeMs=case.runtime_ms,
                    memoryKb=case.memory_kb,
                )
                for case in result.cases
            ],
        )
    )
