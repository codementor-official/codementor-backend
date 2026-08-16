"""Chấm thật, bằng container thật.

Cần Docker daemon và sáu image runner (`npm run judge:images`). Đánh dấu `docker` để tách
khỏi test chính sách chạy trong CI không có daemon:

    uv run pytest -m docker
    uv run pytest -m "not docker"

Mỗi verdict một bài. `memory_exceeded` là ca đáng giá nhất ở đây: nó phân biệt được với
`timeout` chỉ nhờ cờ OOMKilled của daemon, mà cờ đó thì không giả lập được.
"""

import pytest

from app.grading import grade
from app.services.judgement import JudgeCase

pytestmark = pytest.mark.docker

ADD_TWO = "a, b = map(int, input().split())\nprint(a + b)"
CASES = [
    JudgeCase(order=1, input="2 3", expected="5", weight=1),
    JudgeCase(order=2, input="10 5", expected="15", weight=3),
]


async def _grade(source: str, **overrides):
    return await grade(
        language=overrides.pop("language", "python"),
        source_code=source,
        time_limit_ms=overrides.pop("time_limit_ms", 5000),
        memory_limit_kb=overrides.pop("memory_limit_kb", 262_144),
        cases=overrides.pop("cases", CASES),
    )


async def test_accepted():
    result = await _grade(ADD_TWO)
    assert result.verdict == "accepted"
    assert result.score == 100
    assert result.passed_tests == 2


async def test_wrong_answer():
    result = await _grade("a, b = map(int, input().split())\nprint(a - b)")
    assert result.verdict == "wrong_answer"
    assert result.score == 0


async def test_partial_credit_is_weighted():
    # Case 1 (weight 1) đạt, case 2 (weight 3) trượt → 25, không phải 50.
    cases = [
        JudgeCase(order=1, input="2 3", expected="5", weight=1),
        JudgeCase(order=2, input="10 5", expected="999", weight=3),
    ]
    result = await _grade(ADD_TWO, cases=cases)
    assert result.score == 25
    assert result.passed_tests == 1


async def test_runtime_error():
    assert (await _grade("raise SystemExit(3)")).verdict == "runtime_error"


async def test_timeout():
    result = await _grade("while True: pass", time_limit_ms=1000)
    assert result.verdict == "timeout"


async def test_memory_exceeded_is_not_reported_as_timeout():
    result = await _grade(
        "x = bytearray(400 * 1024 * 1024)\nprint(len(x))",
        memory_limit_kb=64 * 1024,
    )
    assert result.verdict == "memory_exceeded"


async def test_compile_error_runs_no_cases():
    result = await _grade("int main(){ return oops; }", language="cpp")
    assert result.verdict == "compile_error"
    assert result.cases == []
    assert "oops" in (result.compile_output or "")


async def test_compiled_language_end_to_end():
    java = (
        "import java.util.*;\n"
        "public class Main{public static void main(String[] a){"
        "Scanner s=new Scanner(System.in);System.out.println(s.nextInt()+s.nextInt());}}"
    )
    result = await _grade(
        java,
        language="java",
        time_limit_ms=10_000,
        cases=[JudgeCase(order=1, input="2 3", expected="5")],
    )
    assert result.verdict == "accepted"
