"""Bề mặt HTTP của Codey: một route SSE và ba route lịch sử.

Không có cổng quyền nào ngoài `Depends(require_user)`. Đó là đủ, và đó là điểm khác Lecter: Codey
không đọc gì từ hệ thống, nên không có quyền nào để mà kiểm. Toàn bộ ngữ cảnh đến từ trình duyệt
qua tool trình duyệt, và trình duyệt chỉ cầm bản nội dung đã được exercise-service lọc.

`exerciseId` và tên bài đi bằng header chứ không nằm trong thân yêu cầu: `RunAgentInput` là schema
của AG-UI và một khoá lạ thêm vào đó sẽ bị nó từ chối. Chúng là dữ liệu HIỂN THỊ cho danh sách
lịch sử, không phải khoá phân quyền — bịa ra một `exerciseId` chỉ làm bẩn danh sách của chính
người bịa.
"""

from urllib.parse import unquote

from ag_ui.core.types import RunAgentInput
from fastapi import APIRouter, Depends, HTTPException, Request

from app import sessions
from app.agent_stream import stream_run
from app.auth import require_user
from app.codey.capability import CODEY

router = APIRouter(prefix="/api/v1/ai/codey")

SCOPE_HEADER = "x-agent-scope"
LABEL_HEADER = "x-agent-scope-label"
ID_CHARS = 64
TITLE_CHARS = 120


def _clean(value: str, limit: int) -> str:
    """Cắt ngắn và bỏ ký tự điều khiển. Chuỗi này được hiện lại trong danh sách lịch sử."""
    return "".join(char for char in value if char.isprintable())[:limit].strip()


def _scope(request: Request) -> dict:
    """`exerciseId` + tên bài của lượt này, đọc từ header.

    Tiêu đề phải `encodeURIComponent` phía trình duyệt: header HTTP là latin-1, còn tên bài thì
    tiếng Việt có dấu — gửi thô là `UnicodeEncodeError` ở tầng Node hoặc chữ vỡ ở đây, và nó chỉ
    nổ với bài có dấu nên rất dễ lọt qua một vòng test bằng tiếng Anh.
    """
    exercise_id = _clean(request.headers.get(SCOPE_HEADER, ""), ID_CHARS)
    if not exercise_id:
        return {}
    title = _clean(unquote(request.headers.get(LABEL_HEADER, "")), TITLE_CHARS)
    return {"exerciseId": exercise_id, "exerciseTitle": title or "Bài không rõ tên"}


@router.post("/run")
async def run(input_data: RunAgentInput, request: Request, claims: dict = Depends(require_user)):
    return await stream_run(
        input_data,
        request,
        claims,
        CODEY,
        # Không có khoá config nào: Codey không có tool server để mà cần token hay kho tài liệu.
        {},
        session_extra=_scope(request),
    )


@router.get("/sessions")
async def list_sessions(request: Request, claims: dict = Depends(require_user)):
    """Mọi hội thoại Codey của người dùng, KHÔNG lọc theo bài đang mở.

    Học viên quay lại tìm "cái hôm qua mình hỏi về two-pointer" chứ không nhớ nó thuộc bài nào —
    nên danh sách trải trên mọi bài, và mỗi dòng phải nói rõ bài của nó.
    """
    return {
        "data": {
            "items": await sessions.listing(
                request.app.state.db,
                claims["sub"],
                agent_id=CODEY.agent_id,
                include=("exerciseId", "exerciseTitle"),
            )
        }
    }


@router.get("/sessions/{thread_id}")
async def read_session(thread_id: str, request: Request, claims: dict = Depends(require_user)):
    found = await sessions.read(
        request.app.state.db, claims["sub"], thread_id, agent_id=CODEY.agent_id
    )
    if not found:
        raise HTTPException(404, "Không tìm thấy hội thoại.")
    return {"data": found}


@router.delete("/sessions/{thread_id}", status_code=204)
async def delete_session(thread_id: str, request: Request, claims: dict = Depends(require_user)):
    if not await sessions.remove(
        request.app.state.db, claims["sub"], thread_id, agent_id=CODEY.agent_id
    ):
        raise HTTPException(404, "Không tìm thấy hội thoại.")
