"""Graph của Lecter: một node hội thoại, một node chạy tool phía server.

Vòng lặp verify (soạn -> chạy thử -> sửa -> chạy lại) KHÔNG cần cạnh điều kiện riêng: `run_solution`
là một server tool, model đọc kết quả fail rồi tự gọi lại. Hàng rào chi phí là `recursion_limit`
truyền từ endpoint, không phải một node đếm lượt.

Checkpointer là `MemorySaver` có chủ đích. HITL ở đây kết thúc lượt (model gọi tool của trình
duyệt -> graph về `__end__` -> trình duyệt thi hành rồi mở lượt mới), và client AG-UI gửi lại toàn
bộ mảng `messages` mỗi run, nên state bền vững là thừa. Đổi sang `AsyncMongoDBSaver` khi có run nền
dùng `interrupt()` thật, sống qua việc đóng tab.
"""

import logging
from typing import Annotated, Any, Literal

from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph.types import Command
from typing_extensions import TypedDict

from app.config import settings
from app.lecter.http import ToolCallError
from app.lecter.prompt import INSTRUCTIONS
from app.lecter.tools import SERVER_TOOLS


class LecterState(TypedDict, total=False):
    messages: Annotated[list, add_messages]
    # ag-ui-langgraph nhét tool do trình duyệt khai báo vào đây (dạng JSON schema dict),
    # tool của input thắng khi trùng tên với tool còn sót trong state.
    tools: list[dict[str, Any]]
    # Chảy ngược về UI bằng STATE_DELTA — đây là "trạng thái chatbot" người dùng nhìn thấy
    # thay cho một cái spinner quay.
    step: str


logger = logging.getLogger("codementor.ai")

_SERVER_TOOL_NAMES = frozenset(tool.name for tool in SERVER_TOOLS)


def _frontend_names(state: LecterState) -> set[str]:
    """Tên tool do trình duyệt khai. Tên trùng với tool server thì tool server thắng —
    nếu không, một trang bị chèn mã có thể chiếm chỗ `run_solution` và bịa kết quả chạy thử."""
    names = set()
    for tool in state.get("tools") or []:
        name = tool.get("name") if isinstance(tool, dict) else getattr(tool, "name", None)
        if name and name not in _SERVER_TOOL_NAMES:
            names.add(name)
    return names


def drop_dangling_tool_calls(messages: list[BaseMessage]) -> list[BaseMessage]:
    """Bỏ những lời gọi tool không bao giờ có kết quả.

    OpenAI từ chối cả yêu cầu khi lịch sử có `tool_call` mà thiếu output tương ứng
    ("No tool output found for function call ..."), nên MỘT lượt hỏng giữa chừng sẽ làm hội thoại
    đó chết vĩnh viễn — mở lại, gõ gì cũng lỗi. Hai đường sinh ra nó: run đứt giữa chừng (mạng,
    tiến trình chết), và tool của trình duyệt mà người dùng đóng tab trước khi bấm gì.

    An toàn ở đây vì `chat` chỉ chạy lúc bắt đầu hoặc SAU node `tools` — lúc đó mọi lời gọi đã
    thi hành xong đều đã có `ToolMessage` đi kèm.
    """
    answered = {
        message.tool_call_id
        for message in messages
        if isinstance(message, ToolMessage) and message.tool_call_id
    }
    kept: list[BaseMessage] = []
    dropped: set[str] = set()
    for message in messages:
        calls = getattr(message, "tool_calls", None) if isinstance(message, AIMessage) else None
        if calls:
            missing = [call["id"] for call in calls if call["id"] not in answered]
            if missing:
                # Bỏ TẤT CẢ id của message này, không chỉ những cái treo: một message có thể
                # mang nhiều lời gọi song song, và giữ lại `ToolMessage` của cái đã trả lời sẽ
                # thành message mồ côi — OpenAI từ chối cái đó y như từ chối lời gọi treo.
                dropped.update(call["id"] for call in calls)
                logger.info("Bỏ %d lời gọi tool treo khỏi lịch sử", len(missing))
                continue
        if isinstance(message, ToolMessage) and message.tool_call_id in dropped:
            continue
        kept.append(message)
    return kept


async def chat(state: LecterState, config: RunnableConfig) -> Command[Literal["tools", "__end__"]]:
    frontend = _frontend_names(state)
    model = ChatOpenAI(
        model=settings.smart_model,
        api_key=settings.openai_api_key.get_secret_value(),
        timeout=settings.ai_request_timeout_ms / 1000,
        max_retries=0,
        output_version="responses/v1",
    ).bind_tools([*SERVER_TOOLS, *(state.get("tools") or [])])

    history = drop_dangling_tool_calls(list(state["messages"]))
    response = await model.ainvoke([SystemMessage(INSTRUCTIONS), *history], config)
    calls = getattr(response, "tool_calls", None) or []

    # Tool của trình duyệt: kết thúc lượt. Trình duyệt hiện hộp xác nhận, thi hành bằng token
    # của chính người dùng, rồi gửi kết quả vào lượt kế tiếp.
    if calls and any(call["name"] in frontend for call in calls):
        return Command(goto="__end__", update={"messages": response, "step": "awaiting_user"})

    if calls:
        return Command(goto="tools", update={"messages": response, "step": calls[0]["name"]})
    return Command(goto="__end__", update={"messages": response, "step": "done"})


def tool_error(exc: Exception) -> str:
    """Biến lỗi tool thành một câu model đọc được, thay vì để nó giết cả lượt.

    `ToolNode` của LangGraph mặc định NÉM LẠI mọi lỗi (`_default_handle_tool_errors`), nên một bài
    không tồn tại hay judge tạm hỏng sẽ làm sập cả run: trình duyệt treo ở dòng tool đang chạy,
    không có câu trả lời, không có lỗi. Trả về chuỗi thì model đọc được, nói lại cho giảng viên,
    và đi tiếp.
    """
    if isinstance(exc, ToolCallError):
        return f"Tool thất bại: {exc}"
    # Lỗi ngoài dự tính: không đưa chi tiết vào lịch sử hội thoại (nó có thể kèm URL, payload).
    logger.exception("Lecter tool lỗi ngoài dự tính")
    return "Tool gặp lỗi hệ thống. Hãy nói với giảng viên và thử hướng khác."


def build() -> Any:
    workflow = StateGraph(LecterState)
    workflow.add_node("chat", chat)
    workflow.add_node("tools", ToolNode(SERVER_TOOLS, handle_tool_errors=tool_error))
    workflow.add_edge("tools", "chat")
    workflow.set_entry_point("chat")
    return workflow.compile(checkpointer=MemorySaver())


GRAPH = build()
