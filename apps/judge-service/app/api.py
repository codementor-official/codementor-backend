"""HTTP: chạy thử một bài ngay, không qua Kafka.

Đường này tồn tại vì submission-service chưa được viết — chưa ai phát `cmd.judge.run.v1`, nên
nếu judge chỉ nghe Kafka thì không có bài nào được chấm. Nó cũng đúng với nút "Chạy thử" ở
studio: giảng viên muốn kết quả ngay, không muốn tạo một bài nộp.

Không ghi Mongo và không phát event: đây là chạy thử, không phải bài nộp.
"""

import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import require_user
from app.config import settings
from app.grading import ExecutionError, JudgeSpec, grade
from app.services.judgement import JudgeCase
from app.services.langs import DriverSpec, Param, UnsupportedType, starter_for

router = APIRouter(prefix="/api/v1/judge", tags=["judge"])


class TestCaseIn(BaseModel):
    order: int = Field(ge=1)
    # stdin/stdout: đầu vào và đáp án đều là chuỗi.
    input: str = ""
    # Chế độ hàm: tham số theo vị trí, và đáp án là giá trị JSON bất kỳ. `expected` giữ mặc
    # định là chuỗi rỗng để client cũ gửi `"5"` vẫn hợp lệ.
    args: list[Any] | None = None
    expected: Any = ""
    weight: float = 1.0


class ParameterIn(BaseModel):
    name: str
    #: Nút Type IR, ví dụ `{"kind": "list", "of": {"kind": "float"}}`.
    type: dict = Field(default_factory=dict)


class SpecIn(BaseModel):
    """Khớp `JudgeSpecV1`. Có mặt = chấm theo chữ ký hàm.

    `parameters`/`returnType` là bắt buộc với ngôn ngữ kiểu tĩnh (Java, Go, C, C++): driver
    khai báo biến theo đúng kiểu đó. Python và JavaScript bỏ qua chúng.
    """

    functionName: str
    parameters: list[ParameterIn] = Field(default_factory=list)
    returnType: dict = Field(default_factory=lambda: {"kind": "void"})
    judgeMode: Literal["exact", "float", "unordered"] = "exact"
    judgeConfig: dict = Field(default_factory=dict)


class RunRequest(BaseModel):
    """Khớp `JudgeRunV1`, bỏ `submissionId` vì chạy thử không gắn với bài nộp nào."""

    language: str
    sourceCode: str
    timeLimitMs: int = Field(default=1000, ge=100, le=60_000)
    memoryLimitKb: int = Field(default=262_144, ge=1024, le=4_194_304)
    spec: SpecIn | None = None
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
    consoleOutput: str = ""


class RunResponse(BaseModel):
    """Bọc `{ data }` giống ResponseInterceptor của các service Nest.

    Client dùng chung một hàm `unwrap` đọc `response.data`; trả JSON trần ở đây thì mọi lời
    gọi tới judge nhận về undefined trong khi HTTP vẫn 200.
    """

    data: RunResult


def _size_of(value: Any) -> int:
    """Kích thước một phần của test case, tính bằng byte.

    Chế độ hàm cho `expected` và `args` là giá trị JSON, không phải chuỗi — đo bằng dạng
    serialize của chúng, vì đó chính là thứ sẽ đi vào container.
    """
    if value is None:
        return 0
    if isinstance(value, str):
        return len(value.encode())
    return len(json.dumps(value, default=repr).encode())


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
        if any(
            _size_of(part) > settings.max_test_case_bytes
            for part in (case.input, case.expected, case.args)
        ):
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"test case {case.order} vượt {settings.max_test_case_bytes} byte",
            )


@router.post("/run", response_model=RunResponse)
async def run(payload: RunRequest, _user: dict = Depends(require_user)) -> RunResponse:
    _reject_oversized(payload)

    cases = [
        JudgeCase(
            order=c.order,
            input=c.input,
            args=c.args,
            expected=c.expected,
            weight=c.weight,
        )
        for c in payload.testCases
    ]

    spec = (
        JudgeSpec(
            function_name=payload.spec.functionName,
            parameters=[{"name": p.name, "type": p.type} for p in payload.spec.parameters],
            return_type=payload.spec.returnType,
            checker=payload.spec.judgeMode,
            config=payload.spec.judgeConfig,
        )
        if payload.spec
        else None
    )

    try:
        result = await grade(
            language=payload.language,
            source_code=payload.sourceCode,
            time_limit_ms=payload.timeLimitMs,
            memory_limit_kb=payload.memoryLimitKb,
            cases=cases,
            spec=spec,
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
            consoleOutput=result.console_output,
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


class StarterRequest(BaseModel):
    """Sinh mã khởi tạo từ một chữ ký hàm."""

    languages: list[str] = Field(default_factory=list)
    spec: SpecIn


class StarterResult(BaseModel):
    #: languageId → mã khởi tạo. Ngôn ngữ không diễn tả được chữ ký này thì vắng khỏi đây.
    starters: dict[str, str]
    #: languageId → lý do, cho những ngôn ngữ bị bỏ. Người ra đề cần biết vì sao.
    unsupported: dict[str, str] = Field(default_factory=dict)


class StarterResponse(BaseModel):
    """Bọc `{ data }` như mọi response khác — client dùng chung một hàm `unwrap`."""

    data: StarterResult


@router.post("/starter", response_model=StarterResponse)
async def starter(
    payload: StarterRequest, _user: dict = Depends(require_user)
) -> StarterResponse:
    """Mã khởi tạo cho học viên, sinh từ chữ ký hàm.

    Sinh ở đây chứ không ở frontend: mã khởi tạo và driver PHẢI khớp nhau tuyệt đối, và cách
    duy nhất đảm bảo điều đó là để cùng một module sinh ra cả hai. Một bảng ánh xạ kiểu thứ
    hai viết bằng TypeScript sẽ lệch, và lúc lệch thì học viên nhận một bài không giải đúng
    được.
    """
    spec = DriverSpec(
        function_name=payload.spec.functionName,
        parameters=tuple(
            Param(name=p.name, type=p.type) for p in payload.spec.parameters
        ),
        return_type=payload.spec.returnType or {"kind": "void"},
    )

    generated: dict[str, str] = {}
    unsupported: dict[str, str] = {}
    for language in payload.languages:
        try:
            generated[language] = starter_for(language, spec)
        except UnsupportedType as exc:
            unsupported[language] = str(exc)

    return StarterResponse(data=StarterResult(starters=generated, unsupported=unsupported))
