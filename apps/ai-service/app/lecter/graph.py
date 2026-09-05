"""Graph của Lecter: một node hội thoại, một node chạy tool phía server.

Vòng lặp verify (soạn -> chạy thử -> sửa -> chạy lại) KHÔNG cần cạnh điều kiện riêng: `run_solution`
là một server tool, model đọc kết quả fail rồi tự gọi lại. Hàng rào chi phí là `recursion_limit`
truyền từ endpoint, không phải một node đếm lượt.

Checkpointer là `MemorySaver` có chủ đích. HITL ở đây kết thúc lượt (model gọi tool của trình
duyệt -> graph về `__end__` -> trình duyệt thi hành rồi mở lượt mới), và client AG-UI gửi lại toàn
bộ mảng `messages` mỗi run, nên state bền vững là thừa. Đổi sang `AsyncMongoDBSaver` khi có run nền
dùng `interrupt()` thật, sống qua việc đóng tab.
"""

from typing import Annotated, Any, Literal

from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph.types import Command
from typing_extensions import TypedDict

from app.config import settings
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


async def chat(state: LecterState, config: RunnableConfig) -> Command[Literal["tools", "__end__"]]:
    frontend = _frontend_names(state)
    model = ChatOpenAI(
        model=settings.smart_model,
        api_key=settings.openai_api_key.get_secret_value(),
        timeout=settings.ai_request_timeout_ms / 1000,
        max_retries=0,
        output_version="responses/v1",
    ).bind_tools([*SERVER_TOOLS, *(state.get("tools") or [])])

    response = await model.ainvoke([SystemMessage(INSTRUCTIONS), *state["messages"]], config)
    calls = getattr(response, "tool_calls", None) or []

    # Tool của trình duyệt: kết thúc lượt. Trình duyệt hiện hộp xác nhận, thi hành bằng token
    # của chính người dùng, rồi gửi kết quả vào lượt kế tiếp.
    if calls and any(call["name"] in frontend for call in calls):
        return Command(goto="__end__", update={"messages": response, "step": "awaiting_user"})

    if calls:
        return Command(goto="tools", update={"messages": response, "step": calls[0]["name"]})
    return Command(goto="__end__", update={"messages": response, "step": "done"})


def build() -> Any:
    workflow = StateGraph(LecterState)
    workflow.add_node("chat", chat)
    workflow.add_node("tools", ToolNode(SERVER_TOOLS))
    workflow.add_edge("tools", "chat")
    workflow.set_entry_point("chat")
    return workflow.compile(checkpointer=MemorySaver())


GRAPH = build()
