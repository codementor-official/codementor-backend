"""Một lượt chạy agent, phát ra dạng SSE theo giao thức AG-UI.

Thân chung của mọi bề mặt: Lecter giảng viên, Lecter nhóm học, Codey. Nằm ở gốc `app/` vì cả ba
đều gọi nó — trước đây nó là một hàm private trong `lecter/endpoint.py`, và bề mặt thứ hai ngoài
Lecter sẽ phải nhập một hàm gạch dưới xuyên feature để dùng lại.

Không dùng `ag_ui_langgraph.add_langgraph_fastapi_endpoint`: nó gắn route KHÔNG có xác thực. Thân
hàm dưới đây chính là thân của nó, cộng hạn mức ngày và token của người dùng nhét vào `config`
để tool forward đi.

Token đi qua `config`, KHÔNG qua state: state được phát ngược về trình duyệt bằng
STATE_SNAPSHOT/STATE_DELTA.
"""

import logging

from ag_ui.core.events import EventType, RunErrorEvent
from ag_ui.core.types import RunAgentInput
from ag_ui.encoder import EventEncoder
from ag_ui_langgraph import LangGraphAgent
from fastapi import Request
from fastapi.responses import StreamingResponse

from app import budget, sessions
from app.capability import Capability
from app.graph import graph_for

logger = logging.getLogger("codementor.ai")


async def stream_run(
    input_data: RunAgentInput,
    request: Request,
    claims: dict,
    capability: Capability,
    extra_config: dict,
    workspace_id: str | None = None,
    session_extra: dict | None = None,
) -> StreamingResponse:
    """Thân chung của MỌI bề mặt agent. Khác nhau đúng một `Capability` và vài khoá config."""
    state = request.app.state
    state.provider.require_configured()
    await budget.consume(
        state.db,
        claims["sub"],
        capability.budget_key,
        capability.daily_limit,
        message=capability.budget_message,
    )

    graph = graph_for(capability)
    agent = LangGraphAgent(
        name=capability.agent_id,
        graph=graph,
        # Tắt RAW: mặc định `LangGraphAgent` mirror MỌI sự kiện LangChain ra SSE, và
        # `on_chat_model_start` mang theo NGUYÊN system prompt cùng khối reasoning đã mã hoá —
        # tức là gửi prompt của mình về trình duyệt, kèm vài KB mỗi token. Client AG-UI không
        # dùng RAW cho việc gì; TEXT_MESSAGE_* và TOOL_CALL_* là đủ.
        emit_raw_events=False,
        config={
            "recursion_limit": capability.recursion_limit,
            "configurable": {
                "auth_token": request.state.access_token,
                "user_id": claims["sub"],
                # Tool tài liệu đọc thẳng Mongo/S3 chứ không qua HTTP, nên nó cần chính đối
                # tượng của tiến trình. Đi qua `config`, KHÔNG qua state: state được phát
                # ngược về trình duyệt bằng STATE_SNAPSHOT.
                "index": request.app.state.index,
                "write_tool": capability.write_tool,
                **extra_config,
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
            await sessions.save(
                state.db,
                claims["sub"],
                thread_id,
                graph,
                agent_id=capability.agent_id,
                workspace_id=workspace_id,
                extra=session_extra,
            )

    return StreamingResponse(
        stream(),
        media_type=encoder.get_content_type(),
        # Kong không bật buffering, nhưng một reverse proxy nginx nào đó ở tầng trên thì có;
        # hai header này là cách chuẩn nói với nó rằng đừng gom.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
