"""Graph của Tutor: một đường cố định, không phải vòng chat↔tools.

    wait ⟲ ─▶ retrieve ─▶ generate ─▶ verify ─▶ END
      └──(tài liệu hỏng / quá lâu)──▶ END, kèm một câu giải thích

Vì sao không để model tự gọi tool tìm kiếm như Lecter: câu trả lời bám tài liệu là lời hứa của
trang này, không phải thứ model có thể quên làm. Tìm luôn chạy, đối chiếu luôn chạy.

Mỗi node kết thúc là một STATE_SNAPSHOT về trình duyệt, nên `step` mô tả việc SẮP làm — đó là
dòng trạng thái người dùng nhìn trong lúc chờ. Không dùng `manually_emit_state` của
ag-ui-langgraph: bản state đặt tay ở đó đè lên mọi snapshot còn lại của lượt chạy.
"""

import asyncio
import json
from datetime import UTC, datetime
from typing import Any, Literal

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

from app.capability import Capability
from app.graph import AgentState, chat_model
from app.lecter import http
from app.lecter.http import ToolCallError
from app.rag.index import MAX_SOURCES
from app.tutor.answer import EXPLAIN, NO_INFORMATION, QUOTES, as_history, ground

# Cùng nhịp với vòng poll cũ ở trình duyệt (`prepare-documents.ts`): 2.5 giây, tối đa 3 phút.
POLL_SECONDS = 2.5
MAX_POLLS = 72
# Số lượt trước đưa lại cho model. Câu hỏi nối tiếp ("còn gì nữa", "giải thích ý 2") cần lượt
# ngay trước; ba lượt là đủ mà không kéo chi phí theo độ dài hội thoại.
HISTORY_TURNS = 3
# Trần đầu ra, như lời gọi JSON cũ.
MAX_OUTPUT_TOKENS = 3000

NOT_READY = "Tài liệu vẫn đang được chuẩn bị. Bạn có thể quay lại gửi câu hỏi sau ít phút."
NOT_READABLE = "Không đọc được tài liệu đã chọn. Hãy kiểm tra tệp trong nhóm."


class TutorState(AgentState, total=False):
    # Tài liệu của LƯỢT NÀY `[{id, title}]`. Endpoint đặt nó sau khi workspace-service đã xác
    # nhận quyền đọc và trạng thái duyệt — không phải bản trình duyệt gửi.
    documents: list[dict]
    # Đoạn văn đã đưa cho model, `[{sourceId, documentId, title, page, excerpt}]`. Trình duyệt
    # vẽ chip nguồn từ đây ngay khi tìm xong, trước khi chữ đầu tiên chảy ra.
    sources: list[dict]
    # `{id tin nhắn người dùng: lượt đã đối chiếu}`. Khoá theo tin nhắn NGƯỜI DÙNG vì id đó do
    # trình duyệt sinh và giữ nguyên qua mọi lần phát lại; id câu trả lời thì do model đặt.
    grounding: dict[str, dict]
    polls: int


def _text(message: BaseMessage) -> str:
    return message.text if isinstance(message.text, str) else str(message.content)


def _last_human(messages: list[BaseMessage]) -> tuple[int, HumanMessage | None]:
    for index in range(len(messages) - 1, -1, -1):
        if isinstance(messages[index], HumanMessage):
            return index, messages[index]
    return -1, None


def history(messages: list[BaseMessage], grounding: dict[str, dict]) -> list[BaseMessage]:
    """Các lượt TRƯỚC câu hỏi hiện tại, bản đã đối chiếu, tối đa `HISTORY_TURNS` lượt.

    Trước đây model chỉ thấy ba câu HỎI cũ, không thấy mình đã trả lời gì — hỏi "giải thích lại
    ý thứ hai" là hỏi về một thứ nó không có.
    """
    turns: list[list[BaseMessage]] = []
    question_id: str | None = None
    for message in messages:
        if isinstance(message, HumanMessage):
            turns.append([HumanMessage(_text(message))])
            question_id = message.id
        elif isinstance(message, AIMessage) and turns and len(turns[-1]) == 1:
            turn = grounding.get(question_id) if question_id else None
            text = as_history(turn) if turn else _text(message)
            if text.strip():
                turns[-1].append(AIMessage(text))
    return [message for turn in turns[-HISTORY_TURNS:] for message in turn]


def build(capability: Capability) -> Any:
    async def wait(state: TutorState, config: RunnableConfig) -> Command[Literal["wait", "retrieve", "__end__"]]:
        """Đợi mọi tài liệu của lượt này index xong. Mỗi vòng là một node, nên mỗi vòng là một
        snapshot — người dùng thấy "1/3 sẵn sàng" nhích dần thay vì một spinner câm."""
        polls = state.get("polls") or 0
        if polls:
            await asyncio.sleep(POLL_SECONDS)
        slug = config["configurable"]["workspace_slug"]
        ids = [document["id"] for document in state.get("documents") or []]
        try:
            states = await http.workspace(
                "POST",
                f"/api/v1/workspaces/{slug}/ai/documents/status",
                config,
                json_body={"documentIds": ids},
            ) or []
        except ToolCallError as exc:
            return _stop(str(exc))
        failed = next(
            (item for item in states if item.get("state") in ("failed", "unsupported")), None
        )
        if failed:
            return _stop(failed.get("error") or NOT_READABLE)
        ready = sum(1 for item in states if item.get("state") == "ready")
        if ready == len(ids) and len(states) == len(ids):
            return Command(goto="retrieve", update={"polls": 0, "step": "Đang tìm đoạn liên quan"})
        if polls >= MAX_POLLS:
            return _stop(NOT_READY)
        return Command(
            goto="wait",
            update={"polls": polls + 1, "step": f"Đang đọc tài liệu · {ready}/{len(ids)} sẵn sàng"},
        )

    async def retrieve(state: TutorState, config: RunnableConfig) -> dict:
        configurable = config["configurable"]
        messages = state["messages"]
        index, question = _last_human(messages)
        previous = _last_human(messages[:index])[1] if index > 0 else None
        # Lượt trước đi kèm câu hỏi: "còn gì nữa" một mình không đủ để tìm ra đoạn nào.
        query = "\n".join(_text(message) for message in (previous, question) if message)
        matches = await configurable["index"].search(
            f"workspace:{configurable['workspace_id']}",
            [{"id": document["id"]} for document in state.get("documents") or []],
            query,
            MAX_SOURCES,
        )
        sources = [
            {
                "sourceId": f"S{i + 1}",
                "documentId": match["documentId"],
                "title": match["title"],
                "page": match["page"],
                "excerpt": match["text"],
            }
            for i, match in enumerate(matches)
        ]
        return {"sources": sources, "step": "Đang soạn câu trả lời"}

    async def generate(state: TutorState, config: RunnableConfig) -> dict:
        sources = state.get("sources") or []
        if not sources:
            # Không có đoạn nào để dựa vào: không tốn một lời gọi model. `verify` viết câu
            # "tài liệu chưa có thông tin", y như nhánh cũ.
            return {"messages": [AIMessage(f"{QUOTES}\n{EXPLAIN}\n")], "step": ""}
        messages = state["messages"]
        index, question = _last_human(messages)
        payload = json.dumps(
            {
                "question": _text(question) if question else "",
                "sources": [
                    {
                        "id": source["sourceId"],
                        "title": source["title"],
                        "page": source["page"],
                        "text": source["excerpt"],
                    }
                    for source in sources
                ],
            },
            ensure_ascii=False,
        )
        model = chat_model(capability, max_tokens=MAX_OUTPUT_TOKENS, verbosity="low", store=False)
        response = await model.ainvoke(
            [
                SystemMessage(capability.instructions),
                *history(messages[:index], state.get("grounding") or {}),
                HumanMessage(payload),
            ],
            config,
        )
        return {"messages": [response], "step": "Đang đối chiếu trích dẫn"}

    async def verify(state: TutorState) -> dict:
        messages = state["messages"]
        _, question = _last_human(messages)
        answer = messages[-1] if messages and isinstance(messages[-1], AIMessage) else None
        sources = state.get("sources") or []
        if sources and answer:
            turn = ground(_text(answer), sources)
        else:
            turn = {
                "answer": NO_INFORMATION,
                "supplementalAnswer": "",
                "insufficientEvidence": True,
                "citations": [],
            }
        turn["createdAt"] = datetime.now(UTC).isoformat()
        grounding = {**(state.get("grounding") or {})}
        if question and question.id:
            grounding[question.id] = turn
        return {"grounding": grounding, "step": ""}

    graph = StateGraph(TutorState)
    graph.add_node("wait", wait, destinations=("wait", "retrieve", "__end__"))
    graph.add_node("retrieve", retrieve)
    graph.add_node("generate", generate)
    graph.add_node("verify", verify)
    graph.add_edge(START, "wait")
    graph.add_edge("retrieve", "generate")
    graph.add_edge("generate", "verify")
    graph.add_edge("verify", END)
    # Cùng lý do với `app/graph.py`: client AG-UI gửi lại toàn bộ `messages` mỗi lượt, và
    # `grounding` thì endpoint nạp lại từ Mongo — checkpoint chỉ cần sống trong một lượt.
    return graph.compile(checkpointer=MemorySaver())


def _stop(reason: str) -> Command:
    """Kết thúc lượt bằng một câu giải thích thay vì RUN_ERROR.

    Câu đó là một tin nhắn thường, không có `grounding`: trình duyệt vẽ nó như lời nhắn hệ
    thống, và câu hỏi của người dùng vẫn ở trong hội thoại để gửi lại.
    """
    return Command(goto=END, update={"messages": [AIMessage(reason)], "step": ""})
