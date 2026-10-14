"""Kiểm tầng index sau khi tách khỏi `RagService`.

Ba thứ được kiểm ở đây đều là thứ mà việc tách có thể làm hỏng âm thầm:

1. Khoá index đổi theo scope và theo model — nhầm chỗ này thì tài liệu của hai người dùng
   chung một bản index, hoặc vector cũ được đem ra dùng sau khi đổi model embedding.
2. Nhánh S3 suy từ scope — đây là hàng rào duy nhất chặn việc đọc tệp của người khác.
3. Xếp hạng của `search` — ngưỡng rồi mới fallback, đúng thứ tự.
"""

import asyncio

import pytest
from fastapi import HTTPException

from app.config import Settings
from app.rag.index import (
    EMBED_BATCH,
    EMBED_PARALLEL,
    FALLBACK_MATCHES,
    INDEX_WORKERS,
    MIN_SIMILARITY,
    DocumentIndex,
    prepare_chunks,
    same_content,
    storage_prefix,
)

WORKSPACE = "workspace:11111111-1111-4111-8111-111111111111"
LECTURER = "lecturer:22222222-2222-4222-8222-222222222222"
DOC = "33333333-3333-4333-8333-333333333333"


def config(**overrides) -> Settings:
    return Settings(
        aws_s3_document_prefix="public/workspace-documents",
        aws_s3_ai_upload_prefix="private/ai-uploads",
        **overrides,
    )


def index(settings: Settings | None = None) -> DocumentIndex:
    # `db` chỉ dùng cho collection; các ca dưới đây không chạm Mongo.
    return DocumentIndex({"ai_document_indexes": None}, settings or config(), None, None)


# --- khoá index -------------------------------------------------------------


def test_index_id_separates_scopes():
    subject = index()
    assert subject.index_id(WORKSPACE, DOC) != subject.index_id(LECTURER, DOC)


def test_index_id_carries_embedding_model():
    a = index(config(openai_embedding_model="text-embedding-3-small"))
    b = index(config(openai_embedding_model="text-embedding-3-large"))
    assert a.index_id(WORKSPACE, DOC) != b.index_id(WORKSPACE, DOC)


def test_index_id_is_v2():
    """Hàng `:v1` mang `workspaceId` chứ không mang `scope`; khoá phải khác để bỏ qua chúng."""
    assert index().index_id(WORKSPACE, DOC).endswith(":v2")


# --- nhánh S3 ---------------------------------------------------------------


def test_prefix_per_scope_kind():
    settings = config()
    assert storage_prefix(settings, WORKSPACE) == (
        "public/workspace-documents/workspaces/11111111-1111-4111-8111-111111111111/"
    )
    assert storage_prefix(settings, LECTURER) == (
        "private/ai-uploads/lecturer/22222222-2222-4222-8222-222222222222/"
    )


def test_lecturer_files_are_not_under_the_public_branch():
    """Tài liệu riêng của giảng viên không được nằm dưới nhánh đọc công khai."""
    assert not storage_prefix(config(), LECTURER).startswith("public/")


@pytest.mark.parametrize("scope", ["", "lecturer", "lecturer:", "nobody:abc", "abc"])
def test_unknown_scope_is_refused(scope):
    with pytest.raises(HTTPException):
        storage_prefix(config(), scope)


# --- xếp hạng ---------------------------------------------------------------


class FakeProvider:
    async def embed(self, texts):
        return [[1.0, 0.0] for _ in texts]


def rows(similarities: list[float]) -> list[dict]:
    """Một bản index giả, mỗi đoạn có cosine với [1, 0] đúng bằng giá trị mong muốn."""
    return [
        {
            "documentId": DOC,
            "source": {"title": "Tài liệu"},
            "chunks": [
                {"text": f"đoạn {i}", "page": i + 1, "embedding": [value, (1 - value**2) ** 0.5]}
                for i, value in enumerate(similarities)
            ],
        }
    ]


async def search(similarities: list[float], limit: int = 8):
    subject = index()
    subject.provider = FakeProvider()

    async def ready_chunks(_scope, _sources):
        return [{**row, "chunks": prepare_chunks(row["chunks"])} for row in rows(similarities)]

    subject.ready_chunks = ready_chunks
    return await subject.search(WORKSPACE, [{"id": DOC}], "câu hỏi", limit)


async def test_search_sorts_by_similarity_descending():
    found = await search([0.3, 0.9, 0.6])
    assert [chunk["text"] for chunk in found] == ["đoạn 1", "đoạn 2", "đoạn 0"]


async def test_search_drops_chunks_below_threshold():
    found = await search([0.9, MIN_SIMILARITY - 0.05])
    assert [chunk["text"] for chunk in found] == ["đoạn 0"]


async def test_search_falls_back_when_everything_scores_low():
    """Câu hỏi ngắn ăn theo lượt trước chấm thấp dù đúng chủ đề — trả rỗng là từ chối oan."""
    found = await search([0.1, 0.05, 0.02, 0.01])
    assert len(found) == FALLBACK_MATCHES


async def test_search_respects_limit():
    assert len(await search([0.9, 0.8, 0.7, 0.6], limit=2)) == 2


async def test_search_without_ready_index_returns_nothing():
    subject = index()

    async def ready_chunks(_scope, _sources):
        return []

    subject.ready_chunks = ready_chunks
    assert await subject.search(WORKSPACE, [{"id": DOC}], "câu hỏi") == []


class QueueIndex(DocumentIndex):
    """`process_next` giả: rút từ một danh sách job, ghi lại job nào chạy song song."""

    def __init__(self, jobs: int):
        super().__init__({"ai_document_indexes": None}, config(openai_api_key="sk-test"), None, None)
        self.jobs, self.running, self.peak, self.done = jobs, 0, 0, 0

    async def process_next(self) -> bool:
        if not self.jobs:
            return False
        self.jobs -= 1
        self.running += 1
        self.peak = max(self.peak, self.running)
        await asyncio.sleep(0.05)
        self.running -= 1
        self.done += 1
        return True


async def run_worker(index: DocumentIndex, until, seconds: float = 1.0):
    task = asyncio.create_task(index.worker())
    try:
        async with asyncio.timeout(seconds):
            while not until():
                await asyncio.sleep(0.01)
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_worker_drains_the_queue_in_parallel_without_polling():
    # 6 job × 50 ms: nối tiếp + ngủ 3 s giữa các job là ~15 s; giờ phải xong trong 1 s.
    queued = QueueIndex(jobs=6)
    await run_worker(queued, lambda: queued.done == 6)
    assert queued.peak == INDEX_WORKERS


async def test_queue_wakes_an_idle_worker():
    queued = QueueIndex(jobs=0)
    task = asyncio.create_task(queued.worker())
    try:
        await asyncio.sleep(0.05)  # mọi vòng đều đã rảnh, đang chờ tới nhịp poll 3 s
        queued.jobs = 1
        queued._wake.set()
        async with asyncio.timeout(0.5):
            while queued.done < 1:
                await asyncio.sleep(0.01)
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_embed_chunks_keeps_order_and_caps_parallel_calls():
    class Provider:
        running = peak = 0

        async def embed(self, texts):
            self.running += 1
            self.peak = max(self.peak, self.running)
            await asyncio.sleep(0.01)
            self.running -= 1
            return [[float(text)] for text in texts]

    provider = Provider()
    target = DocumentIndex({"ai_document_indexes": None}, config(), provider, None)
    chunks = [{"text": str(i)} for i in range(EMBED_BATCH * EMBED_PARALLEL * 2 + 3)]
    await target.embed_chunks(chunks)
    assert [chunk["embedding"] for chunk in chunks] == [[float(i)] for i in range(len(chunks))]
    assert provider.peak == EMBED_PARALLEL


def test_same_content_ignores_title_but_not_the_file():
    source = {"title": "A", "docType": "pdf", "storageKey": "k1", "previewText": None}
    assert same_content(source, {**source, "title": "B", "revision": "r2"})
    assert not same_content(source, {**source, "storageKey": "k2"})
    assert not same_content(
        {**source, "docType": "md", "storageKey": None, "previewText": "x"},
        {**source, "docType": "md", "storageKey": None, "previewText": "y"},
    )


async def test_wait_finished_wakes_on_a_finished_job_not_on_the_poll():
    queued = QueueIndex(jobs=0)
    task = asyncio.create_task(queued.worker())
    try:
        seen = queued.finished
        queued.jobs = 1
        queued._wake.set()
        async with asyncio.timeout(0.5):  # nhịp poll là 3 s: tỉnh trước đó nghĩa là được báo
            await queued.wait_finished(seen, 3)
        assert queued.finished == seen + 1
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


class FakeIndexes:
    """Đủ cho `queue()`: chưa có bản index nào, ghi gì cũng nhận."""

    async def find_one(self, *_args, **_kwargs):
        return None

    async def update_one(self, *_args, **_kwargs):
        return None


async def test_workspace_indexing_does_not_spend_quota_but_uploads_do(monkeypatch):
    from app.models import InternalRequest
    from app.rag.service import RagService

    charged = []

    async def consume(_db, user_id, key, _limit):
        charged.append((user_id, key))

    monkeypatch.setattr("app.rag.index.budget.consume", consume)
    target = DocumentIndex(
        {"ai_document_indexes": FakeIndexes()}, config(openai_api_key="sk-test"), Provider(), None
    )

    async def states(_scope, sources):
        return [{"id": source["id"], "state": "queued"} for source in sources]

    target.states = states
    source = {"id": DOC, "title": "A", "docType": "pdf", "storageKey": "k", "previewText": None,
              "revision": "a" * 64}
    user = "44444444-4444-4444-8444-444444444444"
    request = InternalRequest(userId=user, workspaceId=WORKSPACE.split(":")[1], sources=[source])

    await RagService(None, target.config, target).queue_index(request)
    assert charged == []
    await target.queue(LECTURER, source, user)
    assert charged == [(user, "rag")]


class Provider:
    def require_configured(self):
        pass
