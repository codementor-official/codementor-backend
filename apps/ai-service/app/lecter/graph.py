"""Graph của Lecter: một node hội thoại, một node chạy tool phía server.

Vòng lặp verify (soạn -> chạy thử -> sửa -> chạy lại) KHÔNG cần cạnh điều kiện riêng: `run_solution`
là một server tool, model đọc kết quả fail rồi tự gọi lại. Hàng rào chi phí là `recursion_limit`
truyền từ endpoint, không phải một node đếm lượt.

Checkpointer là `MemorySaver` có chủ đích. HITL ở đây kết thúc lượt (model gọi tool của trình
duyệt -> graph về `__end__` -> trình duyệt thi hành rồi mở lượt mới), và client AG-UI gửi lại toàn
bộ mảng `messages` mỗi run, nên state bền vững là thừa. Đổi sang `AsyncMongoDBSaver` khi có run nền
dùng `interrupt()` thật, sống qua việc đóng tab.
"""

import json
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
from app.lecter.tools import NUDGE_ON_REPEAT, SERVER_TOOLS


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


def _tool_name(tool: Any) -> str | None:
    return tool.get("name") if isinstance(tool, dict) else getattr(tool, "name", None)


def frontend_tools(state: LecterState) -> list[Any]:
    """Tool do trình duyệt khai, đã loại những cái trùng tên với tool server.

    Lọc ở MỘT chỗ rồi dùng cho cả định tuyến lẫn `bind_tools`. Trước đây chỉ định tuyến mới lọc,
    nên tính chất bảo mật thì giữ được — tool server luôn thắng — nhưng danh sách gửi lên OpenAI
    vẫn có hai mục cùng tên, và OpenAI từ chối cả yêu cầu. Một trang khai nhầm tên `run_solution`
    không chiếm được quyền nhưng làm chết hẳn cả run.
    """
    return [
        tool
        for tool in (state.get("tools") or [])
        if (name := _tool_name(tool)) and name not in _SERVER_TOOL_NAMES
    ]


def _frontend_names(state: LecterState) -> set[str]:
    """Tên tool do trình duyệt khai. Tên trùng với tool server thì tool server thắng —
    nếu không, một trang bị chèn mã có thể chiếm chỗ `run_solution` và bịa kết quả chạy thử."""
    return {name for tool in frontend_tools(state) if (name := _tool_name(tool))}


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


SKIPPED_CALL = (
    "Chưa chạy: lượt dừng ở đây để giảng viên xác nhận đề xuất. Cần kết quả này thì gọi lại ở "
    "lượt sau."
)


def unrun_tool_results(calls: list[dict], frontend: set[str]) -> list[ToolMessage]:
    """`ToolMessage` cho những tool server bị gọi kèm một tool trình duyệt.

    Model có thể gọi cả hai loại trong cùng một message. Tool trình duyệt kết thúc lượt, nên tool
    server trong đó không bao giờ chạy — và một `tool_call` không có `ToolMessage` sẽ bị
    `drop_dangling_tool_calls` coi là treo ở lượt sau, rồi nó bỏ CẢ MESSAGE. Kèm theo là lời gọi
    tool trình duyệt và kết quả `{"outcome": "applied", "lessons": [...]}` của nó: mất bằng chứng
    giảng viên đã bấm đồng ý, mất luôn danh sách `lessonId` vừa sinh ra — thứ
    `save_lesson_contents` không có đường nào khác để biết. `_since_last_write` cũng không còn
    thấy lệnh ghi nào để reset bộ nhớ nhắc-lặp.
    """
    return [
        ToolMessage(tool_call_id=call["id"], content=SKIPPED_CALL)
        for call in calls
        if call["name"] not in frontend
    ]


REPEATED_CALL = (
    "Bạn vừa gọi `{name}` với ĐÚNG tham số của một lần gọi trước, nên kết quả cũng y hệt và "
    "không có gì mới để đọc. Đọc lại kết quả lần trước, SỬA tham số theo đúng thứ nó chỉ ra, "
    "rồi mới gọi lại — hoặc chuyển sang bước kế tiếp."
)


def _call_key(call: dict) -> str:
    return call["name"] + "\x00" + json.dumps(
        call.get("args") or {}, sort_keys=True, ensure_ascii=False
    )


def _since_last_write(history: list[BaseMessage], frontend: set[str]) -> list[BaseMessage]:
    """Phần lịch sử tính từ sau lệnh ghi gần nhất.

    Mọi tool của trình duyệt đều là lệnh ghi, nên sau nó dữ liệu đã khác: một lời gọi giống hệt
    trước đó KHÔNG còn là lặp thừa. Không cắt ở đây thì `validate_curriculum` sau `save_curriculum`
    bị coi là lặp, đúng lúc nó cần chạy nhất.
    """
    cut = 0
    for index, message in enumerate(history):
        if isinstance(message, AIMessage) and any(
            call["name"] in frontend for call in (message.tool_calls or [])
        ):
            cut = index + 1
    return history[cut:]


def repeated_calls(
    history: list[BaseMessage], calls: list[dict], frontend: set[str] | None = None
) -> list[ToolMessage]:
    """`ToolMessage` nhắc việc cho những lời gọi lặp lại y hệt, hoặc rỗng nếu cứ để chạy.

    Chuyện đã xảy ra: `validate_exercise_content` bị gọi bốn lần, ba lần cuối với payload giống
    nhau từng byte, nhận về đúng một câu trả lời, rồi model bỏ cuộc. Tốn ba lượt gọi model, một
    phần hạn mức ngày của giảng viên, và kết thúc bằng một bài nháp rỗng.

    Chỉ nhắc MỘT lần cho mỗi tool trong một hội thoại: lần nhắc thứ hai sẽ thành vòng lặp mới
    giữa `chat` và chính nó, và bật `recursion_limit` — tệ hơn hiện trạng. Nhắc rồi mà vẫn lặp
    thì cứ cho chạy, tốn một lời gọi tool nhưng không làm hỏng lượt.

    Hai hàng rào quanh việc nhắc, cả hai đều do một bug thật: câu nhắc từng bắn ra cho
    `read_course` và nói "kết quả cũng y hệt" trong khi cây vừa bị `save_curriculum` sửa. Model
    tin câu đó và báo với giảng viên là nó không đọc lại được khóa học.
      1. Chỉ nhắc tool trong `NUDGE_ON_REPEAT` — tool đọc không bao giờ bị nhắc.
      2. Chỉ soi phần lịch sử SAU lệnh ghi gần nhất.
    """
    if any(call["name"] not in NUDGE_ON_REPEAT for call in calls):
        return []

    recent = _since_last_write(history, frontend or set())
    answered = {
        message.tool_call_id
        for message in recent
        if isinstance(message, ToolMessage) and message.tool_call_id
    }
    seen = {
        _call_key(call)
        for message in recent
        if isinstance(message, AIMessage)
        for call in (message.tool_calls or [])
        if call["id"] in answered
    }
    nudged = {
        message.content for message in recent if isinstance(message, ToolMessage)
    }
    nudges: list[ToolMessage] = []
    for call in calls:
        text = REPEATED_CALL.format(name=call["name"])
        # Còn một lời gọi mới, hoặc đã nhắc rồi → không can thiệp.
        if _call_key(call) not in seen or text in nudged:
            return []
        nudges.append(ToolMessage(tool_call_id=call["id"], content=text))
    return nudges


async def chat(
    state: LecterState, config: RunnableConfig
) -> Command[Literal["chat", "tools", "__end__"]]:
    frontend = _frontend_names(state)
    model = ChatOpenAI(
        model=settings.smart_model,
        api_key=settings.openai_api_key.get_secret_value(),
        timeout=settings.ai_request_timeout_ms / 1000,
        # Một mã 429 hay 500 lẻ của OpenAI là lỗi tạm thời. Để 0 thì nó giết cả run, trong
        # khi suất hạn mức ngày đã bị trừ trước lúc stream mở — giảng viên mất lượt vì lỗi
        # của nhà cung cấp, và câu họ nhận được là "đã dùng hết lượt AI hôm nay".
        max_retries=2,
        output_version="responses/v1",
    ).bind_tools([*SERVER_TOOLS, *frontend_tools(state)])

    history = drop_dangling_tool_calls(list(state["messages"]))
    response = await model.ainvoke([SystemMessage(INSTRUCTIONS), *history], config)
    calls = getattr(response, "tool_calls", None) or []

    # Tool của trình duyệt: kết thúc lượt. Trình duyệt hiện hộp xác nhận, thi hành bằng token
    # của chính người dùng, rồi gửi kết quả vào lượt kế tiếp.
    if calls and any(call["name"] in frontend for call in calls):
        # Model có thể gọi kèm tool server trong cùng một message. Chúng sẽ KHÔNG chạy vì lượt
        # dừng ở đây, nên phải tự trả lời cho chúng: một `tool_call` không có `ToolMessage` sẽ
        # bị `drop_dangling_tool_calls` coi là treo ở lượt sau, và nó bỏ CẢ MESSAGE — kéo theo
        # lời gọi tool trình duyệt cùng kết quả `{"outcome": "applied", "lessons": [...]}`.
        # Mất bằng chứng giảng viên đã bấm đồng ý, mất luôn danh sách `lessonId` vừa sinh ra.
        return Command(
            goto="__end__",
            update={
                "messages": [response, *unrun_tool_results(calls, frontend)],
                "step": "awaiting_user",
            },
        )

    if calls:
        # Chỉ soi tool server. Tool của trình duyệt đề xuất lại y hệt sau khi người soạn bấm
        # "Bỏ qua" là chuyện hợp lệ — họ có thể vừa bảo "thử lại đi".
        nudges = repeated_calls(history, calls, frontend)
        if nudges:
            logger.info("Lecter gọi lặp `%s`, nhắc thay vì chạy lại", calls[0]["name"])
            return Command(
                goto="chat",
                update={"messages": [response, *nudges], "step": calls[0]["name"]},
            )
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
