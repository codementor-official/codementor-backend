"""Kiểm `ExerciseContent` trước khi Lecter đề xuất lưu.

Vì sao tồn tại: người soạn bấm "Lưu nội dung" rồi mới nhận `constraints must be an array` là ngõ
cụt — họ không sửa được payload của model, chỉ còn nút "Bỏ qua". Kiểm ở đây thì model nhận lỗi
dưới dạng một tool result, tự sửa, rồi mới đề xuất.

Ba tầng luật, sao chép có chủ đích chứ không gọi qua mạng:

1. `SaveContentDto` (class-validator) — `apps/exercise-service/.../dto/exercise.dto.ts:308`.
   Sai tầng này là 400 lúc PUT.
2. Validator Mongo của `exercise_contents` — `additionalProperties: false` ở MỌI tầng lồng
   (`codementor-infra/database/mongo/schemas/01-exercise-contents.js`). Thừa một trường là Mongo
   từ chối và Nest trả 500, chỗ không ai nghĩ tới.
3. `validateForSubmission` — `.../domain/model/exercise-content.ts:141`. Không chặn lưu, nhưng
   chặn gửi duyệt, nên trả về dạng cảnh báo.

Chép luật thì có nguy cơ lệch khi backend đổi. Đổi lại là model sửa được lỗi ngay trong lượt, thay
vì tiêu một vòng PUT thất bại — và tầng 1-2 chỉ mô tả hình dạng, thứ hiếm khi đổi. Bản sao này có
test đi kèm; backend đổi mà quên đây thì `tests/test_lecter_validate.py` không phát hiện được, nên
luôn để backend là nơi từ chối cuối cùng.
"""

import re
from typing import Any

MAX_STATEMENT = 200_000
MAX_CHECKER_CODE = 100_000
MAX_THEORY_SUMMARY = 2_000
MIN_TEST_CASES = 3
IO_MODES = ("stdin_stdout", "function")
CHECKERS = ("exact", "trimmed", "float", "custom", "unordered")
FUNCTION_NAME = re.compile(r"^[a-z][a-z0-9_]*$")

# Từ khoá của Python + JavaScript + Java gộp lại — tên hàm sinh code ở cả ba nên trùng bất kỳ
# ngôn ngữ nào là hỏng. Giữ đồng bộ với RESERVED_WORDS ở exercise-content.ts.
RESERVED = {
    "abstract", "and", "as", "assert", "async", "await", "boolean", "break", "byte", "case",
    "catch", "char", "class", "const", "continue", "def", "default", "del", "delete", "do",
    "double", "elif", "else", "enum", "except", "export", "extends", "false", "final", "finally",
    "float", "for", "from", "function", "global", "goto", "if", "implements", "import", "in",
    "instanceof", "int", "interface", "is", "lambda", "let", "long", "native", "new", "none",
    "nonlocal", "not", "null", "or", "package", "pass", "private", "protected", "public",
    "raise", "return", "short", "static", "super", "switch", "synchronized", "this", "throw",
    "throws", "transient", "true", "try", "typeof", "var", "void", "volatile", "while", "with",
    "yield",
}

# Id ngôn ngữ mà bộ chấm nhận ở chế độ hàm. Sao chép từ `RUNNERS` trong
# `apps/judge-service/app/services/langs/__init__.py` — judge không có endpoint nào liệt kê chúng.
# Chữ HOA hay nhãn hiển thị ("Python", "Python 3.11") đều bị từ chối, và trước khi có kiểm tra này
# thì lỗi hiện ra dưới dạng một mã 500 không kèm lý do.
JUDGE_LANGUAGES = ("python", "javascript", "typescript", "java", "go", "php", "c", "cpp")

# Cách viết sai thường gặp → id đúng. Chuẩn hoá thay vì bắt model đoán lại.
LANGUAGE_ALIASES = {
    "python3": "python", "py": "python", "c++": "cpp", "cplusplus": "cpp",
    "golang": "go", "js": "javascript", "node": "javascript", "nodejs": "javascript",
    "ts": "typescript",
}


def normalize_language(value: str) -> str:
    """Đưa về id judge hiểu. Không nhận ra thì trả lại nguyên văn để lỗi nói đúng cái đã gửi."""
    key = str(value).strip().lower()
    return LANGUAGE_ALIASES.get(key, key)


CONTENT_KEYS = {
    "statement", "ioMode", "signature", "constraints", "hints", "examples",
    "testCases", "languages", "evaluation", "theory",
}
TEST_CASE_KEYS = {"order", "input", "args", "expected", "visibility", "generated", "weight"}
LANGUAGE_KEYS = {"id", "label", "monaco", "starterCode", "referenceSolution"}
HINT_KEYS = {"order", "text", "xpPenalty"}
EXAMPLE_KEYS = {"input", "output", "explanation"}
EVALUATION_KEYS = {"checker", "floatTolerance", "customCheckerCode", "stopOnFirstFailure"}
SIGNATURE_KEYS = {"functionName", "parameters", "returnType"}
PARAMETER_KEYS = {"name", "type", "description"}
THEORY_KEYS = {"summary", "objectives", "contentHtml"}


def _is_int(value: Any) -> bool:
    # `True` là `int` trong Python nhưng là boolean với Mongo; đừng để nó lọt qua chỗ cần số.
    return isinstance(value, int) and not isinstance(value, bool)


def _extra(where: str, obj: dict, allowed: set[str], errors: list[str]) -> None:
    for key in sorted(set(obj) - allowed):
        errors.append(f"{where}: trường '{key}' không tồn tại trong ExerciseContent, phải bỏ đi")


def _string(where: str, value: Any, errors: list[str], *, limit: int | None = None) -> None:
    if not isinstance(value, str):
        errors.append(f"{where} phải là chuỗi, đang là {type(value).__name__}")
    elif limit and len(value) > limit:
        errors.append(f"{where} dài {len(value)} ký tự, tối đa {limit}")


def _check_signature(signature: Any, errors: list[str]) -> None:
    if not isinstance(signature, dict):
        errors.append("signature phải là object")
        return
    _extra("signature", signature, SIGNATURE_KEYS, errors)
    for key in ("functionName", "parameters", "returnType"):
        if key not in signature:
            errors.append(f"signature thiếu '{key}' (cả ba đều bắt buộc)")
    if "functionName" in signature:
        _string("signature.functionName", signature["functionName"], errors)
    if "returnType" in signature and not isinstance(signature["returnType"], dict):
        errors.append("signature.returnType phải là object Type IR, ví dụ {\"kind\": \"int\"}")
    parameters = signature.get("parameters")
    if parameters is not None and not isinstance(parameters, list):
        errors.append("signature.parameters phải là mảng")
        return
    for index, parameter in enumerate(parameters or []):
        where = f"signature.parameters[{index}]"
        if not isinstance(parameter, dict):
            errors.append(f"{where} phải là object")
            continue
        _extra(where, parameter, PARAMETER_KEYS, errors)
        if "name" not in parameter:
            errors.append(f"{where} thiếu 'name'")
        else:
            _string(f"{where}.name", parameter["name"], errors)
        if not isinstance(parameter.get("type"), dict):
            errors.append(f"{where}.type phải là object Type IR, ví dụ {{\"kind\": \"int\"}}")


def _check_test_cases(cases: Any, errors: list[str]) -> None:
    if not isinstance(cases, list):
        errors.append("testCases phải là mảng")
        return
    for index, case in enumerate(cases):
        where = f"testCases[{index}]"
        if not isinstance(case, dict):
            errors.append(f"{where} phải là object")
            continue
        _extra(where, case, TEST_CASE_KEYS, errors)
        if not _is_int(case.get("order")) or case.get("order", 0) < 1:
            errors.append(f"{where}.order phải là số nguyên >= 1 (đánh số từ 1, không phải 0)")
        if case.get("visibility") not in ("public", "hidden"):
            errors.append(f"{where}.visibility phải là 'public' hoặc 'hidden' và không được thiếu")
        if "input" in case:
            _string(f"{where}.input", case["input"], errors)
        if "args" in case and not isinstance(case["args"], list):
            errors.append(f"{where}.args phải là mảng tham số theo đúng thứ tự signature")
        if "weight" in case and (not _is_int(case["weight"]) or case["weight"] < 0):
            errors.append(f"{where}.weight phải là số nguyên >= 0")
        if "generated" in case and not isinstance(case["generated"], bool):
            errors.append(f"{where}.generated phải là true/false")


def _check_languages(languages: Any, errors: list[str]) -> None:
    if not isinstance(languages, list):
        errors.append("languages phải là mảng")
        return
    for index, language in enumerate(languages):
        where = f"languages[{index}]"
        if not isinstance(language, dict):
            errors.append(f"{where} phải là object")
            continue
        _extra(where, language, LANGUAGE_KEYS, errors)
        for key in ("id", "label"):
            if key not in language:
                errors.append(f"{where} thiếu '{key}' (bắt buộc)")
            else:
                _string(f"{where}.{key}", language[key], errors)
        for key in ("monaco", "starterCode", "referenceSolution"):
            if key in language:
                _string(f"{where}.{key}", language[key], errors)


def _check_list_of_objects(
    name: str, value: Any, allowed: set[str], required: dict[str, str], errors: list[str]
) -> None:
    if not isinstance(value, list):
        errors.append(f"{name} phải là mảng")
        return
    for index, item in enumerate(value):
        where = f"{name}[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{where} phải là object")
            continue
        _extra(where, item, allowed, errors)
        for key, kind in required.items():
            if key not in item:
                errors.append(f"{where} thiếu '{key}'")
            elif kind == "int" and (not _is_int(item[key]) or item[key] < 1):
                errors.append(f"{where}.{key} phải là số nguyên >= 1")
            elif kind == "str":
                _string(f"{where}.{key}", item[key], errors)


def check_shape(content: Any) -> list[str]:
    """Lỗi làm lệnh PUT thất bại. Rỗng = lưu được."""
    if not isinstance(content, dict):
        return ["content phải là một object ExerciseContent"]

    errors: list[str] = []
    _extra("content", content, CONTENT_KEYS, errors)

    if "statement" in content:
        _string("statement", content["statement"], errors, limit=MAX_STATEMENT)
    if "ioMode" in content and content["ioMode"] not in IO_MODES:
        errors.append(f"ioMode phải là một trong {IO_MODES}")
    if "signature" in content:
        _check_signature(content["signature"], errors)

    if "constraints" in content:
        value = content["constraints"]
        if not isinstance(value, list):
            errors.append(
                "constraints phải là MẢNG chuỗi, mỗi ràng buộc một phần tử — "
                'ví dụ ["1 <= n <= 10^5", "-10^9 <= a[i] <= 10^9"], không phải một chuỗi dài'
            )
        else:
            for index, item in enumerate(value):
                _string(f"constraints[{index}]", item, errors)

    if "hints" in content:
        _check_list_of_objects(
            "hints", content["hints"], HINT_KEYS, {"order": "int", "text": "str"}, errors
        )
    if "examples" in content:
        _check_list_of_objects(
            "examples", content["examples"], EXAMPLE_KEYS,
            {"input": "str", "output": "str"}, errors,
        )
    if "testCases" in content:
        _check_test_cases(content["testCases"], errors)
    if "languages" in content:
        _check_languages(content["languages"], errors)

    if "evaluation" in content:
        evaluation = content["evaluation"]
        if not isinstance(evaluation, dict):
            errors.append("evaluation phải là object")
        else:
            _extra("evaluation", evaluation, EVALUATION_KEYS, errors)
            if "checker" in evaluation and evaluation["checker"] not in CHECKERS:
                errors.append(f"evaluation.checker phải là một trong {CHECKERS}")
            if "customCheckerCode" in evaluation:
                _string(
                    "evaluation.customCheckerCode", evaluation["customCheckerCode"],
                    errors, limit=MAX_CHECKER_CODE,
                )
            if "stopOnFirstFailure" in evaluation and not isinstance(
                evaluation["stopOnFirstFailure"], bool
            ):
                errors.append("evaluation.stopOnFirstFailure phải là true/false")
            if "floatTolerance" in evaluation and not isinstance(
                evaluation["floatTolerance"], (int, float)
            ):
                errors.append("evaluation.floatTolerance phải là số")

    if "theory" in content:
        theory = content["theory"]
        if not isinstance(theory, dict):
            errors.append("theory phải là object")
        else:
            _extra("theory", theory, THEORY_KEYS, errors)
            if "summary" in theory:
                _string("theory.summary", theory["summary"], errors, limit=MAX_THEORY_SUMMARY)
            if "objectives" in theory and not isinstance(theory["objectives"], list):
                errors.append("theory.objectives phải là mảng chuỗi")

    return errors


def check_submission(content: dict) -> list[str]:
    """Thiếu sót chặn GỬI DUYỆT nhưng không chặn lưu. Trả về dạng cảnh báo."""
    missing: list[str] = []
    if not (content.get("statement") or "").strip():
        missing.append("đề bài")

    languages = content.get("languages") or []
    if not languages:
        missing.append("ít nhất một ngôn ngữ")
    else:
        # Id sai thì bài lưu được nhưng KHÔNG chấm được — học viên nộp bài mới phát hiện.
        wrong = [
            lang.get("id")
            for lang in languages
            if isinstance(lang, dict) and lang.get("id") not in JUDGE_LANGUAGES
        ]
        if wrong:
            missing.append(
                f"id ngôn ngữ không hợp lệ: {', '.join(map(str, wrong))} "
                f"(phải là một trong {', '.join(JUDGE_LANGUAGES)}, viết thường)"
            )
        without = [
            lang.get("label") or lang.get("id")
            for lang in languages
            if isinstance(lang, dict) and not (lang.get("referenceSolution") or "").strip()
        ]
        if without:
            missing.append(f"lời giải mẫu cho {', '.join(map(str, without))}")

    cases = content.get("testCases") or []
    if len(cases) < MIN_TEST_CASES:
        missing.append(f"tối thiểu {MIN_TEST_CASES} test case (đang có {len(cases)})")
    if not any(isinstance(c, dict) and c.get("visibility") == "public" for c in cases):
        missing.append("ít nhất một test case công khai")

    if content.get("ioMode") != "function":
        # Chế độ stdin so sánh VĂN BẢN. Một `expected` dạng số lưu được nhưng lúc chấm sẽ làm bộ
        # chấm nổ (`judgement.py` gọi `expected.strip()`), và học viên là người thấy lỗi đó.
        wrong_type = [
            case.get("order")
            for case in cases
            if isinstance(case, dict)
            and (
                not isinstance(case.get("input", ""), str)
                or not isinstance(case.get("expected", ""), str)
            )
        ]
        if wrong_type:
            missing.append(
                f"test case {', '.join(map(str, wrong_type))} ở chế độ stdin phải có `input` và "
                "`expected` dạng chuỗi"
            )

    if content.get("ioMode") == "function":
        signature = content.get("signature") or {}
        name = str(signature.get("functionName") or "").strip()
        parameters = signature.get("parameters") or []
        if not name:
            missing.append("chữ ký hàm")
        elif not FUNCTION_NAME.match(name):
            missing.append(f'tên hàm "{name}" phải là snake_case')
        elif name in RESERVED:
            missing.append(f'tên hàm "{name}" trùng từ khoá của Python/JavaScript/Java')
        if not parameters:
            missing.append("ít nhất một tham số")
        names = [p.get("name") for p in parameters if isinstance(p, dict)]
        if len(set(names)) != len(names):
            missing.append("tên tham số bị trùng nhau")
        if not (signature.get("returnType") or {}).get("kind"):
            missing.append("kiểu trả về")

        arity = len(parameters)
        mismatched = [
            c.get("order")
            for c in cases
            if isinstance(c, dict) and len(c.get("args") or []) != arity
        ]
        if mismatched:
            missing.append(
                f"test case {', '.join(map(str, mismatched))} có số tham số không khớp chữ ký "
                f"(cần {arity})"
            )
        without_expected = [
            c.get("order") for c in cases if isinstance(c, dict) and "expected" not in c
        ]
        if without_expected:
            missing.append(f"đáp án cho test case {', '.join(map(str, without_expected))}")

    return missing
