"""Đo độ trễ A (không Jev) và B3 (đủ Jev) XEN KẼ từng câu, tuần tự.

    uv run python eval/tutor/latency.py

Vì sao không lấy độ trễ từ `run.py`: các lượt A và B chạy cách nhau hàng chục phút, và thông lượng
của OpenAI đổi theo giờ (đo được: 9,4 → 13,8 ms mỗi token ra giữa hai thời điểm, cùng một model).
Xen kẽ từng câu thì hai chế độ chịu cùng một tải.
"""

import asyncio
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))

import run  # noqa: E402

from app import budget, telemetry  # noqa: E402
from app.config import settings  # noqa: E402
from app.lecter import http  # noqa: E402
from app.tutor import graph as tutor_graph  # noqa: E402
from app.tutor import jev as jev_module  # noqa: E402
from app.tutor.capability import TUTOR  # noqa: E402

CATEGORIES = ("single", "out_of_scope")
LIMIT = 16


async def main() -> None:
    budget.consume = run.no_budget
    telemetry.record = run.collect
    http.workspace = run.ready
    meta = run.load_sources()
    ids = {s["key"][:2]: s["id"] for s in meta["sources"]}
    titles = {s["key"][:2]: s["title"] for s in meta["sources"]}
    questions = [q for q in run.load_questions() if q["category"] in CATEGORIES][:LIMIT]
    client, provider, index = await run.open_index()
    jev_client = jev_module.JevClient(settings.typesafe_api_key.get_secret_value())
    modes = (("A", None), ("B3", run.OnlyNodes(jev_client, run.MODES["B3"])))
    graph = tutor_graph.build(TUTOR)
    rows = []
    try:
        for question in questions:
            for mode, jev in modes:
                config = {
                    "recursion_limit": TUTOR.recursion_limit,
                    "configurable": {"index": index, "jev": jev, "workspace_slug": "eval",
                                     "workspace_id": meta["workspaceId"], "auth_token": "eval"},
                }
                row = await run.ask(graph, config, question, ids, titles)
                row.update(mode=mode, id=question["id"], category=question["category"])
                rows.append(row)
                print(mode, question["id"], row["latency"], row["llmMs"], row["jevMs"], flush=True)
    finally:
        await provider.close()
        await client.close()
        await jev_client.close()
    (run.RESULTS / "latency-interleaved.json").write_text(json.dumps(rows, ensure_ascii=False))
    for mode, _ in modes:
        subset = [r for r in rows if r["mode"] == mode]
        with_llm = [r for r in subset if r["llmCalls"]]
        latencies = sorted(r["latency"] for r in subset)
        print(
            f"{mode}: câu p50 {statistics.median(latencies):.1f}s "
            f"p95 {latencies[int(0.95 * (len(latencies) - 1))]:.1f}s | "
            f"LLM p50 {statistics.median(r['llmMs'] for r in with_llm) / 1000:.1f}s, "
            f"{statistics.median(r['llmMs'] / max(1, r['llmOutput']) for r in with_llm):.1f} ms/token ra | "
            f"Jev p50 {statistics.median(r['jevMs'] for r in subset):.0f}ms | "
            f"${sum(r['usd'] for r in subset):.4f}"
        )


if __name__ == "__main__":
    asyncio.run(main())
