"""Tài liệu do người dùng tự tải lên, làm nguyên liệu cho chatbot.

Nhỏ có chủ đích: đây chỉ là sổ ghi "ai sở hữu tệp nào ở khoá S3 nào". Việc trích văn bản, cắt
đoạn và embedding nằm ở `DocumentIndex`; việc đọc lại nội dung nằm ở tool của từng agent.

Tách khỏi `ai_document_indexes` vì khoá của bản index mang tên model embedding: gộp làm một thì
đổi model là danh sách tài liệu của người dùng trông như rỗng.
"""

import asyncio
import logging
from datetime import timedelta
from hashlib import sha256
from uuid import uuid4

from fastapi import HTTPException

from app.config import Settings
from app.rag.documents import MAX_FILE_BYTES, SUPPORTED_TYPES, DocumentStorage
from app.rag.index import DocumentIndex, now, storage_prefix

logger = logging.getLogger("codementor.ai")

TTL_DAYS = 30
# Trần danh sách trả về một lượt. `ManagePage` phía giảng viên tự phân trang trên mảng này.
# ponytail: đổi sang cursor khi có người soạn vượt 200 tài liệu.
MAX_ITEMS = 200
MAX_TITLE = 500


def doc_type_of(filename: str) -> str:
    """Loại tài liệu suy từ ĐUÔI TỆP, không từ `contentType` trình duyệt gửi lên.

    Windows gửi `application/octet-stream` cho `.md`, và một client bất kỳ thì gửi gì cũng được.
    Đuôi tệp mới là thứ quyết định trình trích văn bản nào chạy, nên nó phải là nguồn sự thật.
    """
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in SUPPORTED_TYPES:
        raise HTTPException(
            400, f"Chỉ nhận {', '.join(SUPPORTED_TYPES)}. PDF phải có text, bản scan cần OCR trước."
        )
    return extension


def public_document(row: dict, state: dict | None = None) -> dict:
    return {
        "id": row["_id"],
        "title": row["title"],
        "docType": row["docType"],
        "sizeBytes": row["sizeBytes"],
        "createdAt": row["createdAt"],
        "expiresAt": row.get("expiresAt"),
        "state": (state or {}).get("state", "not_indexed"),
        "chunkCount": (state or {}).get("chunkCount", 0),
        **({"error": state["error"]} if state and state.get("error") else {}),
    }


class DocumentLibrary:
    def __init__(self, db, config: Settings, index: DocumentIndex, storage: DocumentStorage):
        self.db = db
        self.config = config
        self.index = index
        self.storage = storage
        self.documents = db["ai_documents"]

    @staticmethod
    def scope_of(user_id: str) -> str:
        return f"lecturer:{user_id}"

    def max_bytes(self) -> int:
        return min(MAX_FILE_BYTES, self.config.document_max_upload_mb * 1024 * 1024)

    # --- tải lên ------------------------------------------------------------

    def presign(self, user_id: str, filename: str, size_bytes: int) -> dict:
        doc_type = doc_type_of(filename)
        limit = self.max_bytes()
        if size_bytes <= 0 or size_bytes > limit:
            raise HTTPException(400, f"Tài liệu tối đa {limit // 1024 // 1024} MB.")
        # Tên tệp gốc KHÔNG được làm khoá: nó do người dùng đặt, có thể chứa `..`, trùng nhau
        # giữa hai người, và làm lộ tên tệp trên máy họ. Chỉ giữ lại phần đuôi.
        key = storage_prefix(self.config, self.scope_of(user_id)) + f"{uuid4()}.{doc_type}"
        return self.storage.presign_put(key, doc_type, size_bytes)

    async def register(self, user_id: str, object_key: str, filename: str) -> dict:
        """Ghi nhận một tệp vừa `PUT` xong, rồi xếp hàng index.

        Hai thứ KHÔNG tin lời client nói:
        - `objectKey` phải nằm dưới nhánh của chính người gọi. Thiếu hàng rào này thì một người
          đăng ký được khoá của người khác rồi đọc nội dung qua tool của agent.
        - kích thước lấy từ `HeadObject`, không lấy từ payload — và đó cũng là cách xác nhận
          tệp đã lên thật.
        """
        scope = self.scope_of(user_id)
        prefix = storage_prefix(self.config, scope)
        if not object_key.startswith(prefix) or ".." in object_key:
            raise HTTPException(403, "Khoá tệp không thuộc phạm vi của bạn.")

        doc_type = doc_type_of(filename)
        # boto3 đồng bộ: `head` và `delete` là lời gọi mạng, để nguyên trong coroutine là
        # chặn cả event loop — cùng lý do `process_next` đã bọc `storage.read`.
        size_bytes = await asyncio.to_thread(self.storage.head, object_key)
        if size_bytes is None:
            raise HTTPException(422, "Chưa thấy tệp trên storage. Tải lên lại rồi thử tiếp.")
        if size_bytes > self.max_bytes():
            await asyncio.to_thread(self.storage.delete, object_key)
            raise HTTPException(400, f"Tài liệu tối đa {self.max_bytes() // 1024 // 1024} MB.")

        title = (filename.rsplit("/", 1)[-1] or "Tài liệu")[:MAX_TITLE]
        row = {
            "_id": str(uuid4()),
            "ownerId": user_id,
            "scope": scope,
            "title": title,
            "docType": doc_type,
            "storageKey": object_key,
            "sizeBytes": int(size_bytes),
            "revision": self.revision(object_key, title, doc_type, int(size_bytes)),
            "createdAt": now(),
            "expiresAt": now() + timedelta(days=TTL_DAYS),
        }
        await self.documents.insert_one(row)
        state = await self.index.queue(scope, self.source_of(row), user_id)
        return public_document(row, state)

    @staticmethod
    def revision(object_key: str, title: str, doc_type: str, size_bytes: int) -> str:
        """Vân tay của tệp. Đổi tệp là đổi vân tay, và bản index cũ tự hết hiệu lực —
        cùng cách `WorkspaceAiService.descriptor` tính cho tài liệu nhóm."""
        return sha256(f"{object_key}|{title}|{doc_type}|{size_bytes}".encode()).hexdigest()

    @staticmethod
    def source_of(row: dict) -> dict:
        """Hình dạng mà `DocumentIndex` hiểu, giống hệt nguồn của nghiệp vụ nhóm học."""
        return {
            "id": row["_id"],
            "title": row["title"],
            "docType": row["docType"],
            "storageKey": row["storageKey"],
            "previewText": None,
            "revision": row["revision"],
        }

    # --- đọc ----------------------------------------------------------------

    async def find(self, user_id: str, document_id: str) -> dict:
        """Hàng của CHÍNH người gọi. Id của người khác trả 404 chứ không 403: 403 là xác nhận
        tài liệu đó tồn tại."""
        row = await self.documents.find_one({"_id": document_id, "ownerId": user_id})
        if not row:
            raise HTTPException(404, "Không tìm thấy tài liệu.")
        return row

    async def list(self, user_id: str) -> list[dict]:
        rows = (
            await self.documents.find({"ownerId": user_id})
            .sort([("createdAt", -1), ("_id", -1)])
            .to_list(MAX_ITEMS)
        )
        if not rows:
            return []
        states = await self.index.states(
            self.scope_of(user_id), [self.source_of(row) for row in rows]
        )
        by_id = {state["id"]: state for state in states}
        return [public_document(row, by_id.get(row["_id"])) for row in rows]

    async def get(self, user_id: str, document_id: str) -> dict:
        row = await self.find(user_id, document_id)
        states = await self.index.states(self.scope_of(user_id), [self.source_of(row)])
        return public_document(row, states[0])

    async def download_url(self, user_id: str, document_id: str) -> dict:
        row = await self.find(user_id, document_id)
        return {
            "url": self.storage.presign_get(row["storageKey"], row["title"], row["docType"]),
            "expiresInSeconds": 900,
        }

    # --- sửa đổi ------------------------------------------------------------

    async def reindex(self, user_id: str, document_id: str) -> dict:
        """Chạy lại tài liệu hỏng mà không phải tải lên lại.

        Xoá bản index trước rồi mới xếp hàng: `queue` bỏ qua khi bản cũ còn `ready`/`queued`
        cùng revision, nên không xoá thì nút này im lặng không làm gì.
        """
        row = await self.find(user_id, document_id)
        scope = self.scope_of(user_id)
        await self.index.drop(scope, document_id)
        state = await self.index.queue(scope, self.source_of(row), user_id)
        return public_document(row, state)

    async def delete(self, user_id: str, document_id: str) -> dict:
        row = await self.find(user_id, document_id)
        await self.documents.delete_one({"_id": document_id, "ownerId": user_id})
        await self.index.drop(self.scope_of(user_id), document_id)
        await asyncio.to_thread(self.storage.delete, row["storageKey"])
        return {"deleted": True}
