"""Chế độ chữ ký hàm, chạy thật trên cả tám ngôn ngữ.

Cần Docker daemon và sáu image runner (`npm run judge:images`).

Hai bài, cố tình chọn để bắt đúng chỗ dễ vỡ:

- `add_two(int, int) -> int` — đường đi tối thiểu: nạp bài, gọi hàm, trả một giá trị vô hướng.
- `top_two(list<float>) -> list<float>` — mảng vào, mảng ra. Đây là chỗ C phải tách tham số
  (`double* nums, int numsSize`) và trả độ dài qua `int* returnSize`, còn Java phải khớp
  `double[]` chứ không phải `List<Double>`.
"""

import pytest

from app.grading import JudgeSpec, grade
from app.services.judgement import JudgeCase

pytestmark = pytest.mark.docker

FLOAT = {"kind": "float"}
INT = {"kind": "int"}
FLOAT_LIST = {"kind": "list", "of": FLOAT}

ADD_TWO_SPEC = JudgeSpec(
    function_name="add_two",
    parameters=[{"name": "a", "type": INT}, {"name": "b", "type": INT}],
    return_type=INT,
)

TOP_TWO_SPEC = JudgeSpec(
    function_name="top_two",
    parameters=[{"name": "nums", "type": FLOAT_LIST}],
    return_type=FLOAT_LIST,
    checker="float",
)

ADD_TWO = {
    "python": "def add_two(a, b):\n    return a + b\n",
    "javascript": "function addTwo(a, b) {\n  return a + b;\n}\n",
    "typescript": "function addTwo(a: number, b: number): number {\n  return a + b;\n}\n",
    "java": (
        "class Solution {\n"
        "    public int addTwo(int a, int b) {\n        return a + b;\n    }\n}\n"
    ),
    "go": "package main\n\nfunc addTwo(a int, b int) int {\n\treturn a + b\n}\n",
    "php": "<?php\n\nfunction addTwo(int $a, int $b): int\n{\n    return $a + $b;\n}\n",
    "c": "int add_two(int a, int b) {\n    return a + b;\n}\n",
    "cpp": "int add_two(int a, int b) {\n    return a + b;\n}\n",
}

TOP_TWO = {
    "python": (
        "from typing import List\n\n"
        "def top_two(nums: List[float]) -> List[float]:\n"
        "    return sorted(nums, reverse=True)[:2]\n"
    ),
    "javascript": (
        "function topTwo(nums) {\n"
        "  return [...nums].sort((a, b) => b - a).slice(0, 2);\n"
        "}\n"
    ),
    "typescript": (
        "function topTwo(nums: number[]): number[] {\n"
        "  return [...nums].sort((a, b) => b - a).slice(0, 2);\n"
        "}\n"
    ),
    "java": (
        "import java.util.*;\n\n"
        "class Solution {\n"
        "    public double[] topTwo(double[] nums) {\n"
        "        double[] copy = nums.clone();\n"
        "        Arrays.sort(copy);\n"
        "        int take = Math.min(2, copy.length);\n"
        "        double[] out = new double[take];\n"
        "        for (int i = 0; i < take; i++) out[i] = copy[copy.length - 1 - i];\n"
        "        return out;\n"
        "    }\n"
        "}\n"
    ),
    "go": (
        "package main\n\n"
        "import \"sort\"\n\n"
        "func topTwo(nums []float64) []float64 {\n"
        "\tcopied := append([]float64{}, nums...)\n"
        "\tsort.Sort(sort.Reverse(sort.Float64Slice(copied)))\n"
        "\tif len(copied) > 2 {\n\t\tcopied = copied[:2]\n\t}\n"
        "\treturn copied\n"
        "}\n"
    ),
    "php": (
        "<?php\n\n"
        "function topTwo(array $nums): array\n{\n"
        "    rsort($nums);\n"
        "    return array_slice($nums, 0, 2);\n"
        "}\n"
    ),
    "c": (
        "#include <stdlib.h>\n\n"
        "static int descending(const void* left, const void* right) {\n"
        "    double a = *(const double*)left, b = *(const double*)right;\n"
        "    return (a < b) - (a > b);\n"
        "}\n\n"
        "double* top_two(double* nums, int numsSize, int* returnSize) {\n"
        "    qsort(nums, numsSize, sizeof(double), descending);\n"
        "    *returnSize = numsSize < 2 ? numsSize : 2;\n"
        "    double* out = (double*)malloc(sizeof(double) * (*returnSize > 0 ? *returnSize : 1));\n"
        "    for (int i = 0; i < *returnSize; i++) out[i] = nums[i];\n"
        "    return out;\n"
        "}\n"
    ),
    "cpp": (
        "#include <algorithm>\n#include <vector>\n\n"
        "std::vector<double> top_two(std::vector<double> nums) {\n"
        "    std::sort(nums.begin(), nums.end(), std::greater<double>());\n"
        "    if (nums.size() > 2) nums.resize(2);\n"
        "    return nums;\n"
        "}\n"
    ),
}

LANGUAGES = sorted(ADD_TWO)


async def _grade(language: str, source: str, spec: JudgeSpec, cases: list[JudgeCase]):
    return await grade(
        language=language,
        source_code=source,
        # Java và Go phải khởi động JVM / nạp binary vừa dựng; 1s là quá chặt cho một máy
        # dev đang chạy song song nhiều container.
        time_limit_ms=5000,
        memory_limit_kb=262_144,
        cases=cases,
        spec=spec,
    )


@pytest.mark.parametrize("language", LANGUAGES)
async def test_scalar_round_trip(language: str):
    result = await _grade(
        language,
        ADD_TWO[language],
        ADD_TWO_SPEC,
        [
            JudgeCase(order=1, args=[2, 3], expected=5),
            JudgeCase(order=2, args=[-4, 4], expected=0),
        ],
    )
    assert result.verdict == "accepted", (result.verdict, result.cases, result.compile_output)
    assert result.cases[0].actual == "5"


@pytest.mark.parametrize("language", LANGUAGES)
async def test_list_round_trip(language: str):
    result = await _grade(
        language,
        TOP_TWO[language],
        TOP_TWO_SPEC,
        [
            JudgeCase(order=1, args=[[1.5, 9.0, 3.25]], expected=[9.0, 3.25]),
            # Mảng rỗng, không phải null — chỗ dễ lẫn nhất khi đi qua JSON.
            JudgeCase(order=2, args=[[]], expected=[]),
        ],
    )
    assert result.verdict == "accepted", (result.verdict, result.cases, result.compile_output)


@pytest.mark.parametrize("language", LANGUAGES)
async def test_wrong_answer_is_not_an_infrastructure_error(language: str):
    result = await _grade(
        language,
        ADD_TWO[language].replace("a + b", "a - b").replace("$a + $b", "$a - $b"),
        ADD_TWO_SPEC,
        [JudgeCase(order=1, args=[2, 3], expected=5)],
    )
    assert result.verdict == "wrong_answer", (result.verdict, result.compile_output)
    assert result.cases[0].actual == "-1"


# Ngôn ngữ có bước biên dịch — chỉ ở đây `compile_error` mới tồn tại được.
COMPILED = ["c", "cpp", "go", "java", "typescript"]


@pytest.mark.parametrize("language", COMPILED)
async def test_broken_syntax_is_compile_error(language: str):
    result = await _grade(
        language,
        "!!! đây không phải là code !!!",
        ADD_TWO_SPEC,
        [JudgeCase(order=1, args=[2, 3], expected=5)],
    )
    assert result.verdict == "compile_error"
    assert result.cases == []


# PHP không biên dịch, nhưng `php -l` đứng đúng chỗ đó: lỗi cú pháp PHP là lỗi fatal mà
# try/catch quanh `require` không bắt được, nên nó phải bị chặn trước khi driver chạy.
async def test_php_syntax_error_is_compile_error():
    result = await _grade(
        "php",
        "<?php\n\nfunction addTwo(int $a int $b): int { return $a; }\n",
        ADD_TWO_SPEC,
        [JudgeCase(order=1, args=[2, 3], expected=5)],
    )
    assert result.verdict == "compile_error"


@pytest.mark.parametrize("language", LANGUAGES)
async def test_console_output_survives_and_does_not_corrupt_grading(language: str):
    printing = {
        "python": 'def add_two(a, b):\n    print("xin chao", a)\n    return a + b\n',
        "javascript": (
            'function addTwo(a, b) {\n  console.log("xin chao", a);\n'
            "  return a + b;\n}\n"
        ),
        "typescript": (
            "function addTwo(a: number, b: number): number {\n"
            '  console.log("xin chao", a);\n  return a + b;\n}\n'
        ),
        "java": (
            "class Solution {\n"
            "    public int addTwo(int a, int b) {\n"
            '        System.out.println("xin chao " + a);\n'
            "        return a + b;\n    }\n}\n"
        ),
        "go": (
            'package main\n\nimport "fmt"\n\n'
            "func addTwo(a int, b int) int {\n"
            '\tfmt.Println("xin chao", a)\n\treturn a + b\n}\n'
        ),
        "php": (
            "<?php\n\nfunction addTwo(int $a, int $b): int\n{\n"
            '    echo "xin chao $a\\n";\n    return $a + $b;\n}\n'
        ),
        "c": (
            "#include <stdio.h>\n\n"
            'int add_two(int a, int b) {\n    printf("xin chao %d\\n", a);\n    return a + b;\n}\n'
        ),
        "cpp": (
            "#include <iostream>\n\n"
            'int add_two(int a, int b) {\n    std::cout << "xin chao " << a << "\\n";\n'
            "    return a + b;\n}\n"
        ),
    }
    result = await _grade(
        language,
        printing[language],
        ADD_TWO_SPEC,
        [JudgeCase(order=1, args=[2, 3], expected=5)],
    )
    assert result.verdict == "accepted", (result.verdict, result.cases, result.compile_output)
    assert "xin chao" in result.console_output


@pytest.mark.parametrize("language", LANGUAGES)
async def test_student_cannot_read_the_test_file(language: str):
    """`tests.json` phải biến mất trước khi bài của học viên chạy.

    Nó chỉ chứa `args` (đáp án không bao giờ vào sandbox), nên đây là lớp phòng thủ phụ — vẫn
    kiểm, vì nó rẻ và vì quên `unlink` là lỗi không ai để ý cho tới khi có người khai thác.
    """
    peeking = {
        "python": (
            "import os\n\ndef add_two(a, b):\n"
            "    return 1 if os.path.exists('tests.json') else 0\n"
        ),
        "javascript": (
            "function addTwo(a, b) {\n"
            "  return require('fs').existsSync('tests.json') ? 1 : 0;\n}\n"
        ),
        "typescript": (
            "function addTwo(a: number, b: number): number {\n"
            "  return require('fs').existsSync('tests.json') ? 1 : 0;\n}\n"
        ),
        "java": (
            "import java.nio.file.*;\n\nclass Solution {\n"
            "    public int addTwo(int a, int b) {\n"
            '        return Files.exists(Paths.get("tests.json")) ? 1 : 0;\n    }\n}\n'
        ),
        "go": (
            'package main\n\nimport "os"\n\nfunc addTwo(a int, b int) int {\n'
            "\tif _, err := os.Stat(\"tests.json\"); err == nil {\n\t\treturn 1\n\t}\n"
            "\treturn 0\n}\n"
        ),
        "php": (
            "<?php\n\nfunction addTwo(int $a, int $b): int\n{\n"
            '    return file_exists("tests.json") ? 1 : 0;\n}\n'
        ),
        "c": (
            "#include <stdio.h>\n\nint add_two(int a, int b) {\n"
            '    FILE* f = fopen("tests.json", "r");\n'
            "    if (f) { fclose(f); return 1; }\n    return 0;\n}\n"
        ),
        "cpp": (
            "#include <fstream>\n\nint add_two(int a, int b) {\n"
            '    std::ifstream f("tests.json");\n    return f.good() ? 1 : 0;\n}\n'
        ),
    }
    result = await _grade(
        language,
        peeking[language],
        ADD_TWO_SPEC,
        [JudgeCase(order=1, args=[2, 3], expected=0)],
    )
    assert result.verdict == "accepted", (result.cases, result.compile_output)


@pytest.mark.parametrize("language", LANGUAGES)
async def test_generated_starter_compiles(language: str):
    """Mã khởi tạo sinh ra phải dịch được và chạy được — chỉ là chưa có lời giải.

    Đây là kiểm tra quan trọng nhất của bộ sinh code: starter và driver do CÙNG module sinh
    ra, nên nếu chúng lệch nhau thì lệch ở đây, chứ không phải ở bài của học viên. Verdict cụ
    thể là gì không quan trọng (Python trả None, Java ném ngoại lệ, C trả 0) — quan trọng là
    nó KHÔNG phải `compile_error`.
    """
    from app.services.langs import DriverSpec, Param, starter_for

    spec = DriverSpec(
        function_name="top_two",
        parameters=(Param(name="nums", type=FLOAT_LIST),),
        return_type=FLOAT_LIST,
    )
    result = await _grade(
        language,
        starter_for(language, spec),
        TOP_TWO_SPEC,
        [JudgeCase(order=1, args=[[1.5, 9.0]], expected=[9.0, 1.5])],
    )
    assert result.verdict != "compile_error", result.compile_output
