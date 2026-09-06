"""Kiểm sổ tài liệu người dùng tự tải lên.

Trọng tâm là hai hàng rào, vì hỏng cái nào cũng là rò nội dung chứ không phải bất tiện:

1. Khoá S3 khi đăng ký phải nằm dưới nhánh của CHÍNH người gọi.
2. Đọc một tài liệu luôn lọc theo `ownerId`, và id của người khác trả 404 chứ không 403.

Cộng thêm một thứ hay bị coi nhẹ: loại tài liệu suy từ ĐUÔI TỆP, không từ `contentType`.
"""

import pytest
from fastapi import HTTPException

from app.config import Settings
from app.rag.library import DocumentLibrary, doc_type_of

ALICE = "alice-sub"
BOB = "bob-sub"
DOC = "44444444-4444-4444-8444-444444444444"


class FakeStorage:
    def __init__(self, size: int | None = 1024):
        self.size = size
        self.deleted: list[str] = []

    def head(self, _key):
        return self.size

    def delete(self, key):
        self.deleted.append(key)


class FakeIndex:
    def __init__(self):
        self.queued: list[tuple[str, str]] = []
        self.dropped: list[tuple[str, str]] = []

    async def queue(self, scope, source, _user_id):
        self.queued.append((scope, source["id"]))
        return {"id": source["id"], "state": "queued", "chunkCount": 0}

    async def drop(self, scope, document_id):
        self.dropped.append((scope, document_id))

    async def states(self, _scope, sources):
        return [{"id": s["id"], "state": "ready", "chunkCount": 3} for s in sources]


class FakeCollection:
    def __init__(self):
        self.rows: list[dict] = []

    async def insert_one(self, row):
        self.rows.append(row)

    async def find_one(self, query):
        return next(
            (row for row in self.rows if all(row.get(k) == v for k, v in query.items())), None
        )

    def find(self, query):
        rows = [row for row in self.rows if all(row.get(k) == v for k, v in query.items())]

        class Cursor:
            def sort(self, _spec):
                return self

            async def to_list(self, limit):
                return rows[:limit]

        return Cursor()

    async def delete_one(self, query):
        keep = [row for row in self.rows if not all(row.get(k) == v for k, v in query.items())]
        removed = len(self.rows) - len(keep)
        self.rows = keep
        return removed


def build(storage: FakeStorage | None = None):
    settings = Settings(
        aws_s3_ai_upload_prefix="private/ai-uploads",
        aws_s3_bucket="bucket",
        document_max_upload_mb=20,
    )
    library = DocumentLibrary.__new__(DocumentLibrary)
    library.db = None
    library.config = settings
    library.index = FakeIndex()
    library.storage = storage or FakeStorage()
    library.documents = FakeCollection()
    return library


# --- loại tài liệu ----------------------------------------------------------


@pytest.mark.parametrize("filename", ["de-cuong.PDF", "slide.pptx", "ghi-chu.md"])
def test_doc_type_from_extension(filename):
    assert doc_type_of(filename) == filename.rsplit(".", 1)[-1].lower()


@pytest.mark.parametrize("filename", ["anh.png", "bang.xlsx", "khong-duoi", "script.sh"])
def test_unsupported_extension_refused(filename):
    with pytest.raises(HTTPException) as error:
        doc_type_of(filename)
    assert error.value.status_code == 400


# --- presign ----------------------------------------------------------------


def test_presign_key_lands_under_the_caller_branch():
    library = build()
    captured = {}

    def presign_put(key, doc_type, size_bytes):
        captured.update(key=key, doc_type=doc_type, size_bytes=size_bytes)
        return {"objectKey": key}

    library.storage.presign_put = presign_put
    library.presign(ALICE, "de-cuong.pdf", 2048)
    assert captured["key"].startswith(f"private/ai-uploads/lecturer/{ALICE}/")
    assert captured["key"].endswith(".pdf")
    # Tên tệp gốc không được dùng làm khoá — nó lộ tên trên máy người dùng và có thể chứa `..`.
    assert "de-cuong" not in captured["key"]
    assert captured["size_bytes"] == 2048


@pytest.mark.parametrize("size", [0, -1, 21 * 1024 * 1024])
def test_presign_refuses_bad_size(size):
    with pytest.raises(HTTPException):
        build().presign(ALICE, "a.pdf", size)


# --- đăng ký ----------------------------------------------------------------


async def test_register_refuses_a_key_from_another_user():
    """Hàng rào quan trọng nhất: đăng ký khoá của người khác rồi đọc nội dung qua tool agent."""
    library = build()
    with pytest.raises(HTTPException) as error:
        await library.register(ALICE, f"private/ai-uploads/lecturer/{BOB}/x.pdf", "x.pdf")
    assert error.value.status_code == 403


async def test_register_refuses_path_traversal():
    library = build()
    with pytest.raises(HTTPException) as error:
        await library.register(
            ALICE, f"private/ai-uploads/lecturer/{ALICE}/../{BOB}/x.pdf", "x.pdf"
        )
    assert error.value.status_code == 403


async def test_register_refuses_a_missing_object():
    """Tin lời client là tạo ra một tài liệu trỏ tới khoá rỗng."""
    library = build(FakeStorage(size=None))
    with pytest.raises(HTTPException) as error:
        await library.register(ALICE, f"private/ai-uploads/lecturer/{ALICE}/x.pdf", "x.pdf")
    assert error.value.status_code == 422


async def test_register_uses_the_real_size_and_deletes_an_oversized_upload():
    library = build(FakeStorage(size=25 * 1024 * 1024))
    key = f"private/ai-uploads/lecturer/{ALICE}/x.pdf"
    with pytest.raises(HTTPException):
        await library.register(ALICE, key, "x.pdf")
    assert library.storage.deleted == [key]


async def test_register_queues_the_index():
    library = build()
    key = f"private/ai-uploads/lecturer/{ALICE}/x.pdf"
    created = await library.register(ALICE, key, "de cuong.pdf")
    assert created["title"] == "de cuong.pdf"
    assert created["docType"] == "pdf"
    assert created["state"] == "queued"
    assert library.index.queued == [(f"lecturer:{ALICE}", created["id"])]


async def test_revision_changes_with_the_file():
    a = DocumentLibrary.revision("k", "t", "pdf", 10)
    assert a != DocumentLibrary.revision("k", "t", "pdf", 11)
    assert a != DocumentLibrary.revision("k2", "t", "pdf", 10)
    assert a == DocumentLibrary.revision("k", "t", "pdf", 10)


# --- đọc và xoá -------------------------------------------------------------


async def seeded():
    library = build()
    created = await library.register(
        ALICE, f"private/ai-uploads/lecturer/{ALICE}/x.pdf", "x.pdf"
    )
    return library, created["id"]


async def test_another_user_gets_404_not_403():
    """403 là xác nhận tài liệu tồn tại; 404 thì không nói gì cả."""
    library, document_id = await seeded()
    with pytest.raises(HTTPException) as error:
        await library.find(BOB, document_id)
    assert error.value.status_code == 404


async def test_list_only_returns_own_documents():
    library, _ = await seeded()
    assert len(await library.list(ALICE)) == 1
    assert await library.list(BOB) == []


async def test_reindex_drops_the_stale_index_first():
    """`queue` bỏ qua khi bản cũ còn `ready` cùng revision — không xoá thì nút này im lặng."""
    library, document_id = await seeded()
    library.index.queued.clear()
    await library.reindex(ALICE, document_id)
    assert library.index.dropped == [(f"lecturer:{ALICE}", document_id)]
    assert library.index.queued == [(f"lecturer:{ALICE}", document_id)]


async def test_delete_removes_row_index_and_object():
    library, document_id = await seeded()
    await library.delete(ALICE, document_id)
    assert await library.list(ALICE) == []
    assert library.index.dropped == [(f"lecturer:{ALICE}", document_id)]
    assert library.storage.deleted == [f"private/ai-uploads/lecturer/{ALICE}/x.pdf"]
