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


def check_reference_solutions(content: dict) -> list[str]:
    """Thiếu sót về `languages` — luật của riêng Lecter, KHÔNG phải của backend.

    Backend cho lưu content không có `languages`: soạn dở trong studio rồi bổ sung sau là chuyện
    thường. Lecter thì khác — nó chỉ đề xuất lưu SAU khi đã chạy lời giải mẫu qua bộ chấm, nên
    lúc đó đoạn code cần lưu đang nằm sẵn trong tay nó. Bỏ qua là ra đúng cái vỏ rỗng: bài nháp
    có tiêu đề, không đề, không testcase, không ngôn ngữ nào để học viên mở editor.

    Tách khỏi `check_submission` để `validate_exercise_content` chặn thẳng. Xếp chung với cảnh
    báo gửi duyệt thì câu trả lời thành "HỢP LỆ để lưu, nhưng còn thiếu…" — model đọc nửa sau,
    quay lại sửa, gửi lại y hệt ba lần rồi bỏ cuộc và bảo người soạn tự lưu trong studio.
    """
    languages = content.get("languages") or []
    if not languages:
        return [
            "thiếu `content.languages`. Mỗi ngôn ngữ một object "
            '{"id": "python", "label": "Python", "referenceSolution": "<đúng sourceCode vừa '
            'chạy qua bộ chấm>"} — `id` viết thường, một trong '
            f"{', '.join(JUDGE_LANGUAGES)}"
        ]

    missing: list[str] = []
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
        missing.append(f"thiếu `referenceSolution` cho {', '.join(map(str, without))}")
    return missing


def check_submission(content: dict) -> list[str]:
    """Thiếu sót chặn GỬI DUYỆT nhưng không chặn lưu. Trả về dạng cảnh báo."""
    missing: list[str] = []
    if not (content.get("statement") or "").strip():
        missing.append("đề bài")

    missing.extend(check_reference_solutions(content))

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


# ---------------------------------------------------------------------------
# Khóa học. Cùng doctrine với phần bài code ở trên: chép luật backend để model
# sửa được ngay trong lượt, và backend vẫn là nơi từ chối cuối cùng.
# ---------------------------------------------------------------------------

# `SaveCurriculumDto` — ArrayMaxSize ở `course.dto.ts:105-190`.
MAX_CHAPTERS = 100
MAX_LESSONS_PER_CHAPTER = 300
MAX_TITLE = 200
MAX_CHAPTER_DESCRIPTION = 2_000

# `lesson_type` trong Postgres. Bài lý thuyết tên là `article`, KHÔNG phải "theory" —
# `ExerciseContent` có một trường tên `theory` nhưng đó là thứ khác hẳn.
LESSON_TYPES = ("video", "article", "exercise", "quiz", "challenge", "project")
# CHECK `lessons_exercise_only_for_exercise_types` ở tầng cơ sở dữ liệu; gắn `exerciseId` vào
# `article` là 400 chứ không phải bị bỏ qua.
EXERCISE_BEARING = ("exercise", "quiz", "challenge", "project")

CHAPTER_KEYS = {"id", "title", "description", "isOptional", "lessons"}
LESSON_KEYS = {
    "id", "title", "type", "durationMinutes", "isPreview", "isOptional", "exerciseId",
}

# `@IsUUID()` trên `id` và `exerciseId`. Model bịa "chapter-1" làm id thì Nest trả 400 kèm
# một câu khó đoán, còn ở đây nó đọc được ngay.
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _uuid(where: str, value: Any, errors: list[str]) -> None:
    """Câu lỗi phải nói CÁCH SỬA, không chỉ nói luật.

    Bản trước viết "phải là UUID có thật lấy từ `read_course`". Với một chương/bài MỚI thì lời
    khuyên đó bất khả thi — id chưa tồn tại ở đâu để mà lấy — nên model đọc xong bảo giảng viên là
    nó bị chặn và không làm gì thêm được. Nêu cả hai đường ra thì nó tự sửa trong cùng một lượt.
    """
    if not isinstance(value, str) or not UUID.match(value):
        errors.append(
            f"{where} = {value!r} không phải id hợp lệ. Chương/bài MỚI thì gửi `id: null` "
            "(đừng tự đặt, đừng gửi chuỗi rỗng); mục đã có thì gửi đúng id đọc từ `read_course`."
        )


def _title(where: str, value: Any, errors: list[str]) -> None:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{where} thiếu 'title' hoặc để rỗng (bắt buộc)")
    elif len(value) > MAX_TITLE:
        errors.append(f"{where}.title dài {len(value)} ký tự, tối đa {MAX_TITLE}")


def _check_lesson(where: str, lesson: Any, errors: list[str]) -> str | None:
    """Kiểm một bài, trả về `exerciseId` của nó để tầng trên soi trùng trong cùng chương."""
    if not isinstance(lesson, dict):
        errors.append(f"{where} phải là object")
        return None

    _extra(where, lesson, LESSON_KEYS, errors)
    _title(where, lesson.get("title"), errors)
    # Rỗng cũng như thiếu: cả hai đều nghĩa là "bài mới, backend tự sinh id".
    if lesson.get("id"):
        _uuid(f"{where}.id", lesson["id"], errors)

    kind = lesson.get("type")
    if kind not in LESSON_TYPES:
        errors.append(
            f"{where}.type phải là một trong {', '.join(LESSON_TYPES)} và không được thiếu "
            "(bài lý thuyết là 'article')"
        )

    duration = lesson.get("durationMinutes")
    if duration is not None and (not _is_int(duration) or duration < 1):
        errors.append(f"{where}.durationMinutes phải là số nguyên >= 1, hoặc null")

    for key in ("isPreview", "isOptional"):
        if key in lesson and not isinstance(lesson[key], bool):
            errors.append(f"{where}.{key} phải là true/false")

    exercise_id = lesson.get("exerciseId") or None
    if exercise_id is None:
        return None
    if kind in LESSON_TYPES and kind not in EXERCISE_BEARING:
        errors.append(
            f"{where} có `exerciseId` nhưng type là '{kind}'. Chỉ "
            f"{', '.join(EXERCISE_BEARING)} mới gắn được bài code; bỏ `exerciseId` hoặc đổi type."
        )
        return None
    _uuid(f"{where}.exerciseId", exercise_id, errors)
    return exercise_id if isinstance(exercise_id, str) else None


def check_curriculum_shape(chapters: Any) -> list[str]:
    """Lỗi làm `PUT /courses/:id/curriculum` thất bại. Rỗng = lưu được."""
    if not isinstance(chapters, list):
        return ["chapters phải là MẢNG chương, thứ tự trong mảng chính là thứ tự hiển thị"]
    if len(chapters) > MAX_CHAPTERS:
        return [f"tối đa {MAX_CHAPTERS} chương, đang có {len(chapters)}"]

    errors: list[str] = []
    chapter_ids: list[str] = []
    lesson_ids: list[str] = []

    for index, chapter in enumerate(chapters):
        where = f"chapters[{index}]"
        if not isinstance(chapter, dict):
            errors.append(f"{where} phải là object")
            continue

        _extra(where, chapter, CHAPTER_KEYS, errors)
        _title(where, chapter.get("title"), errors)
        if chapter.get("id"):
            _uuid(f"{where}.id", chapter["id"], errors)
            chapter_ids.append(chapter["id"])
        if chapter.get("description") is not None:
            _string(
                f"{where}.description", chapter["description"], errors,
                limit=MAX_CHAPTER_DESCRIPTION,
            )
        if "isOptional" in chapter and not isinstance(chapter["isOptional"], bool):
            errors.append(f"{where}.isOptional phải là true/false")

        lessons = chapter.get("lessons")
        if not isinstance(lessons, list):
            errors.append(f"{where}.lessons phải là mảng bài học (gửi [] nếu chương chưa có bài)")
            continue
        if len(lessons) > MAX_LESSONS_PER_CHAPTER:
            errors.append(
                f"{where} có {len(lessons)} bài, tối đa {MAX_LESSONS_PER_CHAPTER} mỗi chương"
            )

        attached: list[str] = []
        for position, lesson in enumerate(lessons):
            exercise_id = _check_lesson(f"{where}.lessons[{position}]", lesson, errors)
            # Chỉ gom id THẬT. Gom cả chuỗi rỗng thì hai bài mới trong cùng payload bị báo
            # "id bài học  xuất hiện nhiều lần" — một câu lỗi vô nghĩa in ra id rỗng.
            if isinstance(lesson, dict) and lesson.get("id"):
                lesson_ids.append(lesson["id"])
            if exercise_id:
                attached.append(exercise_id)

        # Unique index `lessons_exercise_unique_per_chapter`: cùng một bài code hai lần trong
        # một chương là 422, không phải cảnh báo.
        for duplicate in sorted({x for x in attached if attached.count(x) > 1}):
            errors.append(
                f"{where}: bài code {duplicate} bị gắn vào hai bài học trong cùng một chương"
            )

    for name, ids in (("chương", chapter_ids), ("bài học", lesson_ids)):
        for duplicate in sorted({x for x in ids if ids.count(x) > 1}):
            errors.append(f"id {name} {duplicate} xuất hiện nhiều lần — mỗi id chỉ được một chỗ")

    return errors


def _tree_ids(chapters: Any) -> tuple[dict[str, str], dict[str, str]]:
    """id -> tiêu đề, cho chương và cho bài. Dùng chung cho cả cây hiện tại lẫn payload."""
    chapter_titles: dict[str, str] = {}
    lesson_titles: dict[str, str] = {}
    for chapter in chapters or []:
        if not isinstance(chapter, dict):
            continue
        if chapter.get("id"):
            chapter_titles[chapter["id"]] = str(chapter.get("title") or "chưa đặt tên")
        for lesson in chapter.get("lessons") or []:
            if isinstance(lesson, dict) and lesson.get("id"):
                lesson_titles[lesson["id"]] = str(lesson.get("title") or "chưa đặt tên")
    return chapter_titles, lesson_titles


def find_removals(
    current: Any, chapters: Any, remove_ids: list[str] | None = None
) -> list[dict]:
    """Mục sẽ biến mất nếu lưu payload này, kèm cờ model có khai ý định xóa hay không.

    Một nguồn sự thật cho hai người đọc: câu lỗi gửi cho model (`check_removals`) và banner đỏ
    trên hộp xác nhận. Trước đây hộp xác nhận tự tra tên từ `removeIds` do MODEL khai — nên một
    lượt quên echo id thì nó không hiện gì cả, và người duy nhất có thẩm quyền lại là người không
    có thông tin.

    Khai một CHƯƠNG là khai luôn mọi bài trong nó. Bắt liệt kê thêm từng id bài là việc thừa mà
    câu lỗi không hề nói tới: model đã gửi đúng `remove_ids` của chương, vẫn bị chặn vì hai bài
    con, rồi bỏ cuộc và nói với giảng viên rằng chương đó "không còn nữa" — một câu sai mà nó suy
    ra từ chính lời từ chối của tool.
    """
    payload_chapters, payload_lessons = _tree_ids(chapters)
    declared = set(remove_ids or [])

    gone: list[dict] = []
    for chapter in ((current or {}).get("chapters") or []):
        if not isinstance(chapter, dict):
            continue
        chapter_id = chapter.get("id")
        chapter_gone = bool(chapter_id) and chapter_id not in payload_chapters
        if chapter_gone:
            gone.append({
                "kind": "chapter",
                "id": chapter_id,
                "title": str(chapter.get("title") or "chưa đặt tên"),
                "declared": chapter_id in declared,
            })
        for lesson in chapter.get("lessons") or []:
            lesson_id = lesson.get("id") if isinstance(lesson, dict) else None
            if not lesson_id or lesson_id in payload_lessons:
                continue
            gone.append({
                "kind": "lesson",
                "id": lesson_id,
                "title": str(lesson.get("title") or "chưa đặt tên"),
                "declared": lesson_id in declared
                or (chapter_gone and chapter_id in declared),
            })
    return gone


def check_removals(
    current: Any, chapters: Any, remove_ids: list[str] | None = None
) -> list[str]:
    """Chặn việc xóa ngoài ý muốn — lý do tồn tại của cả tool `validate_curriculum`.

    `PUT /courses/:id/curriculum` thay TOÀN BỘ cây: chương hay bài nào không có `id` trong payload
    thì backend `DELETE` nó, và `lesson_progress` của mọi học viên đang học cascade theo. Không có
    API cấp chương/bài để làm nhẹ hơn.

    Nghĩa là một lượt model quên echo lại id — chuyện thường gặp khi nó chỉ định "thêm một chương"
    — sẽ xóa sạch phần còn lại của khóa học. Đây không phải cảnh báo: đây là lỗi chặn, và muốn xóa
    thật thì phải liệt kê vào `remove_ids`.
    """
    labels = {"chapter": "Chương", "lesson": "Bài"}
    errors = [
        f"{labels[item['kind']]} '{item['title']}' ({item['id']})"
        for item in find_removals(current, chapters, remove_ids)
        if not item["declared"]
    ]
    if not errors:
        return []
    return [
        "SẼ XÓA MẤT DỮ LIỆU — payload thay TOÀN BỘ cây, nên thiếu id là xóa: "
        + "; ".join(errors)
        + ". Gọi `read_course` rồi gửi lại ĐỦ mọi chương và mọi bài kèm `id` của chúng. "
        "Thật sự muốn xóa thì liệt kê đúng những id đó vào `remove_ids` — học viên đang học sẽ "
        "mất tiến độ ở phần bị xóa."
    ]


def check_course_submission(course: Any, chapters: Any) -> list[str]:
    """Thiếu sót chặn GỬI DUYỆT nhưng không chặn lưu. Trả về dạng cảnh báo.

    Gương của `validateForSubmission` ở `domain/model/course.ts:265-327`. Có nó thì câu hỏi "sao
    chưa gửi duyệt được" trả lời được bằng một lời gọi tool thay vì bắt giảng viên bấm nút rồi đọc
    422.
    """
    course = course if isinstance(course, dict) else {}
    missing: list[str] = []

    if not str(course.get("description") or "").strip():
        missing.append("mô tả khóa học (`description`)")

    if not isinstance(chapters, list) or not chapters:
        missing.append("ít nhất một chương")
        return missing

    # `contentRef` và `exerciseStatus` chỉ có ở cây ĐANG lưu, không có trong payload: bài mới
    # soạn chưa có nội dung là chuyện đương nhiên, và đó chính là thứ cần nhắc.
    stored: dict[str, dict] = {}
    for chapter in (course.get("chapters") or []):
        for lesson in (chapter.get("lessons") or []) if isinstance(chapter, dict) else []:
            if isinstance(lesson, dict) and isinstance(lesson.get("id"), str):
                stored[lesson["id"]] = lesson

    empty: list[str] = []
    without_content: list[str] = []
    without_exercise: list[str] = []
    unusable_exercise: list[str] = []

    for chapter in chapters:
        if not isinstance(chapter, dict):
            continue
        lessons = chapter.get("lessons") or []
        if not lessons:
            empty.append(str(chapter.get("title") or "chưa đặt tên"))
        for lesson in lessons:
            if not isinstance(lesson, dict):
                continue
            title = str(lesson.get("title") or "chưa đặt tên")
            saved = stored.get(lesson.get("id") or "", {})
            if lesson.get("type") in EXERCISE_BEARING:
                if not lesson.get("exerciseId"):
                    without_exercise.append(title)
                elif saved.get("exerciseStatus") not in (None, "published"):
                    unusable_exercise.append(f"{title} ({saved['exerciseStatus']})")
            elif not saved.get("contentRef"):
                without_content.append(title)

    if empty:
        missing.append(f"chương không có bài nào: {', '.join(empty)}")
    if without_content:
        missing.append(f"nội dung cho bài: {', '.join(without_content)}")
    if without_exercise:
        missing.append(f"bài code cho bài: {', '.join(without_exercise)}")
    if unusable_exercise:
        missing.append(
            "bài code chưa công khai (phải công khai hoặc do chính bạn soạn): "
            + ", ".join(unusable_exercise)
        )
    return missing


def _canonical(chapters: Any) -> list[dict]:
    """Dạng so sánh được của một cây, dùng chung cho cả payload lẫn cây đang lưu.

    Phải chuẩn hoá vì hai bên không bao giờ giống nhau từng byte: payload bỏ trống trường tuỳ
    chọn, còn API trả về đủ trường kèm `null`; `isOptional` khi thiếu nghĩa là `false`.
    """
    return [
        {
            "id": chapter.get("id") or None,
            "title": str(chapter.get("title") or "").strip(),
            "description": (str(chapter.get("description")).strip() or None)
            if chapter.get("description")
            else None,
            "isOptional": bool(chapter.get("isOptional")),
            "lessons": [
                {
                    "id": lesson.get("id") or None,
                    "title": str(lesson.get("title") or "").strip(),
                    "type": lesson.get("type"),
                    "durationMinutes": lesson.get("durationMinutes"),
                    "isPreview": bool(lesson.get("isPreview")),
                    "isOptional": bool(lesson.get("isOptional")),
                    "exerciseId": lesson.get("exerciseId") or None,
                }
                for lesson in (chapter.get("lessons") or [])
                if isinstance(lesson, dict)
            ],
        }
        for chapter in (chapters or [])
        if isinstance(chapter, dict)
    ]


def is_unchanged(current: Any, chapters: Any) -> bool:
    """Payload giống hệt cây đang lưu.

    Lưu một cây không đổi không phải vô hại: nó bắt giảng viên bấm một hộp xác nhận cho một thay
    đổi rỗng, tiêu một lượt HITL, và làm cả hai bên tưởng vừa có việc gì đó xảy ra. Chuyện đã xảy
    ra ngay lượt đầu của một hội thoại thật — model đọc cây rồi lưu lại y nguyên.
    """
    return _canonical((current or {}).get("chapters")) == _canonical(chapters)


# ---------------------------------------------------------------------------
# Lộ trình. Cùng doctrine với hai phần trên: chép luật backend để model sửa được
# ngay trong lượt, và backend vẫn là nơi từ chối cuối cùng.
# ---------------------------------------------------------------------------

# `ReplaceRoadmapCoursesDto` — ArrayMaxSize ở `roadmap.dto.ts:146`.
MAX_ROADMAP_COURSES = 200
# `Roadmap.submit` ở `domain/model/roadmap.ts:60`.
MIN_COURSES_TO_SUBMIT = 2
ROADMAP_COURSE_KEYS = {"courseId", "isOptional"}


def _course_uuid(where: str, value: Any, errors: list[str]) -> None:
    """Như `_uuid` nhưng nói ĐÚNG cách sửa của lộ trình.

    Không dùng chung được: câu của `_uuid` khuyên gửi `id: null` cho mục mới, mà ở đây không có
    "khóa học mới" — mọi phần tử phải là một khóa CÓ THẬT. Model đọc lời khuyên sai chỗ rồi gửi
    `courseId: null` là ăn 400 mà không hiểu vì sao.
    """
    if not isinstance(value, str) or not UUID.match(value):
        errors.append(
            f"{where} = {value!r} không phải id khóa học hợp lệ. Lộ trình chỉ chứa khóa CÓ THẬT — "
            "lấy id từ `read_roadmap` hoặc `search_courses`, đừng tự đặt và đừng gửi null."
        )


def check_roadmap_courses_shape(courses: Any) -> list[str]:
    """Lỗi làm `PUT /roadmaps/:id/courses` thất bại. Rỗng = lưu được."""
    if not isinstance(courses, list):
        return [
            "courses phải là MẢNG khóa học, thứ tự trong mảng chính là thứ tự học. "
            'Mỗi phần tử là {"courseId": "<uuid>", "isOptional": false}.'
        ]
    if len(courses) > MAX_ROADMAP_COURSES:
        return [f"tối đa {MAX_ROADMAP_COURSES} khóa học, đang có {len(courses)}"]

    errors: list[str] = []
    ids: list[str] = []

    for index, course in enumerate(courses):
        where = f"courses[{index}]"
        if not isinstance(course, dict):
            errors.append(f"{where} phải là object")
            continue

        # `position` là chỗ dễ sai nhất: DTO KHÔNG nhận nó (thứ tự lấy theo thứ tự mảng), nên gửi
        # thêm là 400 — và model rất hay gửi vì `read_roadmap` của API gốc có trường đó.
        _extra(where, course, ROADMAP_COURSE_KEYS, errors)

        if "courseId" not in course:
            errors.append(f"{where} thiếu 'courseId' (bắt buộc)")
        else:
            _course_uuid(f"{where}.courseId", course["courseId"], errors)
            if isinstance(course["courseId"], str):
                ids.append(course["courseId"])

        if "isOptional" in course and not isinstance(course["isOptional"], bool):
            errors.append(f"{where}.isOptional phải là true/false")

    # `RoadmapUseCases.replaceCourses` ném 409 `AlreadyExists` trước khi chạm cơ sở dữ liệu.
    for duplicate in sorted({x for x in ids if ids.count(x) > 1}):
        errors.append(
            f"khóa học {duplicate} xuất hiện hai lần — một khóa chỉ nằm được một chỗ trong lộ trình"
        )

    return errors


def _stored_courses(current: Any) -> list[dict]:
    return [
        course
        for course in ((current or {}).get("courses") or [])
        if isinstance(course, dict) and course.get("courseId")
    ]


def find_course_removals(
    current: Any, courses: Any, remove_ids: list[str] | None = None
) -> list[dict]:
    """Khóa sẽ rời khỏi lộ trình nếu lưu danh sách này, kèm cờ model có khai ý định gỡ hay không.

    Một nguồn sự thật cho hai người đọc — xem chú thích đầy đủ ở `find_removals`. Tên lấy từ cây
    THẬT, không tra từ thứ agent tự khai.
    """
    payload_ids = {
        course["courseId"]
        for course in (courses or [])
        if isinstance(course, dict) and course.get("courseId")
    }
    declared = set(remove_ids or [])
    return [
        {
            "kind": "course",
            "id": course["courseId"],
            "title": str(course.get("title") or "chưa đặt tên"),
            "declared": course["courseId"] in declared,
        }
        for course in _stored_courses(current)
        if course["courseId"] not in payload_ids
    ]


def check_course_removals(
    current: Any, courses: Any, remove_ids: list[str] | None = None
) -> list[str]:
    """Chặn việc gỡ khóa ngoài ý muốn — lý do tồn tại của `validate_roadmap_courses`.

    `PUT /roadmaps/:id/courses` thay TOÀN BỘ danh sách: khóa nào không có `courseId` trong payload
    thì biến mất khỏi lộ trình. Nhẹ hơn cây chương trình một bậc — `course_enrollments` và
    `lesson_progress` nằm ở khóa học nên tiến độ KHÔNG mất — nhưng học viên đang theo lộ trình thì
    mất chỗ đứng của khóa đó, và cạnh điều kiện mở khóa trỏ vào nó bị xóa theo.

    Vẫn là lỗi CHẶN chứ không phải cảnh báo: một lượt model quên echo lại id — chuyện thường gặp
    khi nó chỉ định "thêm một khóa" — sẽ dọn sạch phần còn lại của lộ trình.
    """
    errors = [
        f"Khóa học '{item['title']}' ({item['id']})"
        for item in find_course_removals(current, courses, remove_ids)
        if not item["declared"]
    ]
    if not errors:
        return []
    return [
        "SẼ GỠ MẤT KHÓA HỌC — payload thay TOÀN BỘ danh sách, nên thiếu id là gỡ: "
        + "; ".join(errors)
        + ". Gọi `read_roadmap` rồi gửi lại ĐỦ mọi khóa kèm `courseId` của chúng. "
        "Thật sự muốn gỡ thì liệt kê đúng những id đó vào `remove_ids`."
    ]


def check_roadmap_submission(current: Any, courses: Any) -> list[str]:
    """Thiếu sót chặn GỬI DUYỆT nhưng không chặn lưu. Trả về dạng cảnh báo.

    Gương của `Roadmap.submit` ở `domain/model/roadmap.ts:274`.

    Trạng thái từng khóa chỉ đọc được từ danh sách ĐANG lưu (`current.courses[].status`). Khóa vừa
    được thêm vào payload thì chưa có ở đó, và ở đây KHÔNG đi hỏi từng khóa một: mỗi lần kiểm sẽ
    thành N lời gọi HTTP, còn cái giá của việc im lặng chỉ là một cảnh báo hiện muộn một lượt —
    lần kiểm sau, khi khóa đã nằm trong danh sách, nó sẽ hiện.
    """
    current = current if isinstance(current, dict) else {}
    missing: list[str] = []

    if not str(current.get("description") or "").strip():
        missing.append("mô tả lộ trình (`description`)")

    payload = [course for course in (courses or []) if isinstance(course, dict)]
    if len(payload) < MIN_COURSES_TO_SUBMIT:
        missing.append(f"tối thiểu {MIN_COURSES_TO_SUBMIT} khóa học (đang có {len(payload)})")

    stored = {course["courseId"]: course for course in _stored_courses(current)}
    unpublished = [
        str(stored[course["courseId"]].get("title") or "chưa đặt tên")
        + f" ({stored[course['courseId']].get('status')})"
        for course in payload
        if course.get("courseId") in stored
        and stored[course["courseId"]].get("status") != "published"
    ]
    if unpublished:
        missing.append("khóa học chưa công khai: " + ", ".join(unpublished))

    return missing


def _canonical_courses(courses: Any) -> list[tuple[str, bool]]:
    return [
        (str(course.get("courseId")), bool(course.get("isOptional")))
        for course in (courses or [])
        if isinstance(course, dict) and course.get("courseId")
    ]


def roadmap_is_unchanged(current: Any, courses: Any) -> bool:
    """Payload giống hệt danh sách đang lưu — xem chú thích ở `is_unchanged`.

    So cả thứ tự: `position` của danh sách lưu chính là thứ tự mảng payload, nên đảo hai khóa là
    một thay đổi thật dù tập hợp không đổi.
    """
    return _canonical_courses(_stored_courses(current)) == _canonical_courses(courses)
