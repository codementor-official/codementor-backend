"""Tool chạy phía server: chỉ ĐỌC kho nội dung và CHẠY THỬ mã.

Không có tool nào ở đây ghi vào cơ sở dữ liệu. Ba tool ghi (`create_exercise`,
`update_exercise_meta`, `save_exercise_content`) do trình duyệt khai báo và tự thi hành sau khi
người dùng bấm xác nhận — xem `apps/lecturer/src/features/lecter/hitl.tsx`. Đó không phải quy ước
mềm: kẻ tấn công tự khai thêm một tool `delete_exercise` cũng chỉ gọi được thứ token của họ vốn đã
gọi được, còn ai-service thì không cầm credential ghi nào cả.

Không đăng ký: xoá, gửi duyệt, kiểm duyệt, công khai, fork. Không phải vì prompt cấm — vì chúng
không tồn tại trong danh sách này.
"""

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


SERVER_TOOLS: tuple[Any, ...] = (
    search_exercises,
    validate_exercise_content,
    read_exercise,
    list_topics,
    generate_starter,
    run_solution,
)

__all__ = ["SERVER_TOOLS", "ToolCallError"]
