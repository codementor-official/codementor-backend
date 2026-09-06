"""Bề mặt HTTP của Lecter: một route AG-UI dạng SSE, ba route lịch sử.

Không dùng `ag_ui_langgraph.add_langgraph_fastapi_endpoint`: nó gắn route KHÔNG có xác thực. Thân
hàm dưới đây chính là thân của nó, cộng `Depends(require_user)`, hạn mức ngày, và token của người
dùng được nhét vào `config` để tool forward đi.

Token đi qua `config`, KHÔNG qua state: state được phát ngược về trình duyệt bằng
STATE_SNAPSHOT/STATE_DELTA.
"""

import logging

from ag_ui.core.events import EventType, RunErrorEvent
from ag_ui.core.types import RunAgentInput
from ag_ui.encoder import EventEncoder
from ag_ui_langgraph import LangGraphAgent
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import budget
from app.auth import require_user
from app.config import settings
from app.lecter import http, sessions, validate, verify
from app.lecter.graph import GRAPH

logger = logging.getLogger("codementor.ai")

router = APIRouter(prefix="/api/v1/ai/lecter")

# Hàng rào chi phí, không phải hàng rào logic: một agent lặp mãi vì tool trả lỗi là chuyện có
# thật, và giới hạn bước là cách rẻ nhất chặn nó. 24 = khoảng 8 lượt gọi model có tool.
RECURSION_LIMIT = 24


@router.post("/run")
async def run(input_data: RunAgentInput, request: Request, claims: dict = Depends(require_user)):
    state = request.app.state
    state.provider.require_configured()
    await budget.consume(state.db, claims["sub"], "lecter", settings.ai_lecter_daily_limit)

    agent = LangGraphAgent(
        name="lecter",
        graph=GRAPH,
        # Tắt RAW: mặc định `LangGraphAgent` mirror MỌI sự kiện LangChain ra SSE, và
        # `on_chat_model_start` mang theo NGUYÊN system prompt cùng khối reasoning đã mã hoá —
        # tức là gửi prompt của mình về trình duyệt, kèm vài KB mỗi token. Client AG-UI không
        # dùng RAW cho việc gì; TEXT_MESSAGE_* và TOOL_CALL_* là đủ.
        emit_raw_events=False,
        config={
            "recursion_limit": RECURSION_LIMIT,
            "configurable": {
                "auth_token": request.state.access_token,
                "user_id": claims["sub"],
                # Tool tài liệu đọc thẳng Mongo/S3 chứ không qua HTTP, nên nó cần chính hai
                # đối tượng của tiến trình. Đi qua `config`, KHÔNG qua state: state được phát
                # ngược về trình duyệt bằng STATE_SNAPSHOT.
                "library": request.app.state.library,
                "index": request.app.state.index,
            },
        },
    )
    encoder = EventEncoder(accept=request.headers.get("accept"))
    thread_id = input_data.thread_id

    async def stream():
        # `finally`, không phải dòng sau vòng lặp: đóng tab giữa lúc Lecter đang trả lời làm
        # Starlette đóng generator bằng `GeneratorExit` ngay tại `yield`, mà `GeneratorExit` là
        # `BaseException` nên `except Exception` không bắt. Lượt đó mất trắng — đúng lúc cần lưu
        # nhất, vì người dùng bỏ đi giữa chừng rồi sẽ quay lại tìm hội thoại.
        try:
            async for event in agent.run(input_data):
                yield encoder.encode(event)
        except Exception:
            # Không có RUN_ERROR thì trình duyệt treo mãi ở dòng tool đang chạy: SSE đã mở, nên
            # một ngoại lệ ở đây chỉ đóng kết nối, không thành mã lỗi HTTP nào cả.
            logger.exception("Lecter run hỏng giữa chừng (thread %s)", thread_id)
            yield encoder.encode(
                RunErrorEvent(
                    type=EventType.RUN_ERROR,
                    message="Lượt này hỏng giữa chừng. Thử lại giúp mình.",
                    code="internal_error",
                )
            )
        finally:
            # Checkpoint đã có mọi thứ đã stream ra, nên phần đã trả lời vẫn lưu nguyên.
            await sessions.save(state.db, claims["sub"], thread_id, GRAPH)

    return StreamingResponse(
        stream(),
        media_type=encoder.get_content_type(),
        # Kong không bật buffering, nhưng một reverse proxy nginx nào đó ở tầng trên thì có;
        # hai header này là cách chuẩn nói với nó rằng đừng gom.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class CurriculumCheck(BaseModel):
    courseId: str
    chapters: list[dict] = Field(default_factory=list)
    removeIds: list[str] = Field(default_factory=list)


class ExerciseContentCheck(BaseModel):
    content: dict = Field(default_factory=dict)


class RoadmapCoursesCheck(BaseModel):
    roadmapId: str
    courses: list[dict] = Field(default_factory=list)
    removeIds: list[str] = Field(default_factory=list)


def _as_config(request: Request) -> dict:
    """Token của người dùng, đóng gói đúng hình dạng mà `http.py` đọc."""
    return {"configurable": {"auth_token": request.state.access_token}}


@router.post("/check/curriculum")
async def check_curriculum(
    payload: CurriculumCheck, request: Request, claims: dict = Depends(require_user)
):
    """Kiểm cây NGAY TRƯỚC khi trình duyệt ghi, không phải lúc model xin ý kiến.

    Đây là điểm khác biệt: `validate_curriculum` là một tool model TÙY Ý gọi, và payload nó đưa
    cho tool đó không nhất thiết là payload nó gửi đi lưu — chuyện đã xảy ra, validate với
    `id: null` rồi lưu với `id: "new-1"`. Endpoint này nhận đúng mảng sắp ghi.

    Không tiêu hạn mức ngày: ở đây không có lời gọi model nào.
    """
    current = await http.learning(
        "GET", f"/api/v1/courses/{payload.courseId}", _as_config(request)
    ) or {}
    errors = validate.check_curriculum_shape(payload.chapters)
    errors += validate.check_removals(current, payload.chapters, payload.removeIds)
    return {
        "data": {
            "errors": errors,
            "warnings": validate.check_course_submission(current, payload.chapters),
            "removals": validate.find_removals(current, payload.chapters, payload.removeIds),
            "status": current.get("status"),
        }
    }


@router.post("/check/exercise-content")
async def check_exercise_content(
    payload: ExerciseContentCheck, request: Request, claims: dict = Depends(require_user)
):
    """Kiểm hình dạng VÀ chạy chính lời giải trong content qua bộ chấm.

    `validate_exercise_content` không làm được việc thứ hai: nó chỉ thấy `referenceSolution` là
    một chuỗi không rỗng. Bộ chấm thì chỉ thấy thứ model tự chọn đưa cho `run_solution`. Hai thứ
    đó đã từng khác nhau, và một bài chạy 0/3 vẫn lưu xuống được.
    """
    content = payload.content
    errors = validate.check_shape(content) + validate.check_reference_solutions(content)
    # `check_submission` gọi lại `check_reference_solutions` bên trong, nên thiếu `languages` sẽ
    # ra cùng một câu ở cả hai danh sách. Hiện hai lần cho người soạn đọc là nhiễu.
    warnings = [line for line in validate.check_submission(content) if line not in errors]

    runs: list[dict] = []
    if not errors:
        runs = await verify.run_reference_solutions(content, _as_config(request))
        run_errors, run_warnings = verify.summarize(runs)
        errors += run_errors
        warnings += run_warnings

    return {"data": {"errors": errors, "warnings": warnings, "runs": runs}}


@router.post("/check/roadmap-courses")
async def check_roadmap_courses(
    payload: RoadmapCoursesCheck, request: Request, claims: dict = Depends(require_user)
):
    """Kiểm danh sách khóa học NGAY TRƯỚC khi trình duyệt ghi.

    Cùng lý do như `check_curriculum`: `validate_roadmap_courses` là một tool model TÙY Ý gọi, và
    mảng nó đưa cho tool đó không nhất thiết là mảng nó gửi đi lưu. Endpoint này nhận đúng mảng
    sắp ghi.

    Không tiêu hạn mức ngày: ở đây không có lời gọi model nào.
    """
    current = await http.learning(
        "GET", f"/api/v1/roadmaps/{payload.roadmapId}", _as_config(request)
    ) or {}
    errors = validate.check_roadmap_courses_shape(payload.courses)
    errors += validate.check_course_removals(current, payload.courses, payload.removeIds)
    return {
        "data": {
            "errors": errors,
            "warnings": validate.check_roadmap_submission(current, payload.courses),
            "removals": validate.find_course_removals(
                current, payload.courses, payload.removeIds
            ),
            "status": current.get("status"),
        }
    }


@router.get("/sessions")
async def list_sessions(request: Request, claims: dict = Depends(require_user)):
    return {"data": {"items": await sessions.listing(request.app.state.db, claims["sub"])}}


@router.get("/sessions/{thread_id}")
async def read_session(thread_id: str, request: Request, claims: dict = Depends(require_user)):
    found = await sessions.read(request.app.state.db, claims["sub"], thread_id)
    if not found:
        raise HTTPException(404, "Không tìm thấy hội thoại.")
    return {"data": found}


@router.delete("/sessions/{thread_id}", status_code=204)
async def delete_session(thread_id: str, request: Request, claims: dict = Depends(require_user)):
    if not await sessions.remove(request.app.state.db, claims["sub"], thread_id):
        raise HTTPException(404, "Không tìm thấy hội thoại.")
