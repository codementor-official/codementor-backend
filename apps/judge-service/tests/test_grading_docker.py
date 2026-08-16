"""Chấm thật, bằng container thật.

Cần Docker daemon và sáu image runner (`npm run judge:images`). Đánh dấu `docker` để tách
khỏi test chính sách chạy trong CI không có daemon:

    uv run pytest -m docker
    uv run pytest -m "not docker"

Mỗi verdict một bài. `memory_exceeded` là ca đáng giá nhất ở đây: nó phân biệt được với
`timeout` chỉ nhờ cờ OOMKilled của daemon, mà cờ đó thì không giả lập được.
"""

import pytest

from app.grading import JudgeSpec, grade
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


# Phải CHẠM vào từng trang, không chỉ cấp phát. `bytearray(n)` đi qua calloc → mmap, mà trang
# mmap ẩn danh đã được kernel xoá sẵn nên calloc không memset — bộ nhớ chỉ là ảo, cgroup không
# tính, và container không bao giờ chạm giới hạn. Ghi một byte mỗi 4096 mới là cấp phát thật.
HOG_MEMORY = (
    "x = bytearray(400 * 1024 * 1024)\n"
    "for i in range(0, len(x), 4096):\n"
    "    x[i] = 1\n"
    "print(len(x))"
)


async def test_memory_exceeded_is_not_reported_as_timeout():
    result = await _grade(HOG_MEMORY, memory_limit_kb=64 * 1024)
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


# --------------------------------------------------------------- function mode

SOLVE_QUADRATIC = """
def solve_quadratic(a, b, c):
    d = b * b - 4 * a * c
    if d < 0:
        return []
    if d == 0:
        return [-b / (2 * a)]
    r = d ** 0.5
    return sorted([(-b + r) / (2 * a), (-b - r) / (2 * a)], reverse=True)
"""

QUADRATIC_CASES = [
    JudgeCase(order=1, args=[1, -3, 2], expected=[2.0, 1.0]),
    JudgeCase(order=2, args=[1, 2, 1], expected=[-1.0]),
    # Danh sách rỗng, không phải null — ca dễ chấm nhầm nhất.
    JudgeCase(order=3, args=[1, 2, 5], expected=[]),
]


async def _grade_fn(source: str, *, cases=None, function_name="solve_quadratic", **overrides):
    return await grade(
        language="python",
        source_code=source,
        time_limit_ms=overrides.pop("time_limit_ms", 2000),
        memory_limit_kb=overrides.pop("memory_limit_kb", 262_144),
        cases=cases if cases is not None else QUADRATIC_CASES,
        spec=JudgeSpec(function_name=function_name, **overrides),
    )


async def test_function_mode_accepted():
    result = await _grade_fn(SOLVE_QUADRATIC, checker="float")
    assert result.verdict == "accepted"
    assert result.passed_tests == 3
    # Kết quả trả về là giá trị, không phải chuỗi stdout đã định dạng.
    assert result.cases[0].actual == "[2.0, 1.0]"


async def test_function_mode_wrong_answer_names_the_case():
    result = await _grade_fn(
        SOLVE_QUADRATIC.replace("reverse=True", "reverse=False"), checker="float"
    )
    assert result.verdict == "wrong_answer"
    assert result.cases[0].verdict == "wrong_answer"
    assert result.cases[2].verdict == "accepted"


async def test_function_mode_accepts_int_for_float_return():
    result = await _grade_fn(
        "def f(a, b):\n    return [a + b]",
        function_name="f",
        cases=[JudgeCase(order=1, args=[2, 3], expected=[5.0])],
    )
    assert result.verdict == "accepted"


async def test_print_does_not_corrupt_grading():
    # Học viên print để debug. Kết quả chấm phải nguyên vẹn, và output phải quay lại console.
    source = "def f(a, b):\n    print('debug', a, b)\n    return a + b"
    result = await _grade_fn(
        source, function_name="f", cases=[JudgeCase(order=1, args=[2, 3], expected=5)]
    )
    assert result.verdict == "accepted"
    assert "debug 2 3" in result.console_output


async def test_student_cannot_read_the_test_file():
    source = (
        "import os\n"
        "def f(a, b):\n"
        "    return os.path.exists(os.path.join(os.path.dirname(__file__), 'tests.json'))\n"
    )
    result = await _grade_fn(
        source, function_name="f", cases=[JudgeCase(order=1, args=[1, 1], expected=False)]
    )
    assert result.verdict == "accepted"


async def test_syntax_error_is_runtime_error_not_internal_error():
    result = await _grade_fn("def f(a, b)\n    return a", function_name="f")
    assert result.verdict == "runtime_error"
    assert all(case.verdict == "runtime_error" for case in result.cases)


async def test_missing_function_name_is_reported_on_every_case():
    result = await _grade_fn("def other():\n    pass", function_name="f")
    assert result.verdict == "runtime_error"
    assert "f" in result.cases[0].stderr


async def test_per_case_timeout_does_not_stop_the_run():
    # Driver cắt vòng lặp thuần Python bằng setitimer, nên case sau vẫn được chạy — khác với
    # container bị giết cứng, lúc đó phần còn lại mới là `skipped`.
    source = (
        "def f(n):\n"
        "    if n == 2:\n"
        "        while True:\n"
        "            pass\n"
        "    return n\n"
    )
    result = await _grade_fn(
        source,
        function_name="f",
        time_limit_ms=1000,
        cases=[
            JudgeCase(order=1, args=[1], expected=1),
            JudgeCase(order=2, args=[2], expected=2),
            JudgeCase(order=3, args=[3], expected=3),
        ],
    )
    assert [case.verdict for case in result.cases] == ["accepted", "timeout", "accepted"]
    assert result.verdict == "timeout"


async def test_memory_exceeded_is_not_reported_as_runtime_error():
    source = (
        "def f(n):\n"
        "    x = bytearray(400 * 1024 * 1024)\n"
        # Xem HOG_MEMORY: không chạm trang thì cgroup không tính, và bài này sẽ "đạt".
        "    for i in range(0, len(x), 4096):\n"
        "        x[i] = 1\n"
        "    return len(x)\n"
    )
    result = await _grade_fn(
        source,
        function_name="f",
        memory_limit_kb=64 * 1024,
        cases=[JudgeCase(order=1, args=[1], expected=1)],
    )
    assert result.verdict == "memory_exceeded"


async def test_unordered_checker():
    result = await _grade_fn(
        "def f(n):\n    return [3, 1, 2]",
        function_name="f",
        checker="unordered",
        cases=[JudgeCase(order=1, args=[0], expected=[1, 2, 3])],
    )
    assert result.verdict == "accepted"
