# 0001. Admin console: KPI strips, AI-call telemetry, read-only settings

- Status: accepted, shipped 2026-09-27 (backend `34a59f5`, frontend `5a40db6`, infra migrations 0030–0031)
- Scope: `codementor-frontend/apps/admin` and the backend services it reads

## Context

The admin app had list pages with no figures, an AI operations page with no data source, a
documents page that duplicated moderation, and a settings page that looked editable but was not
wired to anything.

## Decision

- Management pages show a KPI strip (4–6 numbers) between the header and the filter bar. No charts.
- Every model call is recorded in a new MongoDB collection `ai_call_events` (validator, TTL 90 days).
  "Errors" means provider errors plus failed agent runs; malformed model output after a successful
  call is counted separately.
- The Documents page is removed. Group-document reports go into `content_reports`, so they appear
  in the Reports queue with every other report.
- Settings stays as a read-only page that gathers each service's running configuration. The
  "Authentication" and "Platform" cards were dropped, along with their part of `system/settings`.
- Code-judge and system-activity pages read existing state (`submissions`, service health); no new store.

## Consequences

- AI cost and failure figures exist only for the last 90 days.
- Admin page headers no longer take a `description`; the shared `PageHeader` still supports it for
  the client and lecturer apps.
- New admin report routes need a Kong route; a missing route shows up as a 404 on the page.
- Deploy notes: production migrations are applied by hand, see
  `codementor-infra/database/docs/adr/0001-manual-production-migrations.md`.
