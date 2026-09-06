"""Kiểm tầng index sau khi tách khỏi `RagService`.

Ba thứ được kiểm ở đây đều là thứ mà việc tách có thể làm hỏng âm thầm:

1. Khoá index đổi theo scope và theo model — nhầm chỗ này thì tài liệu của hai người dùng
   chung một bản index, hoặc vector cũ được đem ra dùng sau khi đổi model embedding.
2. Nhánh S3 suy từ scope — đây là hàng rào duy nhất chặn việc đọc tệp của người khác.
3. Xếp hạng của `search` — ngưỡng rồi mới fallback, đúng thứ tự.
"""

import pytest
from fastapi import HTTPException

from app.config import Settings
from app.rag.index import FALLBACK_MATCHES, MIN_SIMILARITY, DocumentIndex, storage_prefix

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

    async def ready_rows(_scope, _sources):
        return rows(similarities)

    subject.ready_rows = ready_rows
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

    async def ready_rows(_scope, _sources):
        return []

    subject.ready_rows = ready_rows
    assert await subject.search(WORKSPACE, [{"id": DOC}], "câu hỏi") == []
