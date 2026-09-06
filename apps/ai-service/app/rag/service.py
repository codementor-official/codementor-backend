import logging
import re
from datetime import timedelta
from uuid import uuid4

from fastapi import HTTPException
from pymongo import ReturnDocument

from app.config import Settings
from app.models import InternalRequest
from app.rag.index import EPOCH, MAX_SOURCES, DocumentIndex, now

logger = logging.getLogger("codementor.ai")


def public_conversation(row: dict) -> dict:
    return {
        "id": row["_id"],
        "title": row["title"],
        "documentIds": [source["id"] for source in row["sources"]],
        "documents": [{"id": source["id"], "title": source["title"]} for source in row["sources"]],
        "turns": row["turns"],
        "createdAt": row["createdAt"],
        "updatedAt": row["updatedAt"],
    }


def validate_sources(row: dict, sources: list[dict]):
    previous = {(source["id"], source["revision"]) for source in row["sources"]}
    current = {(source["id"], source["revision"]) for source in sources}
    if previous != current:
        raise HTTPException(
            409,
            "Nguồn tài liệu đã thay đổi hoặc không còn được phép truy cập. Hãy tạo hội thoại mới.",
        )


def grounded_turn(request: InternalRequest, result: dict, matches: list[dict]) -> dict:
    evidence = {f"S{i + 1}": chunk for i, chunk in enumerate(matches)}
    # A valid source ID alone cannot prove an AI-generated claim. Only display
    # literal excerpts in the source-backed section; teaching is kept separate.
    verified = []
    for item in result.get("sourceQuotes", []):
        source = evidence.get(item["sourceId"])
        quote = " ".join(item["quote"].split())
        if source and quote and quote in " ".join(source["text"].split()):
            if item not in verified:
                verified.append(item)
    insufficient = result["insufficientEvidence"] or not verified
    ids = list(dict.fromkeys(item["sourceId"] for item in verified))
    # Source-backed claims and general teaching must never masquerade as each other.
    supplemental = result.get("supplementalAnswer", "").strip()
    if re.search(r"\[S\d+\]", supplemental):
        supplemental = ""
    answer = (
        "\n\n".join(
            "> " + item["quote"].replace("\n", "\n> ") + f" [{item['sourceId']}]"
            for item in verified
        )
        if not insufficient
        else (
            "Tài liệu chưa giải thích trực tiếp nội dung này. Phần dưới là kiến thức mở rộng của AI."
            if supplemental
            else "Tài liệu chưa có thông tin phù hợp cho câu hỏi này. Bạn có thể bổ sung nguồn hoặc hỏi về chủ đề của tài liệu."
        )
    )
    return {
        "id": str(request.requestId),
        "question": request.question,
        "answer": answer,
        "supplementalAnswer": supplemental,
        "insufficientEvidence": insufficient,
        "citations": []
        if insufficient
        else [
            {
                "sourceId": source_id,
                "documentId": evidence[source_id]["documentId"],
                "title": evidence[source_id]["title"],
                "page": evidence[source_id]["page"],
                "excerpt": evidence[source_id]["text"],
            }
            for source_id in ids
        ],
        "createdAt": now().isoformat(),
    }


class RagService:
    """Hỏi đáp tài liệu của nhóm học: hội thoại nhiều lượt, câu trả lời có trích dẫn.

    Dựng TRÊN `DocumentIndex` chứ không sở hữu nó — phần xếp hàng, worker và tìm kiếm là hạ
    tầng dùng chung, còn `ai_conversations` và `grounded_turn` chỉ nghiệp vụ này cần.

    Phạm vi ở đây luôn là `workspace:{id}`; `scope` của Mongo (`{userId, workspaceId}`) là bộ
    lọc hội thoại, khác với `scope` chuỗi của tầng index.
    """

    def __init__(self, db, config: Settings, index: DocumentIndex):
        self.db = db
        self.config = config
        self.index = index
        self.conversations = db["ai_conversations"]

    @staticmethod
    def index_scope(request: InternalRequest) -> str:
        return f"workspace:{request.workspaceId}"

    def status(self):
        return self.index.status()

    async def states(self, request: InternalRequest):
        return await self.index.states(self.index_scope(request), request.source_dicts)

    async def queue_index(self, request: InternalRequest):
        return await self.index.queue(
            self.index_scope(request), request.source_dicts[0], str(request.userId)
        )

    async def create(self, request: InternalRequest):
        row = {
            "_id": str(uuid4()),
            **request.scope,
            "title": "Hỏi đáp tài liệu",
            # Conversation ownership/revision only; do not retain copies of storage secrets/text.
            "sources": [
                {k: source[k] for k in ("id", "title", "revision")}
                for source in request.source_dicts
            ],
            "turns": [],
            "createdAt": now(),
            "updatedAt": now(),
            "leaseUntil": EPOCH,
        }
        await self.conversations.insert_one(row)
        return public_conversation(row)

    async def list(self, request: InternalRequest):
        rows = (
            await self.conversations.find(request.scope, {"turns": 0})
            .sort([("updatedAt", -1), ("_id", -1)])
            .skip((request.page - 1) * request.limit)
            .limit(request.limit)
            .to_list(request.limit)
        )
        total = await self.conversations.count_documents(request.scope)
        return {
            "items": [
                {
                    "id": row["_id"],
                    "title": row["title"],
                    "documentIds": [source["id"] for source in row["sources"]],
                    "updatedAt": row["updatedAt"],
                }
                for row in rows
            ],
            "page": request.page,
            "limit": request.limit,
            "total": total,
            "totalPages": (total + request.limit - 1) // request.limit,
        }

    async def find_conversation(self, request: InternalRequest):
        row = await self.conversations.find_one({"_id": str(request.id), **request.scope})
        if not row:
            raise HTTPException(404, "Không tìm thấy hội thoại.")
        return row

    async def read(self, request: InternalRequest):
        row = await self.find_conversation(request)
        validate_sources(row, request.source_dicts)
        return public_conversation(row)

    async def metadata(self, request: InternalRequest):
        row = await self.find_conversation(request)
        return {"documentIds": [source["id"] for source in row["sources"]]}

    async def delete(self, request: InternalRequest):
        await self.find_conversation(request)
        await self.conversations.delete_one({"_id": str(request.id), **request.scope})
        return {"deleted": True}

    async def ask(self, request: InternalRequest):
        self.index.provider.require_configured()
        row = await self.find_conversation(request)
        validate_sources(row, request.source_dicts)
        previous = next(
            (turn for turn in row["turns"] if turn["id"] == str(request.requestId)), None
        )
        if previous:
            return self.replay(previous, request)
        lease = str(uuid4())
        lock = {"_id": str(request.id), **request.scope, "leaseId": lease}
        row = await self.conversations.find_one_and_update(
            {"_id": str(request.id), **request.scope, "leaseUntil": {"$lt": now()}},
            {"$set": {"leaseId": lease, "leaseUntil": now() + timedelta(minutes=5)}},
            return_document=ReturnDocument.AFTER,
        )
        if not row:
            raise HTTPException(409, "Trợ lý đang trả lời trong hội thoại này. Vui lòng chờ.")
        try:
            previous = next(
                (turn for turn in row["turns"] if turn["id"] == str(request.requestId)), None
            )
            if previous:
                return self.replay(previous, request)
            if len(row["turns"]) >= 50:
                raise HTTPException(400, "Hội thoại đã đủ 50 lượt. Hãy tạo hội thoại mới.")
            scope = self.index_scope(request)
            # Kiểm ĐỦ và ĐÚNG BẢN trước khi tiêu hạn mức: `search` chỉ trả về những gì sẵn
            # sàng, nên thiếu một nguồn ở đó là im lặng trả lời bằng tài liệu còn lại.
            indexes = await self.index.ready_rows(scope, request.source_dicts)
            expected = {(source["id"], source["revision"]) for source in request.source_dicts}
            actual = {(index["documentId"], index["source"]["revision"]) for index in indexes}
            if actual != expected:
                raise HTTPException(
                    400, "Tài liệu chưa sẵn sàng. Vui lòng gửi lại để hệ thống tự chuẩn bị."
                )
            await self.index.consume_budget(str(request.userId))
            previous_questions = [turn["question"] for turn in row["turns"][-3:]]
            # Lượt trước đi kèm câu hỏi: "còn gì nữa" một mình không đủ để tìm ra đoạn nào.
            matches = await self.index.search(
                scope,
                request.source_dicts,
                "\n".join([*previous_questions[-1:], request.question]),
                MAX_SOURCES,
            )
            evidence = [
                {
                    "id": f"S{i + 1}",
                    "title": chunk["title"],
                    "text": chunk["text"],
                    "page": chunk["page"],
                }
                for i, chunk in enumerate(matches)
            ]
            result = (
                await self.index.provider.answer(
                    request.question, evidence, previous_questions
                )
                if evidence
                else {
                    "sourceQuotes": [],
                    "supplementalAnswer": "",
                    "insufficientEvidence": True,
                }
            )
            turn = grounded_turn(request, result, matches)
            saved = await self.conversations.update_one(
                lock,
                {
                    "$push": {"turns": turn},
                    "$set": {
                        "title": row["title"] if row["turns"] else request.question[:100],
                        "updatedAt": now(),
                    },
                },
            )
            if not saved.matched_count:
                raise HTTPException(409, "Hội thoại đã bị xóa hoặc phiên trả lời hết hạn.")
            return turn
        finally:
            await self.conversations.update_one(
                lock, {"$set": {"leaseUntil": EPOCH}, "$unset": {"leaseId": ""}}
            )

    @staticmethod
    def replay(turn: dict, request: InternalRequest):
        if turn["question"] != request.question:
            raise HTTPException(409, "Mã yêu cầu đã dùng cho câu hỏi khác.")
        return turn
