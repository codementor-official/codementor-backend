"""Bề mặt HTTP của Lecter: hai bề mặt AG-UI dạng SSE, mỗi bề mặt kèm ba route lịch sử.

Hai bề mặt, một vòng lặp: `/run` là Lecter đầy đủ của giảng viên; `/workspace/{slug}/run` là
Lecter của nhóm học — chỉ bài code, chỉ trong phạm vi nhóm đó. Khác nhau đúng một `Capability`
(xem `capability.py`), nên mọi bản vá vòng lặp áp cho cả hai.

Phạm vi là quyết định của SERVER: giấy phép gắn vào route, không đọc từ thân yêu cầu.

Không dùng `ag_ui_langgraph.add_langgraph_fastapi_endpoint`: nó gắn route KHÔNG có xác thực. Thân
hàm dưới đây chính là thân của nó, cộng `Depends(require_user)`, kiểm quyền, hạn mức ngày, và
token của người dùng được nhét vào `config` để tool forward đi.

Token đi qua `config`, KHÔNG qua state: state được phát ngược về trình duyệt bằng
STATE_SNAPSHOT/STATE_DELTA.
"""

import logging

from ag_ui.core.types import RunAgentInput
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app import sessions
from app.agent_stream import stream_run
from app.auth import require_user
from app.lecter import http, validate, verify
from app.lecter.capability import LECTURER, WORKSPACE
from app.lecter.http import ToolCallError

logger = logging.getLogger("codementor.ai")

router = APIRouter(prefix="/api/v1/ai/lecter")

# Realm role của Keycloak đặt tên theo hai cách song song (`lecturer` và `LECTURER`) — xem
# `libs/platform/src/auth/jwt-payload.ts`. So khớp không phân biệt hoa thường ở đây để không
# phải chọn một bên rồi ép bên kia đổi theo.
LECTURER_ROLES = frozenset({"lecturer", "admin"})


def require_lecturer(claims: dict) -> None:
    """Bề mặt Lecter đầy đủ (bài code + khóa học + lộ trình) chỉ dành cho giảng viên.

    Trước đây route này chỉ đòi một JWT hợp lệ, nên một học viên gọi thẳng vào cũng nhận đủ
    prompt ba domain và tiêu hạn mức chung. Chưa rò dữ liệu — mọi tool đọc đều forward token
    của chính họ nên Nest tự 403 — nhưng phạm vi thì đã sai.
    """
    roles = {role.lower() for role in (claims.get("realm_access") or {}).get("roles", [])}
    if not roles & LECTURER_ROLES:
        raise HTTPException(403, "Tài khoản này không dùng được Lecter cho nội dung giảng dạy.")


async def _workspace_gate(slug: str, request: Request) -> str:
    """Kiểm quyền soạn bài trong nhóm, trả về `workspaceId`.

    Chạy TRƯỚC khi trừ hạn mức và trước khi mở SSE: người không có quyền nhận 403 ngay, không
    mất một lượt AI nào. Quyền đọc từ workspace-service bằng token của chính người dùng — đúng
    một nguồn sự thật, không viết lại luật phân quyền bằng Python.
    """
    config = {"configurable": {"auth_token": request.state.access_token}}
    try:
        detail = await http.workspace("GET", f"/api/v1/workspaces/{slug}", config)
    except ToolCallError as exc:
        # `ToolCallError` là câu dành cho MODEL đọc giữa một lượt chat. Ở đây chưa có lượt nào —
        # để nó thoát ra ngoài thì FastAPI trả 500 kèm stack trace, và trình duyệt chỉ thấy
        # "Internal Server Error" cho một sự cố có câu giải thích sẵn.
        raise HTTPException(503, str(exc)) from None
    membership = (detail or {}).get("currentMembership") or {}
    permissions = membership.get("permissions") or {}
    if membership.get("role") != "owner" and not permissions.get("create_exercise"):
        raise HTTPException(403, "Bạn không có quyền tạo bài tập trong nhóm này.")
    workspace_id = (detail or {}).get("id")
    if not workspace_id:
        raise HTTPException(404, "Không tìm thấy nhóm học tập.")
    return workspace_id


@router.post("/run")
async def run(input_data: RunAgentInput, request: Request, claims: dict = Depends(require_user)):
    require_lecturer(claims)
    return await stream_run(
        input_data,
        request,
        claims,
        LECTURER,
        # Kho tài liệu CÁ NHÂN của giảng viên. Bề mặt nhóm học không nhận đối tượng này —
        # nó không có tool nào đọc được kho đó.
        {"library": request.app.state.library},
    )


@router.post("/workspace/{slug}/run")
async def run_workspace(
    slug: str,
    input_data: RunAgentInput,
    request: Request,
    claims: dict = Depends(require_user),
):
    workspace_id = await _workspace_gate(slug, request)
    return await stream_run(
        input_data,
        request,
        claims,
        WORKSPACE,
        # `workspace_id` đến từ cổng quyền phía trên, KHÔNG từ trình duyệt: nó dựng nên chuỗi
        # scope `workspace:<id>` mà tool tài liệu dùng để đọc index.
        {"workspace_slug": slug, "workspace_id": workspace_id},
        workspace_id=workspace_id,
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
    require_lecturer(claims)
    return {
        "data": {
            "items": await sessions.listing(
                request.app.state.db, claims["sub"], agent_id=LECTURER.agent_id
            )
        }
    }


@router.get("/sessions/{thread_id}")
async def read_session(thread_id: str, request: Request, claims: dict = Depends(require_user)):
    require_lecturer(claims)
    found = await sessions.read(
        request.app.state.db, claims["sub"], thread_id, agent_id=LECTURER.agent_id
    )
    if not found:
        raise HTTPException(404, "Không tìm thấy hội thoại.")
    return {"data": found}


@router.delete("/sessions/{thread_id}", status_code=204)
async def delete_session(thread_id: str, request: Request, claims: dict = Depends(require_user)):
    require_lecturer(claims)
    if not await sessions.remove(
        request.app.state.db, claims["sub"], thread_id, agent_id=LECTURER.agent_id
    ):
        raise HTTPException(404, "Không tìm thấy hội thoại.")


@router.get("/workspace/{slug}/sessions")
async def list_workspace_sessions(
    slug: str, request: Request, claims: dict = Depends(require_user)
):
    workspace_id = await _workspace_gate(slug, request)
    return {
        "data": {
            "items": await sessions.listing(
                request.app.state.db,
                claims["sub"],
                agent_id=WORKSPACE.agent_id,
                workspace_id=workspace_id,
            )
        }
    }


@router.get("/workspace/{slug}/sessions/{thread_id}")
async def read_workspace_session(
    slug: str, thread_id: str, request: Request, claims: dict = Depends(require_user)
):
    workspace_id = await _workspace_gate(slug, request)
    found = await sessions.read(
        request.app.state.db,
        claims["sub"],
        thread_id,
        agent_id=WORKSPACE.agent_id,
        workspace_id=workspace_id,
    )
    if not found:
        raise HTTPException(404, "Không tìm thấy hội thoại.")
    return {"data": found}


@router.delete("/workspace/{slug}/sessions/{thread_id}", status_code=204)
async def delete_workspace_session(
    slug: str, thread_id: str, request: Request, claims: dict = Depends(require_user)
):
    workspace_id = await _workspace_gate(slug, request)
    if not await sessions.remove(
        request.app.state.db,
        claims["sub"],
        thread_id,
        agent_id=WORKSPACE.agent_id,
        workspace_id=workspace_id,
    ):
        raise HTTPException(404, "Không tìm thấy hội thoại.")
