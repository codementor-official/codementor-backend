"""Hàng đợi index tài liệu và tìm kiếm theo ngữ nghĩa — dùng chung cho mọi chatbot.

Tầng này KHÔNG biết nghiệp vụ nào đang gọi. Chủ sở hữu một tài liệu chỉ là một chuỗi `scope`
dạng `"<kind>:<id>"` (`workspace:{uuid}`, `lecturer:{sub}`), và mọi thứ khác — khoá index, bộ
lọc Mongo, nhánh S3 được phép đọc — suy ra từ đúng chuỗi đó.

Trước khi tách, cả ba thứ trên bị `workspaceId` khoá cứng trong `RagService`, nên bề mặt thứ hai
(tài liệu của giảng viên cho Lecter) không có đường nào dùng lại hàng đợi này ngoài việc chép
nguyên một vòng lặp worker thứ hai.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app import budget
from app.config import Settings
from app.provider import OpenAIProvider
from app.rag.documents import SUPPORTED_TYPES, DocumentStorage, cosine, extract_isolated, tokenizer

logger = logging.getLogger("codementor.ai")
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)

# Trần số tài liệu một lượt tìm. Cùng con số với `sources` tối đa của một hội thoại.
MAX_SOURCES = 8
# Dưới ngưỡng này thì đoạn coi như không liên quan. Câu hỏi ngắn kiểu "còn gì nữa" chấm rất
# thấp dù đúng chủ đề, nên vẫn có fallback top-3 thay vì từ chối thẳng.
MIN_SIMILARITY = 0.2
FALLBACK_MATCHES = 3


def now() -> datetime:
    return datetime.now(UTC)


def storage_prefix(config: Settings, scope: str) -> str:
    """Nhánh S3 mà `scope` này được phép đọc, luôn kết thúc bằng `/`.

    Đây là chỗ DUY NHẤT ánh xạ chủ thể sang đường dẫn. Worker chỉ đọc được `scope` từ hàng
    trong Mongo — nó không có request, không có token — nên prefix bắt buộc phải suy ra được
    từ chính chuỗi đó, không thể truyền vào lúc xếp hàng rồi hy vọng còn nguyên lúc chạy.
    """
    kind, _, key = scope.partition(":")
    if not key:
        raise HTTPException(500, "Phạm vi tài liệu không hợp lệ.")
    if kind == "workspace":
        root = config.aws_s3_document_prefix.strip("/")
        folder = "workspaces"
    elif kind == "lecturer":
        root = config.aws_s3_ai_upload_prefix.strip("/")
        folder = "lecturer"
    else:
        raise HTTPException(500, "Phạm vi tài liệu không hợp lệ.")
    return "/".join(filter(None, [root, folder, key])) + "/"


class DocumentIndex:
    """Vòng đời một tài liệu: xếp hàng -> trích -> cắt đoạn -> embed -> tìm lại được."""

    def __init__(self, db, config: Settings, provider: OpenAIProvider, storage: DocumentStorage):
        self.db = db
        self.config = config
        self.provider = provider
        self.storage = storage
        self.indexes = db["ai_document_indexes"]

    def index_id(self, scope: str, document_id: str) -> str:
        """Khoá của một bản index.

        Mang cả tên model embedding: đổi model là mọi vector cũ vô nghĩa, và một khoá mới khiến
        chúng bị bỏ qua rồi hết hạn theo TTL thay vì phải viết migration.

        `v2` (trước là `v1`) đánh dấu lần đổi `workspaceId` -> `scope`. Cùng cơ chế: hàng cũ
        không bao giờ khớp khoá mới, TTL 30 ngày dọn nốt, và không có bước backfill nào — đây là
        cache, dựng lại được từ S3.
        """
        return f"{scope}:{document_id}:{self.config.openai_embedding_model}:v2"

    def status(self) -> dict:
        return {
            "configured": self.config.configured,
            "embeddingModel": self.config.openai_embedding_model,
            "chatModel": self.config.openai_chat_model,
            "supportedTypes": SUPPORTED_TYPES,
            "maxDocuments": MAX_SOURCES,
        }

    async def consume_budget(self, user_id: str) -> None:
        await budget.consume(self.db, user_id, "rag", self.config.ai_daily_request_limit)

    # --- trạng thái & hàng đợi ---------------------------------------------

    async def states(self, scope: str, sources: list[dict]) -> list[dict]:
        keys = [self.index_id(scope, source["id"]) for source in sources]
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

    async def queue(self, scope: str, source: dict, user_id: str) -> dict:
        self.provider.require_configured()
        if source["docType"] not in SUPPORTED_TYPES:
            raise HTTPException(400, "Dùng PDF có text, DOCX, PPTX, TXT hoặc Markdown.")
        key = self.index_id(scope, source["id"])
        previous = await self.indexes.find_one({"_id": key})
        if (
            previous
            and previous["source"]["revision"] == source["revision"]
            and previous["state"] in ("ready", "queued", "processing")
        ):
            return (await self.states(scope, [source]))[0]
        await self.consume_budget(user_id)
        try:
            await self.indexes.update_one(
                {
                    "_id": key,
                    "$or": [{"state": {"$ne": "processing"}}, {"leaseUntil": {"$lt": now()}}],
                },
                {
                    "$set": {
                        "scope": scope,
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
        return (await self.states(scope, [source]))[0]

    async def drop(self, scope: str, document_id: str) -> None:
        """Bỏ bản index của một tài liệu. Gọi khi tài liệu bị xoá, hoặc trước khi index lại."""
        await self.indexes.delete_one({"_id": self.index_id(scope, document_id)})

    # --- worker -------------------------------------------------------------

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
            prefix = storage_prefix(self.config, job["scope"])
            data = await asyncio.to_thread(self.storage.read, prefix, job["source"])
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

    # --- đọc lại ------------------------------------------------------------

    async def ready_rows(self, scope: str, sources: list[dict]) -> list[dict]:
        """Bản index đã sẵn sàng của đúng những nguồn này, kèm `chunks`.

        Trả về ÍT hơn số nguồn được hỏi là chuyện bình thường (đang xếp hàng, hoặc hỏng); nơi
        gọi tự quyết định đó là lỗi hay chỉ là chờ.
        """
        keys = [self.index_id(scope, source["id"]) for source in sources]
        return await self.indexes.find({"_id": {"$in": keys}, "state": "ready"}).to_list(
            MAX_SOURCES
        )

    async def search(self, scope: str, sources: list[dict], query: str, limit: int = MAX_SOURCES):
        """Đoạn văn gần nghĩa nhất với `query`, xếp giảm dần.

        Ngưỡng rồi mới fallback, không phải ngược lại: câu hỏi ngắn ăn theo lượt trước chấm thấp
        dù đúng chủ đề, và trả rỗng ở đó nghĩa là model từ chối một câu nó trả lời được.
        """
        indexes = await self.ready_rows(scope, sources)
        if not indexes:
            return []
        vector = (await self.provider.embed([query]))[0]
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
        relevant = [chunk for chunk in matches if chunk["similarity"] >= MIN_SIMILARITY][:limit]
        return relevant or matches[:FALLBACK_MATCHES]

    async def full_text(self, scope: str, source: dict) -> dict | None:
        """Toàn văn đã ghép, kèm số token. `None` = chưa index xong.

        Đếm token bằng chính tokenizer đã dùng lúc cắt đoạn, nên con số nơi gọi đem đi so với
        trần là con số thật chứ không phải ước lượng theo số ký tự.
        """
        rows = await self.ready_rows(scope, [source])
        if not rows:
            return None
        chunks = rows[0].get("chunks") or []
        text = "\n\n".join(chunk["text"] for chunk in chunks)
        pages = [chunk["page"] for chunk in chunks if chunk.get("page")]
        return {
            "text": text,
            "tokens": len(tokenizer().encode(text, disallowed_special=())),
            "chunkCount": len(chunks),
            "pageCount": max(pages) if pages else None,
            "chunks": chunks,
        }
