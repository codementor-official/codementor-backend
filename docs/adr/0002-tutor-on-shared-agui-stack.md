# 0002. Tutor (document RAG) on the shared AG-UI agent stack

- Status: accepted, shipped 2026-10-09 (route `/ai/tutor`, migration of old conversations applied)
- Scope: `apps/ai-service` (Tutor graph), frontend `/api/copilotkit/t/{slug}`

## Context

Tutor ran on its own request/response path: no streaming (10–30 s spinner), every question pulled
all embeddings from Mongo, follow-up turns only saw earlier questions, and documents were locked
to a conversation. Codey and Lecter already ran on AG-UI through CopilotKit.

## Decision

- Tutor becomes one more AG-UI agent: browser `useAgent("tutor")` → Next `/api/copilotkit/t/{slug}`
  (same cookie auth and refresh as the other surfaces) → ai-service `POST /api/v1/ai/tutor/workspace/{slug}/run`.
- Before the SSE stream opens, the server re-checks 1–8 selected documents through
  workspace-service `documents/prepare` with the user's token. A bad document is an HTTP 400, so the
  user does not lose a quota turn. Server-side document state overrides what the browser sent.
- Graph: `wait` (poll indexing) → `retrieve` → `generate` (streamed) → `verify` (substring check
  of each quote).
- Answers keep the two-block format: verbatim quotes checked against the sources, then
  "Explanation & extension". The model marks blocks with `<<<TRICH_DAN>>>` / `<<<GIAI_THICH>>>`
  so both Python and TypeScript can split a streamed answer.
- Documents are chosen per turn, not per conversation. The LLM sees the last three turns,
  including the verified answers.
- Old `ai_conversations` are migrated into `ai_agent_sessions`; the grounding shape matches the
  old `AiTurn`, so the frontend renders both.

## Consequences

- Vectors are cached in-process by `_id` + `updatedAt`; `full_text` no longer carries embeddings.
- Tutor shares quota, telemetry and `RUN_ERROR` handling with the other agents.
- Follow-ups: optional Jev gating (ADR 0003) and faster indexing (ADR 0004).
