"""Kiểm hai tool tài liệu của Lecter.

Ca quan trọng nhất là `test_long_document_returns_an_outline_not_a_slice`: trả về một phần văn
bản bị cắt ngang thì nó trông y hệt tài liệu đầy đủ, và model sẽ soạn nội dung thiếu mà không ai
biết. Mục lục thì tự nói ra rằng nó không phải nội dung.
"""

import pytest
from fastapi import HTTPException

from app.lecter.tools import FULL_TEXT_TOKENS, read_document, search_document

USER = "lecturer-sub"
DOC = "55555555-5555-4555-8555-555555555555"

ROW = {
    "_id": DOC,
    "title": "Đề cương Java",
    "docType": "pdf",
    "storageKey": "private/ai-uploads/lecturer/x/a.pdf",
    "revision": "a" * 64,
}


class FakeLibrary:
    def __init__(self, row: dict | None = ROW):
        self.row = row

    async def find(self, user_id, document_id):
        if self.row is None or user_id != USER or document_id != DOC:
            raise HTTPException(404, "Không tìm thấy tài liệu.")
        return self.row

    @staticmethod
    def scope_of(user_id):
        return f"lecturer:{user_id}"

    @staticmethod
    def source_of(row):
        return {"id": row["_id"], "title": row["title"], "revision": row["revision"]}


class FakeIndex:
    def __init__(self, full=None, state="ready", matches=None):
        self.full = full
        self.state = state
        self.matches = matches or []
        self.queries: list[str] = []

    async def full_text(self, _scope, _source):
        return self.full

    async def states(self, _scope, sources):
        return [{"id": s["id"], "state": self.state, "error": "PDF scan cần OCR"} for s in sources]

    async def search(self, _scope, _sources, query, limit=8):
        self.queries.append(query)
        return self.matches[:limit]


def run(tool, index, library=None, **kwargs):
    config = {
        "configurable": {
            "library": library or FakeLibrary(),
            "index": index,
            "user_id": USER,
        }
    }
    return tool.ainvoke({**kwargs, "document_id": DOC}, config=config)


def full(tokens: int, pages: int = 3):
    return {
        "text": "Nội dung thật của tài liệu.",
        "tokens": tokens,
        "chunkCount": pages,
        "pageCount": pages,
        "chunks": [
            {"text": f"Chương {i}\nchi tiết", "page": i + 1, "embedding": []}
            for i in range(pages)
        ],
    }


# --- read_document ----------------------------------------------------------


async def test_short_document_returns_the_whole_text():
    result = await run(read_document, FakeIndex(full=full(FULL_TEXT_TOKENS - 1)))
    assert "Nội dung thật của tài liệu." in result
    assert "QUÁ DÀI" not in result


async def test_long_document_returns_an_outline_not_a_slice():
    result = await run(read_document, FakeIndex(full=full(FULL_TEXT_TOKENS + 1)))
    assert "QUÁ DÀI" in result
    assert "search_document" in result
    # Không được lẫn một mẩu nội dung thật vào: đó là thứ khiến model tưởng đã đọc đủ.
    assert "Nội dung thật của tài liệu." not in result
    assert "- trang 1: Chương 0" in result


async def test_document_still_indexing_says_so():
    result = await run(read_document, FakeIndex(full=None, state="processing"))
    assert "đang được xử lý" in result
    assert "processing" in result


async def test_failed_document_reports_the_real_error():
    result = await run(read_document, FakeIndex(full=None, state="failed"))
    assert "KHÔNG thành công" in result and "OCR" in result


async def test_unknown_document_does_not_leak_existence():
    result = await run(read_document, FakeIndex(), library=FakeLibrary(row=None))
    assert "Không tìm thấy" in result
    assert "quyền" not in result


async def test_missing_session_context_is_reported():
    with pytest.raises(Exception) as error:
        await read_document.ainvoke({"document_id": DOC}, config={"configurable": {}})
    assert "tải lại trang" in str(error.value)


# --- search_document --------------------------------------------------------


async def test_search_labels_pages():
    index = FakeIndex(matches=[{"text": "Vòng lặp for", "page": 7}])
    result = await run(search_document, index, query="vòng lặp")
    assert "[trang 7]" in result and "Vòng lặp for" in result
    assert index.queries == ["vòng lặp"]


async def test_search_falls_back_to_chunk_numbers_without_pages():
    result = await run(search_document, FakeIndex(matches=[{"text": "abc", "page": None}]),
                       query="abc")
    assert "[đoạn 1]" in result


async def test_empty_search_suggests_another_keyword_not_a_conclusion():
    result = await run(search_document, FakeIndex(matches=[]), query="gì đó")
    assert "từ khoá khác" in result


async def test_long_query_is_clipped_before_embedding():
    index = FakeIndex(matches=[{"text": "x", "page": 1}])
    await run(search_document, index, query="a" * 5000)
    assert len(index.queries[0]) == 1000
