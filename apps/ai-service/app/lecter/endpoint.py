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

from app import budget
from app.auth import require_user
from app.config import settings
from app.lecter import sessions
from app.lecter.graph import GRAPH

logger = logging.getLogger("codementor.ai")

router = APIRouter(prefix="/api/v1/ai/lecter")

# Hàng rào chi phí, không phải hàng rào logic: một agent lặp mãi vì tool trả lỗi là chuyện có
# thật, và giới hạn bước là cách rẻ nhất chặn nó. 24 = khoảng 8 lượt gọi model có tool.
RECURSION_LIMIT = 24


@router.post("/run")
async def run(input_data: RunAgentInput, request: Request, claims: dict = Depends(require_user)):
    rag = request.app.state.rag
    rag.provider.require_configured()
    await budget.consume(rag.db, claims["sub"], "lecter", settings.ai_lecter_daily_limit)

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
            },
        },
    )
    encoder = EventEncoder(accept=request.headers.get("accept"))
    thread_id = input_data.thread_id

    async def stream():
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
        await sessions.save(rag.db, claims["sub"], thread_id, GRAPH)

    return StreamingResponse(
        stream(),
        media_type=encoder.get_content_type(),
        # Kong không bật buffering, nhưng một reverse proxy nginx nào đó ở tầng trên thì có;
        # hai header này là cách chuẩn nói với nó rằng đừng gom.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/sessions")
async def list_sessions(request: Request, claims: dict = Depends(require_user)):
    return {"data": {"items": await sessions.listing(request.app.state.rag.db, claims["sub"])}}


@router.get("/sessions/{thread_id}")
async def read_session(thread_id: str, request: Request, claims: dict = Depends(require_user)):
    found = await sessions.read(request.app.state.rag.db, claims["sub"], thread_id)
    if not found:
        raise HTTPException(404, "Không tìm thấy hội thoại.")
    return {"data": found}


@router.delete("/sessions/{thread_id}", status_code=204)
async def delete_session(thread_id: str, request: Request, claims: dict = Depends(require_user)):
    if not await sessions.remove(request.app.state.rag.db, claims["sub"], thread_id):
        raise HTTPException(404, "Không tìm thấy hội thoại.")
