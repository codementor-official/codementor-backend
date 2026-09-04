import asyncio
import logging
import re
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app import budget
from app.config import Settings
from app.documents import SUPPORTED_TYPES, DocumentStorage, cosine, extract_isolated
from app.models import InternalRequest
from app.provider import OpenAIProvider

logger = logging.getLogger("codementor.ai")
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def now():
    return datetime.now(UTC)


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
    def __init__(self, db, config: Settings, provider: OpenAIProvider, storage: DocumentStorage):
        self.db = db
        self.config = config
        self.provider = provider
        self.storage = storage
        self.indexes = db["ai_document_indexes"]
        self.conversations = db["ai_conversations"]

    def index_id(self, workspace_id, document_id):
        return f"{workspace_id}:{document_id}:{self.config.openai_embedding_model}:v1"

    def status(self):
        return {
            "configured": self.config.configured,
            "embeddingModel": self.config.openai_embedding_model,
            "chatModel": self.config.openai_chat_model,
            "supportedTypes": SUPPORTED_TYPES,
            "maxDocuments": 8,
        }

    async def states(self, request: InternalRequest):
        sources = request.source_dicts
        keys = [self.index_id(request.workspaceId, source["id"]) for source in sources]
        rows = await self.indexes.find({"_id": {"$in": keys}}, {"chunks": 0}).to_list(30)
        result = []
        for source in sources:
            row = next(
                (
                    row
                    for row in rows
                    if row["documentId"] == source["id"]
                    and row["source"]["revision"] == source["revision"]
                ),
                None,
            )
            result.append(
                {
                    "id": source["id"],
                    "state": "unsupported"
                    if source["docType"] not in SUPPORTED_TYPES
                    else row["state"]
                    if row
                    else "not_indexed",
                    "chunkCount": row.get("chunkCount", 0) if row else 0,
                    **({"error": row["error"]} if row and row.get("error") else {}),
                }
            )
        return result

    async def queue_index(self, request: InternalRequest):
        self.provider.require_configured()
        source = request.source_dicts[0]
        if source["docType"] not in SUPPORTED_TYPES:
            raise HTTPException(400, "Dùng PDF có text, DOCX, PPTX, TXT hoặc Markdown.")
        key = self.index_id(request.workspaceId, source["id"])
        previous = await self.indexes.find_one({"_id": key})
        if (
            previous
            and previous["source"]["revision"] == source["revision"]
            and previous["state"] in ("ready", "queued", "processing")
        ):
            return (await self.states(request))[0]
        await self.consume_budget(str(request.userId))
        try:
            await self.indexes.update_one(
                {
                    "_id": key,
                    "$or": [{"state": {"$ne": "processing"}}, {"leaseUntil": {"$lt": now()}}],
                },
                {
                    "$set": {
                        "workspaceId": str(request.workspaceId),
                        "documentId": source["id"],
                        "model": self.config.openai_embedding_model,
                        "source": source,
                        "state": "queued",
                        "chunks": [],
                        "chunkCount": 0,
                        "updatedAt": now(),
                        "leaseUntil": EPOCH,
                        "expiresAt": now() + timedelta(days=30),
                    },
                    "$unset": {"error": "", "leaseId": ""},
                },
                upsert=True,
            )
        except DuplicateKeyError:
            raise HTTPException(409, "Tài liệu đang được xử lý; vui lòng chờ.") from None
        return (await self.states(request))[0]

    async def worker(self):
        while True:
            try:
                if self.config.configured:
                    await self.process_next()
            except asyncio.CancelledError:
                raise
            except Exception:
                # No prompts, source text, storage keys, or credentials in logs.
                logger.warning("Document queue unavailable; retrying on the next poll.")
            await asyncio.sleep(3)

    async def process_next(self):
        lease = str(uuid4())
        job = await self.indexes.find_one_and_update(
            {
                "model": self.config.openai_embedding_model,
                "$or": [
                    {"state": "queued"},
                    {"state": "processing", "leaseUntil": {"$lt": now()}},
                ],
            },
            {
                "$set": {
                    "state": "processing",
                    "leaseId": lease,
                    "leaseUntil": now() + timedelta(minutes=15),
                    "updatedAt": now(),
                }
            },
            sort=[("updatedAt", 1)],
            return_document=ReturnDocument.AFTER,
        )
        if not job:
            return
        lock = {"_id": job["_id"], "leaseId": lease}
        try:
            data = await asyncio.to_thread(self.storage.read, job["workspaceId"], job["source"])
            chunks = await extract_isolated(job["source"]["docType"], data)
            for offset in range(0, len(chunks), 32):
                batch = chunks[offset : offset + 32]
                vectors = await self.provider.embed([chunk["text"] for chunk in batch])
                for chunk, vector in zip(batch, vectors, strict=True):
                    chunk["embedding"] = vector
            await self.indexes.update_one(
                lock,
                {
                    "$set": {
                        "state": "ready",
                        "chunks": chunks,
                        "chunkCount": len(chunks),
                        "updatedAt": now(),
                        "leaseUntil": EPOCH,
                        "expiresAt": now() + timedelta(days=30),
                    },
                    "$unset": {"leaseId": "", "error": ""},
                },
            )
        except asyncio.CancelledError:
            await self.indexes.update_one(
                lock, {"$set": {"state": "queued", "leaseUntil": EPOCH}, "$unset": {"leaseId": ""}}
            )
            raise
        except Exception as exc:
            logger.warning("Document processing failed (%s).", type(exc).__name__)
            message = (
                exc.detail
                if isinstance(exc, HTTPException)
                else (
                    "Xử lý tài liệu quá thời gian."
                    if isinstance(exc, TimeoutError)
                    else "Không xử lý được tài liệu. Kiểm tra định dạng và cấu hình backend."
                )
            )
            await self.indexes.update_one(
                lock,
                {
                    "$set": {
                        "state": "failed",
                        "error": message,
                        "chunks": [],
                        "chunkCount": 0,
                        "updatedAt": now(),
                        "leaseUntil": EPOCH,
                    },
                    "$unset": {"leaseId": ""},
                },
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
        self.provider.require_configured()
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
            keys = [
                self.index_id(request.workspaceId, source["id"]) for source in request.source_dicts
            ]
            indexes = await self.indexes.find({"_id": {"$in": keys}, "state": "ready"}).to_list(8)
            expected = {(source["id"], source["revision"]) for source in request.source_dicts}
            actual = {(index["documentId"], index["source"]["revision"]) for index in indexes}
            if actual != expected:
                raise HTTPException(
                    400, "Tài liệu chưa sẵn sàng. Vui lòng gửi lại để hệ thống tự chuẩn bị."
                )
            await self.consume_budget(str(request.userId))
            previous_questions = [turn["question"] for turn in row["turns"][-3:]]
            vector = (
                await self.provider.embed(["\n".join([*previous_questions[-1:], request.question])])
            )[0]
            matches = sorted(
                (
                    {
                        **chunk,
                        "documentId": index["documentId"],
                        "title": index["source"]["title"],
                        "similarity": cosine(vector, chunk["embedding"]),
                    }
                    for index in indexes
                    for chunk in index["chunks"]
                ),
                key=lambda chunk: chunk["similarity"],
                reverse=True,
            )
            # Short follow-ups can score poorly despite being on topic. Let the model see
            # a bounded fallback from the selected sources, not an automatic empty refusal.
            matches = [chunk for chunk in matches if chunk["similarity"] >= 0.2][:8] or matches[:3]
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
                await self.provider.answer(request.question, evidence, previous_questions)
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

    async def consume_budget(self, user_id: str):
        # Ngân sách sống ở `budget.py` từ khi có bề mặt thứ hai (gợi ý testcase); ở đây
        # chỉ còn tên gọi cũ để phần RAG không phải đổi một dòng nào.
        await budget.consume(self.db, user_id, "rag", self.config.ai_daily_request_limit)
