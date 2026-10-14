"""Đo thời gian index tài liệu: từ lúc xếp hàng tới lúc hỏi được.

    uv run python eval/rag/bench_index.py corpus          # sinh 4 tài liệu cỡ thật vào build/
    uv run python eval/rag/bench_index.py stages          # trích/cắt đoạn từng tệp, tách chi phí spawn
    uv run python eval/rag/bench_index.py embed           # các cách gọi embedding trên cùng bộ đoạn
    uv run python eval/rag/bench_index.py e2e --repeat 3  # chọn cả 4 tệp một lượt, đợi tới khi sẵn sàng

`e2e` chạy ĐÚNG `DocumentIndex.worker()` của sản phẩm trên Mongo thật và OpenAI thật; chỉ thay
kho S3 bằng tệp cục bộ và bỏ trừ hạn mức. Mỗi lượt dùng một `scope` mới (`workspace:bench-…`)
nên không đụng bản index của ai, và xoá sạch hàng của mình khi xong.

Tài liệu tổng hợp ghép từ `eval/tutor/documents` — không dùng tệp cá nhân nào, vì nội dung đi
thẳng lên OpenAI.
"""

import argparse
import asyncio
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from uuid import uuid4

HERE = Path(__file__).resolve().parent
BUILD = HERE / "build"
sys.path.insert(0, str(HERE.parents[1]))

from pymongo import AsyncMongoClient  # noqa: E402

from app import budget  # noqa: E402
from app.config import settings  # noqa: E402
from app.provider import OpenAIProvider  # noqa: E402
from app.rag.documents import chunk_pages, extract_isolated, extract_pages, tokenizer  # noqa: E402
from app.rag.index import DocumentIndex  # noqa: E402

SOURCE_DOCS = HERE.parent / "tutor" / "documents"
FILES = {
    "giao-trinh-python.pdf": "pdf",
    "bai-giang-tong-hop.docx": "docx",
    "slide-on-tap.pptx": "pptx",
    "ghi-chu-on-thi.md": "md",
}


def sections() -> list[tuple[str, str]]:
    return [(path.stem, path.read_text()) for path in sorted(SOURCE_DOCS.iterdir())]


def cmd_corpus() -> None:
    """Bốn tệp cỡ một giáo trình thật: PDF 42 trang, DOCX ~40 trang, 42 slide, MD dài."""
    BUILD.mkdir(exist_ok=True)
    parts = sections()
    rounds = [(f"Phần {k + 1} — {name}", text) for k in range(3) for name, text in parts]

    html = "".join(
        f'<section style="page-break-after:always"><h2>{title}</h2><pre style="white-space:pre-wrap;'
        f'font-family:sans-serif">{text.replace("<", "&lt;")}</pre></section>'
        for title, text in rounds
    )
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as page:
        page.write(f'<!doctype html><meta charset="utf-8"><body>{html}</body>')
    subprocess.run(
        ["chromium", "--headless", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer",
         f"--print-to-pdf={BUILD / 'giao-trinh-python.pdf'}", page.name],
        check=True, capture_output=True,
    )

    from docx import Document

    document = Document()
    for title, text in rounds[: len(parts) * 2 + 6]:
        document.add_heading(title, level=2)
        for line in text.splitlines():
            if line.strip():
                document.add_paragraph(line)
    document.save(BUILD / "bai-giang-tong-hop.docx")

    from pptx import Presentation

    deck = Presentation()
    for title, text in rounds:
        slide = deck.slides.add_slide(deck.slide_layouts[1])
        slide.shapes.title.text = title
        slide.placeholders[1].text_frame.text = text[:900]
    deck.save(BUILD / "slide-on-tap.pptx")

    (BUILD / "ghi-chu-on-thi.md").write_text(
        "\n\n".join(f"## {title}\n\n{text}" for title, text in rounds[: len(parts) * 2])
    )
    for name in FILES:
        print(f"{name:28} {(BUILD / name).stat().st_size / 1024:7.1f} KB")


async def cmd_stages() -> None:
    """Thời gian trích + cắt đoạn: trong tiến trình con (như sản phẩm) và ngay tại chỗ.

    Hiệu hai con số là chi phí dựng tiến trình con + import, trả cho MỖI tài liệu.
    """
    print(f"{'tệp':28} {'đoạn':>5} {'token':>7} {'con (s)':>8} {'tại chỗ (s)':>11}")
    for name, kind in FILES.items():
        data = (BUILD / name).read_bytes()
        started = time.perf_counter()
        chunks = await extract_isolated(kind, data)
        isolated = time.perf_counter() - started
        started = time.perf_counter()
        chunk_pages(extract_pages(kind, data))
        inline = time.perf_counter() - started
        tokens = sum(len(tokenizer().encode(c["text"], disallowed_special=())) for c in chunks)
        print(f"{name:28} {len(chunks):5} {tokens:7} {isolated:8.2f} {inline:11.2f}")


async def cmd_embed(repeat: int) -> None:
    """Cùng một bộ đoạn (tệp lớn nhất), các cách chia lời gọi. Xen kẽ để nhịp OpenAI đều."""
    provider = OpenAIProvider(settings)
    texts = [c["text"] for c in await extract_isolated("docx", (BUILD / "bai-giang-tong-hop.docx").read_bytes())]

    async def sequential(size):
        for offset in range(0, len(texts), size):
            await provider.embed(texts[offset : offset + size])

    async def parallel(size):
        await asyncio.gather(
            *(provider.embed(texts[offset : offset + size]) for offset in range(0, len(texts), size))
        )

    strategies = {
        "tuần tự lô 32 (hiện tại)": lambda: sequential(32),
        "một lời gọi": lambda: sequential(len(texts)),
        "song song lô 32": lambda: parallel(32),
        "song song lô 16": lambda: parallel(16),
    }
    timings = {name: [] for name in strategies}
    try:
        for _ in range(repeat):
            for name, run in strategies.items():
                started = time.perf_counter()
                await run()
                timings[name].append(time.perf_counter() - started)
    finally:
        await provider.close()
    print(f"{len(texts)} đoạn, {repeat} lượt mỗi cách")
    for name, values in timings.items():
        print(f"{name:26} median {statistics.median(values):6.2f}s  [{', '.join(f'{v:.2f}' for v in values)}]")


class LocalStorage:
    """`DocumentStorage.read` đọc từ build/ thay vì S3. `storageKey` là tên tệp."""

    def read(self, _prefix: str, source: dict) -> bytes:
        return (BUILD / source["storageKey"]).read_bytes()


async def no_budget(*_args, **_kwargs):
    return None


async def cmd_e2e(repeat: int) -> None:
    budget.consume = no_budget
    client = AsyncMongoClient(settings.mongo_uri, tz_aware=True)
    provider = OpenAIProvider(settings)
    index = DocumentIndex(client[settings.mongo_db], settings, provider, LocalStorage())
    # Collection riêng: dev và prod dùng CHUNG Mongo, nên ở `ai_document_indexes` worker của
    # production sẽ giành job của bench rồi báo lỗi vì `storageKey` không nằm trên S3.
    index.indexes = client[settings.mongo_db]["bench_document_indexes"]
    worker = asyncio.create_task(index.worker())
    rows = []
    try:
        for _ in range(repeat):
            scope = f"workspace:bench-{uuid4()}"
            sources = [
                {"id": str(uuid4()), "title": name, "docType": kind, "storageKey": name,
                 "previewText": None, "revision": uuid4().hex}
                for name, kind in FILES.items()
            ]
            started = time.perf_counter()
            ready_at: dict[str, float] = {}
            try:
                for source in sources:
                    await index.queue(scope, source, "bench")
                while len(ready_at) < len(sources) and time.perf_counter() - started < 300:
                    for state in await index.states(scope, sources):
                        if state["state"] in ("ready", "failed") and state["id"] not in ready_at:
                            ready_at[state["id"]] = time.perf_counter() - started
                            if state["state"] == "failed":
                                print("failed:", state.get("error"))
                    await asyncio.sleep(0.1)
            finally:
                await index.indexes.delete_many({"scope": scope})
            times = sorted(ready_at.values())
            rows.append(times)
            print(f"first {times[0]:6.2f}s  all {times[-1]:6.2f}s  [{', '.join(f'{t:.1f}' for t in times)}]")
    finally:
        worker.cancel()
        await asyncio.gather(worker, return_exceptions=True)
        await index.indexes.drop()
        await provider.close()
        await client.close()
    print(
        f"median: first {statistics.median(r[0] for r in rows):.2f}s, "
        f"all {statistics.median(r[-1] for r in rows):.2f}s"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["corpus", "stages", "embed", "e2e"])
    parser.add_argument("--repeat", type=int, default=3)
    args = parser.parse_args()
    if args.command == "corpus":
        cmd_corpus()
    elif args.command == "stages":
        asyncio.run(cmd_stages())
    elif args.command == "embed":
        asyncio.run(cmd_embed(args.repeat))
    else:
        asyncio.run(cmd_e2e(args.repeat))


if __name__ == "__main__":
    main()
