"""Tool chạy phía server: chỉ ĐỌC kho nội dung và CHẠY THỬ mã.

Không có tool nào ở đây ghi vào cơ sở dữ liệu. Mọi tool ghi — bài code
(`create_exercise`, `update_exercise_meta`, `save_exercise_content`) và khóa học
(`create_course`, `update_course_meta`, `save_curriculum`, `save_lesson_contents`) — do trình
duyệt khai báo và tự thi hành sau khi người dùng bấm xác nhận, xem
`apps/lecturer/src/features/lecter/hitl.tsx` và `hitl-course.tsx`. Đó không phải quy ước mềm: kẻ
tấn công tự khai thêm một tool `delete_exercise` cũng chỉ gọi được thứ token của họ vốn đã gọi
được, còn ai-service thì không cầm credential ghi nào cả.

Không đăng ký: xoá, gửi duyệt, kiểm duyệt, công khai, fork. Không phải vì prompt cấm — vì chúng
không tồn tại trong danh sách này.
"""

import json
from typing import Any, Literal

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from app.lecter import http, validate
from app.lecter.http import ToolCallError, clip
from app.lecter.validate import JUDGE_LANGUAGES, normalize_language

# Trần trả về. Model không cần 20 bài để biết "chủ đề này đã có bài rồi".
MAX_SEARCH_ITEMS = 10
MAX_FAILING_CASES = 3


def _check_run_mode(test_cases: list[dict], signature: dict | None) -> str | None:
    """Chặn hai cách gọi làm bộ chấm nổ thay vì trả verdict.

    Bỏ `signature` là rơi vào chế độ stdin/stdout, và ở đó bộ chấm SO SÁNH CHUỖI: nó gọi
    `expected.strip()`, nên một `expected` dạng số làm nó ném AttributeError và trả 500 không kèm
    lý do (`apps/judge-service/app/services/judgement.py:65`). Model đã mất ba lượt vì đúng chỗ này.
    """
    if signature:
        return None

    with_args = [case.get("order") for case in test_cases if case.get("args") is not None]
    if with_args:
        return (
            f"THIẾU `signature`: test case {', '.join(map(str, with_args))} dùng `args`, tức "
            "chế độ hàm, nhưng lời gọi không có `signature`. Gửi kèm signature (functionName, "
            "parameters, "
            "returnType) — đúng cái sẽ lưu vào `content.signature`."
        )

    bad = [
        case.get("order")
        for case in test_cases
        if not isinstance(case.get("input", ""), str)
        or not isinstance(case.get("expected", ""), str)
    ]
    if bad:
        return (
            f"SAI KIỂU Ở CHẾ ĐỘ STDIN: test case {', '.join(map(str, bad))} có `input` hoặc "
            "`expected` không phải chuỗi. Chế độ stdin so sánh văn bản, nên dùng \"55\" chứ không "
            "phải 55. Muốn dùng giá trị có kiểu thì gửi `signature` để chạy chế độ hàm."
        )
    return None


def _unsupported_language_error(unknown: list[str]) -> str:
    """Chặn tại chỗ thay vì để bộ chấm trả lỗi 5xx — model đọc câu này rồi sửa ngay trong lượt."""
    return (
        f"SAI ID NGÔN NGỮ: {', '.join(unknown)}. "
        f"Bộ chấm chỉ nhận id viết thường: {', '.join(JUDGE_LANGUAGES)}. "
        "Dùng đúng id đó cho cả `run_solution` lẫn `languages[].id` khi lưu nội dung."
    )


@tool
async def search_exercises(
    query: str,
    config: RunnableConfig,
    difficulty: Literal["easy", "medium", "hard"] | None = None,
) -> str:
    """Tìm bài code đã công khai trong kho, theo từ khoá tiêu đề. Dùng TRƯỚC khi soạn bài mới để
    biết chủ đề đó đã có bài chưa. Chỉ trả về bài đã public — bài nháp của giảng viên không nằm ở
    đây."""
    params: dict[str, Any] = {"q": query[:200], "limit": MAX_SEARCH_ITEMS}
    if difficulty:
        params["difficulty"] = difficulty
    page = await http.exercise("GET", "/api/v1/exercises", config, params=params)
    items = (page or {}).get("items", [])[:MAX_SEARCH_ITEMS]
    if not items:
        return "Không có bài nào khớp."
    return "\n".join(
        f"- {item['id']} · {item['title']} · {item.get('difficulty', '?')}"
        f" · chủ đề: {', '.join(topic['name'] for topic in item.get('topics') or []) or 'chưa gắn'}"
        for item in items
    )


@tool
async def read_exercise(exercise_id: str, config: RunnableConfig) -> str:
    """Đọc chi tiết một bài code theo id, gồm cả đề bài và cấu hình chấm nếu người dùng là tác giả.
    Dùng khi cần sửa một bài đã có, hoặc lấy một bài đã tốt làm mẫu."""
    data = await http.exercise("GET", f"/api/v1/exercises/{exercise_id}", config)
    content = (data or {}).get("content") or {}
    return clip(
        {
            "id": data.get("id"),
            "slug": data.get("slug"),
            "title": data.get("title"),
            "status": data.get("status"),
            "difficulty": data.get("difficulty"),
            "summary": data.get("summary"),
            "timeLimitMs": data.get("timeLimitMs"),
            "memoryLimitKb": data.get("memoryLimitKb"),
            "tagIds": data.get("tagIds"),
            "ioMode": content.get("ioMode"),
            "signature": content.get("signature"),
            "statement": clip(content.get("statement") or "", 2000),
            "testCaseCount": len(content.get("testCases") or []),
            "languages": [lang.get("id") for lang in content.get("languages") or []],
        },
        6000,
    )


@tool
async def list_topics(config: RunnableConfig) -> str:
    """Danh sách chủ đề (tag) có thật trong hệ thống, kèm id. Bắt buộc gọi trước khi đề xuất
    `tagIds` — id bịa ra sẽ bị backend từ chối."""
    tags = await http.core("GET", "/api/v1/tags", config)
    return "\n".join(f"- {tag['id']} · {tag['name']}" for tag in (tags or [])[:200]) or "Chưa có chủ đề nào."


@tool
async def generate_starter(
    languages: list[str],
    signature: dict,
    config: RunnableConfig,
) -> str:
    """Sinh mã khởi tạo (starter code) từ chữ ký hàm, cho từng ngôn ngữ.

    KHÔNG tự viết starter code — bộ chấm sinh starter và driver từ cùng một module, tự viết tay là
    chữ ký hai bên lệch nhau.

    `languages`: id viết THƯỜNG, một trong python, javascript, typescript, java, go, php, c,
    cpp. Ví dụ ["python", "cpp"].
    `signature`: {"functionName": "two_sum", "parameters": [{"name": "nums",
    "type": {"kind": "list", "of": {"kind": "int"}}}, {"name": "k", "type": {"kind": "int"}}],
    "returnType": {"kind": "list", "of": {"kind": "int"}}}.
    """
    ids = [normalize_language(language) for language in languages]
    unknown = [language for language in ids if language not in JUDGE_LANGUAGES]
    if unknown:
        return _unsupported_language_error(unknown)
    data = await http.judge(
        "POST", "/api/v1/judge/starter", config, json_body={"languages": ids, "spec": signature}
    )
    starters = (data or {}).get("starters") or {}
    unsupported = (data or {}).get("unsupported") or {}
    lines = [f"### {lang}\n{code}" for lang, code in starters.items()]
    lines += [f"### {lang}: KHÔNG hỗ trợ — {reason}" for lang, reason in unsupported.items()]
    return clip("\n\n".join(lines), 8000)


@tool
async def run_solution(
    language: str,
    source_code: str,
    test_cases: list[dict],
    config: RunnableConfig,
    signature: dict | None = None,
    time_limit_ms: int = 1000,
    memory_limit_kb: int = 262144,
) -> str:
    """Chạy lời giải mẫu qua bộ chấm thật. Đây là bước xác nhận bắt buộc trước khi đề xuất bài.

    `language` là ID viết THƯỜNG, không phải nhãn hiển thị: một trong
    python, javascript, typescript, java, go, php, c, cpp. Gửi "Python" hay "Python 3.11" sẽ bị
    bộ chấm từ chối.

    Hai chế độ, quyết định bởi việc có `signature` hay không:
    - Chế độ hàm (có `signature`): mỗi test case là {"order": 1, "args": [[1,2,3], 5],
      "expected": [0,1]}. `args` phải đúng thứ tự và đúng số lượng tham số của signature.
    - Chế độ stdin/stdout (không `signature`): mỗi test case là {"order": 1, "input": "3\\n1 2 3",
      "expected": "6"}. `order` bắt đầu từ 1.

    Chưa biết `expected` thì cứ để null: kết quả trả về có `actual` của từng case, dùng chính nó
    làm `expected` — đó là cách sinh đáp án đúng theo định nghĩa, vì nó chạy lời giải mẫu thật.
    """
    language_id = normalize_language(language)
    if language_id not in JUDGE_LANGUAGES:
        return _unsupported_language_error([language_id])

    mode_error = _check_run_mode(test_cases, signature)
    if mode_error:
        return mode_error

    body: dict[str, Any] = {
        "language": language_id,
        "sourceCode": source_code,
        "timeLimitMs": time_limit_ms,
        "memoryLimitKb": memory_limit_kb,
        "testCases": test_cases,
    }
    if signature:
        body["spec"] = signature

    try:
        result = await http.judge("POST", "/api/v1/judge/run", config, json_body=body)
    except ToolCallError as exc:
        # Bộ chấm hỏng KHÔNG được làm chết cả lượt. Trả về câu mô tả để model biết mà nói lại với
        # giảng viên, thay vì im lặng đề xuất một bài chưa được kiểm chứng.
        return f"CHƯA XÁC NHẬN ĐƯỢC: {exc}"

    result = result or {}
    cases = result.get("cases") or []
    failing = [case for case in cases if case.get("verdict") != "accepted"][:MAX_FAILING_CASES]

    lines = [
        f"verdict={result.get('verdict')} "
        f"pass={result.get('passedTests')}/{result.get('totalTests')} "
        f"{result.get('runtimeMs')}ms"
    ]
    if result.get("compileOutput"):
        lines.append(f"Lỗi biên dịch: {clip(result['compileOutput'], 1500)}")
    for case in failing:
        lines.append(
            f"- case #{case.get('order')} {case.get('verdict')}: "
            f"expected={clip(case.get('expected'))} actual={clip(case.get('actual'))}"
            + (f" stderr={clip(case.get('stderr'))}" if case.get("stderr") else "")
        )
    if cases and not failing:
        lines.append("Tất cả case đều đúng. Kết quả `actual` dùng làm `expected` được.")
        lines.append(
            "actual theo thứ tự case: "
            + clip([case.get("actual") for case in cases], 2000)
        )
        # Chỗ đứt duy nhất của cả quy trình: đoạn code vừa chạy qua ĐANG nằm trong tay model,
        # nhưng không gì nối nó với `content.languages`, nên nó soạn payload thiếu hẳn trường đó
        # rồi kẹt ở bước validate.
        lines.append(
            f'Mang chính `sourceCode` vừa chạy sang content.languages: {{"id": "{language_id}", '
            f'"label": "…", "referenceSolution": <sourceCode>}}. Thiếu là không lưu được.'
        )
    return "\n".join(lines)


@tool
async def validate_exercise_content(content: dict) -> str:
    """Kiểm nội dung bài code TRƯỚC khi đề xuất lưu. Bắt buộc gọi trước `save_exercise_content`.

    Trả về hoặc "HỢP LỆ" kèm cảnh báo, hoặc danh sách lỗi phải sửa. Đề xuất một nội dung còn lỗi
    nghĩa là người soạn bấm xác nhận rồi mới thấy lỗi, và họ không sửa được payload — chỉ còn cách
    bỏ qua.

    `content` là đúng object sẽ gửi cho `save_exercise_content`, không phải bản rút gọn.
    """
    # `check_reference_solutions` là luật của riêng Lecter, không phải của backend — xem
    # docstring của nó. Gộp vào danh sách CHẶN chứ không xếp cùng cảnh báo gửi duyệt.
    errors = validate.check_shape(content) + validate.check_reference_solutions(content)
    if errors:
        return "CHƯA LƯU ĐƯỢC, phải sửa:\n" + "\n".join(f"- {line}" for line in errors)

    # Mệnh lệnh đứng TRƯỚC cảnh báo. Đặt sau, model đọc phần "còn thiếu" rồi quay lại sửa thay vì
    # đi tiếp, và bài không bao giờ được lưu.
    warnings = validate.check_submission(content)
    if warnings:
        return (
            "HỢP LỆ. Gọi `save_exercise_content` NGAY BÂY GIỜ với đúng object này.\n"
            "Rồi nói thêm cho người soạn biết — những thứ sau chỉ chặn GỬI DUYỆT, không chặn lưu:\n"
            + "\n".join(f"- {line}" for line in warnings)
        )
    return "HỢP LỆ. Gọi `save_exercise_content` NGAY BÂY GIỜ với đúng object này."




# --- Khóa học -------------------------------------------------------------

# Bảy khoá `SaveCurriculumDto` cho phép, đúng thứ tự dễ đọc. `read_course` dựng lại payload bằng
# CHÍNH danh sách này, nên thứ nó trả về copy thẳng sang `save_curriculum` được — thừa một khoá là
# Nest trả 400.
_PAYLOAD_LESSON_KEYS = (
    "id", "title", "type", "durationMinutes", "isPreview", "isOptional", "exerciseId",
)


def _payload_tree(chapters: list[dict]) -> list[dict]:
    return [
        {
            "id": chapter.get("id"),
            "title": chapter.get("title"),
            "description": chapter.get("description"),
            "isOptional": bool(chapter.get("isOptional")),
            "lessons": [
                {key: lesson.get(key) for key in _PAYLOAD_LESSON_KEYS}
                for lesson in (chapter.get("lessons") or [])
            ],
        }
        for chapter in chapters
    ]


@tool
async def search_courses(query: str, config: RunnableConfig, mine: bool = True) -> str:
    """Tìm khóa học theo từ khoá tiêu đề.

    `mine=True` (mặc định) tìm trong khóa học của chính giảng viên, MỌI trạng thái kể cả nháp —
    đây gần như luôn là thứ cần khi soạn nội dung. `mine=False` tìm trong kho công khai, dùng khi
    muốn xem thị trường đã có khóa tương tự chưa.
    """
    path = "/api/v1/courses/mine" if mine else "/api/v1/courses"
    page = await http.learning(
        "GET", path, config, params={"q": query[:200], "limit": MAX_SEARCH_ITEMS}
    )
    items = (page or {}).get("items", [])[:MAX_SEARCH_ITEMS]
    if not items:
        return "Không có khóa học nào khớp."
    return "\n".join(
        f"- {item['id']} · {item.get('title')} · {item.get('status', '?')}"
        f" · trình độ {item.get('level', '?')}"
        f" · {item.get('totalChapters', 0)} chương, {item.get('totalLessons', 0)} bài"
        for item in items
    )


@tool
async def read_course(course_id: str, config: RunnableConfig) -> str:
    """Đọc một khóa học kèm TOÀN BỘ cây chương/bài và id của chúng.

    BẮT BUỘC gọi trước mỗi lần sửa cây, kể cả khi chỉ thêm một chương. Lý do: lệnh lưu thay toàn
    bộ cây, nên phần bạn không gửi lại sẽ bị xóa cùng tiến độ của học viên đang học.

    Trả về hai khối tách bạch:
    - `chapters` — ĐÚNG hình dạng của `save_curriculum`. Sao chép nguyên khối này rồi sửa, đừng
      tự gõ lại.
    - phần trạng thái chỉ-đọc (nội dung đã soạn chưa, bài code đã công khai chưa) — KHÔNG được
      đưa vào payload.
    """
    data = await http.learning("GET", f"/api/v1/courses/{course_id}", config) or {}
    chapters = data.get("chapters") or []

    meta = {
        "id": data.get("id"),
        "slug": data.get("slug"),
        "title": data.get("title"),
        "status": data.get("status"),
        "level": data.get("level"),
        # KHÔNG đưa `progressionMode` cho model. Tên enum không còn khớp nghĩa: `graph` chính
        # là chế độ tuyến tính của hệ thống (xem MODE_LABELS ở packages/types), nên model đọc
        # được chữ đó là suy ra "khóa đang ở chế độ đồ thị" rồi nói sai với giảng viên — đã xảy
        # ra. Model cũng không có tool nào đổi trường này, nên nó không cần biết.
        "tagIds": data.get("tagIds"),
        "description": clip(data.get("description") or "", 1000),
    }

    status_lines = []
    for chapter in chapters:
        for lesson in chapter.get("lessons") or []:
            marks = []
            if lesson.get("type") in validate.EXERCISE_BEARING:
                marks.append(
                    f"bài code: {lesson.get('exerciseTitle') or 'CHƯA GẮN'}"
                    + (f" ({lesson['exerciseStatus']})" if lesson.get("exerciseStatus") else "")
                )
            else:
                marks.append("đã có nội dung" if lesson.get("contentRef") else "CHƯA có nội dung")
            status_lines.append(f"  - {lesson.get('title')} [{lesson.get('id')}]: {'; '.join(marks)}")

    return clip(
        "THÔNG TIN CHUNG\n"
        + json.dumps(meta, ensure_ascii=False)
        + "\n\nCÂY CHƯƠNG TRÌNH — sao chép nguyên khối này cho `save_curriculum`:\n"
        + json.dumps(_payload_tree(chapters), ensure_ascii=False)
        + "\n\nTRẠNG THÁI (chỉ để đọc, KHÔNG đưa vào payload):\n"
        + ("\n".join(status_lines) or "  (chưa có bài học nào)"),
        16000,
    )


@tool
async def read_lesson_content(course_id: str, lesson_id: str, config: RunnableConfig) -> str:
    """Đọc nội dung đang lưu của một bài học. Gọi trước khi sửa nội dung có sẵn — ghi là MERGE,
    nên bạn cần biết cái gì đang có để không viết đè nhầm."""
    data = await http.learning(
        "GET", f"/api/v1/courses/{course_id}/lessons/{lesson_id}/content", config
    )
    if not data:
        return "Bài này chưa có nội dung nào."
    return clip(data, 8000)


@tool
async def validate_curriculum(
    course_id: str,
    chapters: list[dict],
    config: RunnableConfig,
    remove_ids: list[str] | None = None,
) -> str:
    """Kiểm cây chương trình TRƯỚC khi đề xuất lưu. BẮT BUỘC gọi trước `save_curriculum`.

    Kiểm ba thứ: hình dạng payload, phần dữ liệu SẼ BỊ XÓA vì thiếu id, và những gì còn thiếu để
    gửi duyệt.

    `chapters` là đúng mảng sắp gửi cho `save_curriculum`; thứ tự trong mảng chính là thứ tự hiển
    thị. `remove_ids` chỉ điền khi giảng viên THẬT SỰ muốn xóa chương/bài đó — bỏ trống thì mọi id
    đang tồn tại đều phải có mặt trong `chapters`.
    """
    errors = validate.check_curriculum_shape(chapters)

    try:
        current = await http.learning("GET", f"/api/v1/courses/{course_id}", config) or {}
    except ToolCallError as exc:
        # Không đọc được cây hiện tại thì KHÔNG được kết luận "hợp lệ": đúng lúc đó phần kiểm
        # xóa nhầm — thứ duy nhất bảo vệ dữ liệu học viên — là phần không chạy được.
        return f"CHƯA KIỂM ĐƯỢC: không đọc được khóa học ({exc}). Đừng đề xuất lưu khi chưa kiểm."

    errors += validate.check_removals(current, chapters, remove_ids)
    if errors:
        return "CHƯA LƯU ĐƯỢC, phải sửa:\n" + "\n".join(f"- {line}" for line in errors)

    if validate.is_unchanged(current, chapters):
        return (
            "KHÔNG CÓ GÌ THAY ĐỔI: mảng bạn gửi giống hệt cây đang lưu. ĐỪNG gọi "
            "`save_curriculum` — nó chỉ mở một hộp xác nhận cho một thay đổi rỗng. Sửa cây theo "
            "đúng thứ giảng viên yêu cầu rồi kiểm lại, hoặc nói thẳng với họ là chưa có gì để đổi."
        )

    warnings = validate.check_course_submission(current, chapters)
    head = "HỢP LỆ. Gọi `save_curriculum` NGAY BÂY GIỜ với đúng mảng này."
    if remove_ids:
        head += f"\nLƯU Ý: sẽ xóa {len(remove_ids)} mục theo `remove_ids` bạn khai."
    if warnings:
        return (
            head
            + "\nRồi nói thêm cho giảng viên biết — những thứ sau chỉ chặn GỬI DUYỆT, không chặn "
            "lưu:\n"
            + "\n".join(f"- {line}" for line in warnings)
        )
    return head


SERVER_TOOLS: tuple[Any, ...] = (
    # Bài code
    search_exercises,
    validate_exercise_content,
    read_exercise,
    list_topics,
    generate_starter,
    run_solution,
    # Khóa học
    search_courses,
    read_course,
    read_lesson_content,
    validate_curriculum,
)

# Tool mà gọi lại với ĐÚNG tham số cũ chắc chắn ra cùng kết quả, nên lặp lại là lãng phí và
# đáng nhắc. Danh sách này là WHITELIST có chủ đích: tool mới thêm sau sẽ mặc định KHÔNG bị nhắc.
#
# Vì sao không nhắc tool đọc: `read_course`, `search_*`, `list_topics` sinh ra để đọc lại — nhất
# là ngay sau một lệnh ghi, lúc dữ liệu vừa đổi. Trước đây chúng nằm chung và hậu quả là câu nhắc
# "kết quả cũng y hệt" bắn ra ngay sau `save_curriculum`, tức là SAI SỰ THẬT: cây đã khác. Model
# đọc câu đó rồi nói với giảng viên là nó "chưa đọc lại được khóa học", trông y như mất trí nhớ.
NUDGE_ON_REPEAT = frozenset(
    {"validate_exercise_content", "validate_curriculum", "run_solution", "generate_starter"}
)

__all__ = ["NUDGE_ON_REPEAT", "SERVER_TOOLS", "ToolCallError"]
