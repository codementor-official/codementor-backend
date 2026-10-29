# 0004. Parallel document indexing for the Tutor

- Status: accepted, shipped 2026-10-14 (backend `43a2a06`, frontend `4ea9c03`)
- Scope: `apps/ai-service` indexing worker, Tutor `wait` node, frontend document picker
- Benchmark: `apps/ai-service/eval/rag/bench_index.py` (own collection, not the shared queue)

## Context

Indexing four documents took 25.2 s (first ready at 7.5 s). Most of it was waste: the worker slept
3 s after every job even with work queued, jobs ran one at a time, the extraction subprocess
imported OpenAI/boto3/FastAPI just to read text, and embeddings went out in sequential batches.
Renaming a document re-embedded it, and indexing a group document spent a "rag" quota turn.

## Decision

- Worker: sleep only when the queue is empty; `queue()` wakes it through an `asyncio.Event`;
  `INDEX_WORKERS = 3` loops share the existing atomic `find_one_and_update` lease. The 3 s poll stays
  as a safety net.
- Extraction moves to a dependency-free module (`app/extraction.py`) for the subprocess.
- Embeddings go in batches of 16, up to 4 calls in parallel per job.
- A rename keeps the old chunks when type, storage key and preview are unchanged.
- The Tutor `wait` node wakes on a "job finished" signal; the wait limit is 3 minutes of wall time.
- The frontend starts indexing when a document is ticked, not when the question is sent.
- Indexing group documents no longer spends the "rag" quota; only questions do.

## Consequences

- Four documents: 25.2 s → 3.0 s; first document 7.5 s → 1.8 s.
- Not done: storing vectors as float32 binary (forces a full re-index) and indexing on approval via
  Kafka (embeds documents nobody asks about).
- Dev and production share the `ai_document_indexes` queue, so a local ai-service can take
  production jobs. Benchmarks use their own collection.
