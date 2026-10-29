# 0003. Optional Jev decisions in the Tutor graph

- Status: accepted, shipped to production 2026-10-09 (Jev `jev-1.13.0`)
- Scope: `apps/ai-service/app/tutor`, thresholds in `app/tutor/jev_policy.py`
- Measurements: `apps/ai-service/eval/tutor/RESULTS-20261009.md`

## Context

The Tutor answered off-topic questions through the LLM, sent loosely related chunks into the
prompt, and had no signal for "the documents do not cover this".

## Decision

- Graph: `wait → gate → retrieve → rerank → sufficiency → generate → verify`.
  - `gate`: Jev `Choice` (in_scope / chitchat / out_of_scope / unsafe). Out-of-scope and unsafe
    get the fixed "the documents do not contain this" reply without calling the LLM.
  - `retrieve` widens to top 20 when Jev is present (top 8 otherwise).
  - `rerank`: one Jev call, a `Noul` per chunk; keep chunks above threshold, at most 8, renumber S1…
  - `sufficiency`: `Noul` on "do these chunks answer the question"; low → the prompt leaves the
    quote block empty and still writes the explanation.
  - `verify` stays a substring check, not Jev.
- Rule: Jev judges, code compares thresholds, the LLM only writes. All thresholds live in
  `jev_policy.py`.
- Jev is fully optional: no `TYPESAFE_API_KEY` → one startup warning, nodes become no-ops, and the
  old flow runs unchanged. Any Jev error (429, 5xx, timeout, bad payload) logs a warning, records
  telemetry and falls back for that node. Timeout 3 s per call, one retry. Users never see a Jev error.

## Consequences

- Measured on 528 runs: correct handling 91% → 95%, out-of-scope handled 58% → 100%, chunks in the
  prompt that belong to the right document 35% → 96%, LLM input tokens −54%.
- One graph shape whatever the configuration, so tests cover both paths with a fake Jev client.
- Extra latency is capped at about 7 s per turn in the worst case.
