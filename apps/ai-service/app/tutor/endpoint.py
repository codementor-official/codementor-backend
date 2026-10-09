"""Bề mặt HTTP của Tutor: một route AG-UI dạng SSE và ba route lịch sử, cùng hình dạng Lecter
nhóm học.

Trước đây Tutor đi Kong → workspace-service → `/api/v1/internal/workspace-ai/ask` và trả về MỘT
khối JSON khi đã viết xong. Giờ nó đi đúng đường của Codey/Lecter: trình duyệt → tầng Node
CopilotKit → route này, JWT Keycloak của chính người dùng, và `stream_run` chung.

Cổng chạy TRƯỚC khi mở stream, nên mọi lỗi ở đây là mã HTTP thật (400/403/404) và không mất lượt
nào: tài liệu chưa duyệt, không có quyền đọc, tài liệu hỏng. Sau khi stream mở thì lỗi chỉ còn là
RUN_ERROR, thứ trình duyệt khó nói cho người dùng hơn nhiều.
"""

from uuid import UUID

from ag_ui.core.types import RunAgentInput
from fastapi import APIRouter, Depends, HTTPException, Request

from app import sessions
from app.agent_stream import stream_run
from app.auth import require_user
from app.lecter import http
from app.lecter.http import ToolCallError
from app.rag.index import MAX_SOURCES
from app.tutor.capability import TUTOR

router = APIRouter(prefix="/api/v1/ai/tutor")

# Trần cũ của `ai_conversations`: 50 lượt rồi mở hội thoại mới.
MAX_TURNS = 50
TITLE_CHARS = 500
# Trường state mà hội thoại mang theo khi mở lại.
PERSISTED = ("grounding", "documents")


def _documents(state: object) -> list[dict]:
    """Tài liệu của lượt này, từ state trình duyệt gửi — mới chỉ là LỜI ĐỀ NGHỊ.

    Đây chỉ kiểm hình dạng. Quyền đọc và trạng thái duyệt do workspace-service quyết ở `_prepare`;
    `title` chỉ để hiện lại lựa chọn khi mở hội thoại cũ, không đi vào ngữ cảnh model.
    """
    raw = state.get("documents") if isinstance(state, dict) else None
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_SOURCES:
        raise HTTPException(400, f"Chọn từ 1 đến {MAX_SOURCES} tài liệu làm nguồn trả lời.")
    documents: list[dict] = []
    for item in raw:
        document_id = str(item.get("id", "")) if isinstance(item, dict) else ""
        try:
            UUID(document_id)
        except ValueError:
            raise HTTPException(400, "Tài liệu đã chọn không hợp lệ.") from None
        if any(document["id"] == document_id for document in documents):
            raise HTTPException(400, "Chọn từ 1 đến 8 tài liệu khác nhau.")
        title = "".join(char for char in str(item.get("title") or "") if char.isprintable())
        documents.append({"id": document_id, "title": title[:TITLE_CHARS].strip() or "Tài liệu"})
    return documents


def _config(request: Request) -> dict:
    return {"configurable": {"auth_token": request.state.access_token}}


async def _workspace_id(slug: str, request: Request) -> str:
    """`workspaceId` của nhóm, hỏi workspace-service bằng token của chính người dùng — người
    không phải thành viên nhận 403/404 ở đây."""
    try:
        detail = await http.workspace("GET", f"/api/v1/workspaces/{slug}", _config(request))
    except ToolCallError as exc:
        if exc.status == 404:
            raise HTTPException(404, "Không tìm thấy nhóm học tập.") from None
        raise HTTPException(exc.status or 503, str(exc)) from None
    workspace_id = (detail or {}).get("id")
    if not workspace_id:
        raise HTTPException(404, "Không tìm thấy nhóm học tập.")
    return workspace_id


async def _prepare(slug: str, document_ids: list[str], request: Request) -> None:
    """Xếp hàng index và kiểm quyền đọc, trước khi tiêu lượt hỏi.

    `documents/prepare` của workspace-service là chỗ DUY NHẤT biết tài liệu đã được duyệt chưa
    và người hỏi có quyền `view_doc` không. Tài liệu hỏng thì dừng ở đây với đúng câu lỗi của nó;
    tài liệu đang xếp hàng thì để node `wait` của graph đợi, có báo tiến độ.
    """
    try:
        states = await http.workspace(
            "POST",
            f"/api/v1/workspaces/{slug}/ai/documents/prepare",
            _config(request),
            json_body={"documentIds": document_ids},
        ) or []
    except ToolCallError as exc:
        if exc.status == 404:
            raise HTTPException(404, "Tài liệu không tồn tại hoặc chưa được duyệt.") from None
        if exc.status == 403:
            raise HTTPException(403, "Bạn không có quyền đọc tài liệu trong nhóm này.") from None
        raise HTTPException(exc.status or 503, str(exc)) from None
    failed = next(
        (item for item in states if item.get("state") in ("failed", "unsupported")), None
    )
    if failed:
        raise HTTPException(
            400,
            failed.get("error") or "Không đọc được tài liệu đã chọn. Hãy kiểm tra tệp trong nhóm.",
        )


@router.post("/workspace/{slug}/run")
async def run(
    slug: str,
    input_data: RunAgentInput,
    request: Request,
    claims: dict = Depends(require_user),
):
    documents = _documents(input_data.state)
    if sum(1 for message in input_data.messages if message.role == "user") > MAX_TURNS:
        raise HTTPException(400, "Hội thoại đã đủ 50 lượt. Hãy tạo hội thoại mới.")
    workspace_id = await _workspace_id(slug, request)
    await _prepare(slug, [document["id"] for document in documents], request)
    stored = await sessions.read(
        request.app.state.db,
        claims["sub"],
        input_data.thread_id,
        agent_id=TUTOR.agent_id,
        workspace_id=workspace_id,
        include=("grounding",),
    )
    # State do SERVER dựng, không lấy của trình duyệt: `grounding` là thứ quyết định câu nào
    # được hiện là "từ tài liệu", nên nó chỉ được đến từ Mongo — nơi chỉ `verify` ghi vào.
    state = {
        "documents": documents,
        "grounding": (stored or {}).get("grounding") or {},
        "sources": [],
        "polls": 0,
        "refusal": "",
        "sufficient": None,
        "jev": {},
        "step": "Đang chuẩn bị tài liệu",
    }
    return await stream_run(
        input_data.model_copy(update={"state": state}),
        request,
        claims,
        TUTOR,
        # `workspace_id` đến từ cổng phía trên, KHÔNG từ trình duyệt: nó dựng chuỗi scope
        # `workspace:<id>` mà node `retrieve` dùng để đọc index.
        # `jev` có thể là `None` (chưa cấu hình): graph tự rơi về luồng không có Jev.
        {"workspace_slug": slug, "workspace_id": workspace_id, "jev": request.app.state.jev},
        workspace_id=workspace_id,
        persist_state=PERSISTED,
    )


@router.get("/workspace/{slug}/sessions")
async def list_sessions(slug: str, request: Request, claims: dict = Depends(require_user)):
    workspace_id = await _workspace_id(slug, request)
    return {
        "data": {
            "items": await sessions.listing(
                request.app.state.db,
                claims["sub"],
                agent_id=TUTOR.agent_id,
                workspace_id=workspace_id,
            )
        }
    }


@router.get("/workspace/{slug}/sessions/{thread_id}")
async def read_session(
    slug: str, thread_id: str, request: Request, claims: dict = Depends(require_user)
):
    workspace_id = await _workspace_id(slug, request)
    found = await sessions.read(
        request.app.state.db,
        claims["sub"],
        thread_id,
        agent_id=TUTOR.agent_id,
        workspace_id=workspace_id,
        include=PERSISTED,
    )
    if not found:
        raise HTTPException(404, "Không tìm thấy hội thoại.")
    return {"data": found}


@router.delete("/workspace/{slug}/sessions/{thread_id}", status_code=204)
async def delete_session(
    slug: str, thread_id: str, request: Request, claims: dict = Depends(require_user)
):
    workspace_id = await _workspace_id(slug, request)
    if not await sessions.remove(
        request.app.state.db,
        claims["sub"],
        thread_id,
        agent_id=TUTOR.agent_id,
        workspace_id=workspace_id,
    ):
        raise HTTPException(404, "Không tìm thấy hội thoại.")
