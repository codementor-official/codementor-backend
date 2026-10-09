"""Graph của Tutor: một đường cố định, không phải vòng chat↔tools.

    wait ⟲ ─▶ gate ─▶ retrieve ─▶ rerank ─▶ sufficiency ─▶ generate ─▶ verify ─▶ END
      │         └──(ngoài phạm vi / unsafe)──────────────────────────────▶ verify
      └──(tài liệu hỏng / quá lâu)──▶ END, kèm một câu giải thích

`gate`, `rerank`, `sufficiency` là ba chỗ Jev ra quyết định (`jev_policy.py`). Không có client
Jev — thiếu key, hoặc lời gọi hỏng — thì cả ba thành no-op và graph chạy đúng luồng không Jev:
gate cho qua, rerank giữ thứ tự cosine, sufficiency coi như đủ. Jev phán đoán, code so ngưỡng,
LLM chỉ viết.

Vì sao không để model tự gọi tool tìm kiếm như Lecter: câu trả lời bám tài liệu là lời hứa của
trang này, không phải thứ model có thể quên làm. Tìm luôn chạy, đối chiếu luôn chạy.

Mỗi node kết thúc là một STATE_SNAPSHOT về trình duyệt, nên `step` mô tả việc SẮP làm — đó là
dòng trạng thái người dùng nhìn trong lúc chờ. Không dùng `manually_emit_state` của
ag-ui-langgraph: bản state đặt tay ở đó đè lên mọi snapshot còn lại của lượt chạy.
"""

import asyncio
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
from app.tutor import jev_policy as policy
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
    # Câu trả lời sớm của `gate` (ngoài phạm vi / unsafe). Rỗng = đi tiếp như thường.
    refusal: str
    # `False` khi Jev cho rằng các đoạn chưa đủ trả lời — LLM được báo để trống phần trích dẫn.
    # `None` = không biết (không có Jev): xử lý như luồng không Jev.
    sufficient: bool | None
    # Xác suất Jev của lượt này, cho bộ đánh giá và để soi lỗi. Không lưu xuống Mongo.
    jev: dict


def _jev(config: RunnableConfig):
    return (config.get("configurable") or {}).get("jev")


def _question_pair(messages: list[BaseMessage]) -> tuple[str, str]:
    """(câu hỏi hiện tại, câu hỏi ngay trước) — câu trước để hiểu "còn gì nữa"."""
    index, question = _last_human(messages)
    previous = _last_human(messages[:index])[1] if index > 0 else None
    return (_text(question) if question else ""), (_text(previous) if previous else "")


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


INSUFFICIENT_NOTE = (
    "BẰNG CHỨNG CHƯA ĐỦ: hệ thống đã xác định các đoạn dưới đây không trực tiếp trả lời câu hỏi."
)


def evidence_message(question: str, sources: list[dict], insufficient: bool) -> str:
    """Tin nhắn cuối gửi model: câu hỏi và các đoạn nguồn, dạng VĂN BẢN THƯỜNG.

    Không phải JSON. Bản JSON cũ escape mọi dấu nháy trong tài liệu thành `\\"`, model chép
    nguyên dấu gạch chéo đó vào trích dẫn, và phép đối chiếu chuỗi con loại oan câu chép đúng —
    đo được trên bộ đánh giá: mọi câu hỏi về `"w"`, `"x"`, `0.1 + 0.2` đều thành "tài liệu chưa
    có thông tin". Đoạn nguồn giờ đi nguyên văn, đúng thứ model phải chép lại.
    """
    blocks = [f"CÂU HỎI: {question}"]
    if insufficient:
        blocks.append(INSUFFICIENT_NOTE)
    blocks.append("NGUỒN:")
    for source in sources:
        where = f" — trang/slide {source['page']}" if source.get("page") else ""
        blocks.append(f"[{source['sourceId']}] {source['title']}{where}\n{source['excerpt']}")
    return "\n\n".join(blocks)


def build(capability: Capability) -> Any:
    async def wait(state: TutorState, config: RunnableConfig) -> Command[Literal["wait", "gate", "__end__"]]:
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
            return Command(goto="gate", update={"polls": 0, "step": "Đang tìm đoạn liên quan"})
        if polls >= MAX_POLLS:
            return _stop(NOT_READY)
        return Command(
            goto="wait",
            update={"polls": polls + 1, "step": f"Đang đọc tài liệu · {ready}/{len(ids)} sẵn sàng"},
        )

    async def gate(state: TutorState, config: RunnableConfig) -> Command[Literal["retrieve", "verify"]]:
        """Chặn câu ngoài phạm vi / unsafe TRƯỚC khi tìm và trước khi gọi LLM."""
        jev = _jev(config)
        if not jev:
            return Command(goto="retrieve")
        question, previous = _question_pair(state["messages"])
        titles = [document["title"] for document in state.get("documents") or []]
        answers = await jev.ask(
            "gate",
            {"question": question, "previous_question": previous},
            {"route": policy.guardrail(titles)},
        )
        if not answers:
            return Command(goto="retrieve", update={"jev": {"gate": "error"}})
        probabilities = answers["route"].get("probabilities") or {}
        trace = {"gate": probabilities}
        thresholds = policy.THRESHOLDS
        refusal = ""
        if probabilities.get("unsafe", 0.0) >= thresholds["unsafe_min"]:
            refusal = policy.REFUSE_UNSAFE
        elif (
            answers["route"].get("choice") == "out_of_scope"
            and probabilities.get("in_scope", 0.0) + probabilities.get("chitchat", 0.0)
            < thresholds["in_scope_min"]
        ):
            refusal = policy.REFUSE_OUT_OF_SCOPE
        if refusal:
            # Một tin nhắn để khung chat có câu trả lời; `verify` ghi lượt từ `refusal`.
            return Command(
                goto="verify",
                update={"refusal": refusal, "messages": [AIMessage(refusal)], "jev": trace},
            )
        return Command(goto="retrieve", update={"jev": trace})

    async def retrieve(state: TutorState, config: RunnableConfig) -> dict:
        configurable = config["configurable"]
        question, previous = _question_pair(state["messages"])
        # Lượt trước đi kèm câu hỏi: "còn gì nữa" một mình không đủ để tìm ra đoạn nào.
        query = "\n".join(text for text in (previous, question) if text)
        matches = await configurable["index"].search(
            f"workspace:{configurable['workspace_id']}",
            [{"id": document["id"]} for document in state.get("documents") or []],
            query,
            # Có Jev thì lấy rộng để nó lọc; không thì đúng số đoạn đưa vào prompt như cũ.
            policy.RETRIEVE_K if _jev(config) else MAX_SOURCES,
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

    async def rerank(state: TutorState, config: RunnableConfig) -> dict:
        """Một lời gọi Jev chấm mọi đoạn; giữ đoạn qua ngưỡng, tối đa `MAX_SOURCES`, đánh số lại.

        Không đoạn nào qua ngưỡng thì vẫn giữ `FALLBACK_KEEP` đoạn tốt nhất và gắn cờ chưa đủ bằng
        chứng: LLM cần chúng để viết phần GIẢI THÍCH đúng chủ đề tài liệu, chỉ không được trích.
        """
        jev = _jev(config)
        sources = state.get("sources") or []
        if not jev or not sources:
            return {"sources": sources[:MAX_SOURCES]}
        question, previous = _question_pair(state["messages"])
        answers = await jev.ask(
            "rerank",
            {
                "question": question,
                "previous_question": previous,
                "passages": [
                    {"title": source["title"], "text": source["excerpt"][: policy.PASSAGE_CHARS]}
                    for source in sources
                ],
            },
            policy.relevance(len(sources)),
        )
        trace = {**(state.get("jev") or {})}
        if not answers:
            trace["rerank"] = "error"
            return {"sources": sources[:MAX_SOURCES], "jev": trace}
        scores = [float(answers[f"p{i}"].get("noul", 0.0)) for i in range(len(sources))]
        # Xác suất làm tròn 2 chữ số nên hay hoà: hoà thì giữ thứ tự cosine.
        order = sorted(range(len(sources)), key=lambda i: (-scores[i], i))
        kept = [i for i in order if scores[i] >= policy.THRESHOLDS["relevant_min"]][:MAX_SOURCES]
        update: dict = {}
        if not kept:
            kept = order[: policy.FALLBACK_KEEP]
            update["sufficient"] = False
        trace["rerank"] = [
            {"documentId": sources[i]["documentId"], "page": sources[i]["page"], "p": scores[i]}
            for i in order
        ]
        renumbered = [
            {**sources[i], "sourceId": f"S{n + 1}"} for n, i in enumerate(kept)
        ]
        return {"sources": renumbered, "jev": trace, **update}

    async def sufficiency(state: TutorState, config: RunnableConfig) -> dict:
        jev = _jev(config)
        sources = state.get("sources") or []
        if not jev or not sources or state.get("sufficient") is False:
            return {}
        question, previous = _question_pair(state["messages"])
        answers = await jev.ask(
            "sufficiency",
            {
                "question": question,
                "previous_question": previous,
                "context": [source["excerpt"][: policy.PASSAGE_CHARS] for source in sources],
            },
            {"sufficient": policy.SUFFICIENT},
        )
        trace = {**(state.get("jev") or {})}
        if not answers:
            trace["sufficiency"] = "error"
            return {"jev": trace}
        p = float(answers["sufficient"].get("noul", 0.0))
        trace["sufficiency"] = p
        return {"sufficient": p >= policy.THRESHOLDS["sufficient_min"], "jev": trace}

    async def generate(state: TutorState, config: RunnableConfig) -> dict:
        sources = state.get("sources") or []
        if not sources:
            # Không có đoạn nào để dựa vào: không tốn một lời gọi model. `verify` viết câu
            # "tài liệu chưa có thông tin", y như nhánh cũ.
            return {"messages": [AIMessage(f"{QUOTES}\n{EXPLAIN}\n")], "step": ""}
        messages = state["messages"]
        index, question = _last_human(messages)
        payload = evidence_message(
            _text(question) if question else "", sources, state.get("sufficient") is False
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
        if state.get("refusal"):
            turn = {
                "answer": state["refusal"],
                "supplementalAnswer": "",
                "insufficientEvidence": True,
                "citations": [],
            }
        elif sources and answer:
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
    graph.add_node("wait", wait, destinations=("wait", "gate", "__end__"))
    graph.add_node("gate", gate, destinations=("retrieve", "verify"))
    graph.add_node("retrieve", retrieve)
    graph.add_node("rerank", rerank)
    graph.add_node("sufficiency", sufficiency)
    graph.add_node("generate", generate)
    graph.add_node("verify", verify)
    graph.add_edge(START, "wait")
    graph.add_edge("retrieve", "rerank")
    graph.add_edge("rerank", "sufficiency")
    graph.add_edge("sufficiency", "generate")
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
