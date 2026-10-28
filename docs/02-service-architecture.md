# Service-based architecture — redesign

Replaces the earlier modular-monolith foundation. Goals: several deployment units, a shared
PostgreSQL database with logical ownership, Kafka for asynchronous work, HTTP/gRPC for synchronous
calls, and WebSocket/SSE for realtime updates.

> **Document status — 2026-09-16.** This design was written when the system had 9 services. The
> code now has **10 apps**: 8 NestJS + `ai-service` + `judge-service` (Python). Two services came
> after the design — `notification-service` (3012) and `recommendation-service` (3013) — and are
> added to §2. **`document-service` was deleted (2026-09-16)** — the `Document → Workspace` merge
> suggested in §0 had in fact already happened in the code. Kafka is a hard startup dependency.
> The table count in this document is **44**; Prisma actually introspects more models across the
> later migrations — the difference is tables added afterwards (notifications, audit log, content
> moderation, study reminders, tag categories, commerce, report moderation). Read the "Owns" column
> as a boundary, not as a final count.

---

## 0. Adjustments to the original service list

| # | Issue | Resolution |
| --- | --- | --- |
| 1 | **No Learning Service** | The 8-service list had no home for `roadmaps → courses → chapters → lessons`, the dependency graph, enrollment and progress — **19 of 44 tables**. Added as the 9th service |
| 2 | `Workspace` vs `Group` | Keep the name **Workspace** — it matches the frontend's `/workspace` route. Same thing |
| 3 | `exercise.generation.requested` is a **command**, not an event | Separate `cmd.*` and `evt.*` namespaces. See §3.1 |
| 4 | Kafka was ruled out in an earlier requirement | The requirement changed — respected. Use **single-broker KRaft** (no ZooKeeper) to stay light. See §6.2 |
| 5 | The two-way `Exercise ↔ Workspace` FK **is still there** | Before, it was a design smell. Now it means **two different services writing each other's tables** — fix it before splitting. See §5.4 |

**If thesis time runs short**, these can be merged without breaking the design:
`Document → Workspace`, `Judge → Submission`, leaving **7 services**. The others should not merge.

---

## 1. Project structure (NestJS + Python)

The AI Service now runs on Python/FastAPI and is no longer in `nest-cli.json`. Workspace Service
(NestJS) checks identity, membership and read permission, then calls the AI service internally over
HTTP with `INTERNAL_SERVICE_TOKEN`. Python owns document extraction, embeddings, retrieval and Q&A
history in MongoDB; it never reads Workspace's PostgreSQL tables. Local setup and limits:
`apps/ai-service/README.md`.

```text
codementor-backend/
├── apps/                                   # each folder = one deployment unit
│   ├── core-service/                       #  :3001
│   ├── learning-service/                   #  :3002
│   ├── exercise-service/                   #  :3003
│   ├── workspace-service/                  #  :3004
│   ├── submission-service/                 #  :3006
│   ├── judge-service/                      #  :3007  (not public)
│   ├── ai-service/                         #  :3008  (not public)
│   ├── realtime-service/                   #  :3009  (WS/SSE)
│   ├── notification-service/               #  :3012
│   └── recommendation-service/             #  :3013
│
├── libs/                                   # shared, NO business logic
│   ├── kernel/                             # Entity, AggregateRoot, ValueObject, Result, DomainError
│   ├── platform/                           # config, logging, Prisma, Mongo, HTTP filters, Keycloak auth
│   ├── messaging/                          # Kafka producer/consumer, outbox, topic registry
│   └── contracts/                          # ⭐ contracts between services — see below
│
├── prisma/schema.prisma                    # one schema, introspected from codementor-infra
├── docker-compose.yml
└── nest-cli.json                           # declares the NestJS apps
```

Inside **every** app the DDD structure stays the same:

```text
apps/learning-service/src/
├── main.ts                     # own bootstrap, own port, own Swagger
├── app.module.ts
├── contexts/                   # one service MAY host several bounded contexts
│   └── learning/
│       ├── domain/             # ⛔ no NestJS/Prisma/Kafka imports
│       ├── application/
│       ├── infrastructure/
│       └── presentation/
│           ├── http/           # REST for the frontend
│           └── messaging/      # Kafka consumers
└── contexts/articles/          # a second context in the same service
```

> **Bounded context ≠ service.** A service is a unit of *deployment*; a context is a *model*
> boundary. One service holds 1–n contexts. This is what distinguishes service-based architecture
> from microservices.

### 1.1 `libs/contracts` — contracts between services

The only place types are shared between services. Entities and repositories are **never** shared.

```text
libs/contracts/src/
├── events/
│   ├── envelope.ts              # common shape of every message
│   ├── document.events.ts       # DocumentUploadedV1, DocumentAnalyzedV1...
│   ├── exercise.events.ts
│   ├── submission.events.ts
│   ├── judge.events.ts
│   └── learning.events.ts
├── topics.ts                    # topic name constants — never hard-code strings
└── clients/                     # HTTP contracts between services (not implementations)
    └── workspace-ai.ts          # workspace-service ↔ ai-service
```

> The original design also had `core-client.port.ts` and `exercise-client.port.ts`. Nothing used
> them, so both were removed (2026-09-16); user resolution goes through `RemoteIdentityModule` in
> `libs/platform`.

---

## 2. Services and data ownership

| Service | Bounded context | Owns PostgreSQL tables | Mongo | Public? |
| --- | --- | --- | --- | --- |
| **core-service** | Identity, Catalog | `users`, `user_stats`, `learning_preferences`, `study_schedule_slots`, `technologies`, `tags`, `companies` — **7** | — | ✅ |
| **learning-service** | Learning, Articles | `roadmaps*`(4), `courses*`(4), `roadmap_courses`, `chapters`, `lessons`, 4 `*_prerequisites` tables, `roadmap_enrollments`, `course_enrollments`, `lesson_progress`, `articles` — **19** | `lesson_contents`, `article_contents` | ✅ |
| **exercise-service** | Exercise | `exercises`, `exercise_tags/technologies/companies`, `exercise_sets`, `exercise_set_items`, `exercise_set_enrollments`, `exercise_prerequisites`, `exercise_progress` — **9** | `exercise_contents` | ✅ |
| **workspace-service** | Group, Document | `study_groups`, `group_members`, `group_role_permissions`, `group_member_permissions`, `group_exercises`, `assignments`, `group_activities`, `group_documents` — **8** | — | ✅ |
| **submission-service** | Submission | `submissions` — **1** | — | ✅ |
| **judge-service** | — | **0** relational tables | `submission_run_details` | ❌ internal¹ |
| **ai-service** | — | **0** | `ai_conversations`, `ai_documents`, `ai_rag`, `ai_agent_sessions` | ❌ internal² |
| **realtime-service** | — | **0** | — | ✅ WS/SSE |
| **notification-service** `:3012` | Notification | `notifications*` tables | `notifications`, `notification_reads` | ✅ |
| **recommendation-service** `:3013` | Recommendation | **0** — reads other services' tables only | — | ✅ |

¹ judge-service is **Python/FastAPI**, not NestJS — see `apps/judge-service/README.md`. It writes
`submission_run_details` (stdout/stderr per test case) and returns its `_id` in
`evt.judge.completed.v1.runDetailRef`: pushing the full details through Kafka would grow the payload
with every test case. The verdict in PostgreSQL is still written **only** by submission-service.
The judge also exposes `POST /api/v1/judge/run` for a synchronous, JWT-checked trial run — used by
the "Run" button in the studio.

**Design rule: no table has two owners, and no table is ownerless.**

> **`document-service` is gone.** It never got past a skeleton (health + wiring), while
> `group_documents` was read and written by `workspace-service` from the start. The design now
> matches the code: the table belongs to `workspace-service`. The `evt.document.*` /
> `cmd.document.analyze.v1` topics in §3 are still declared in `libs/contracts`, but no service
> publishes or consumes them.
>
> ⚠️ **`recommendation-service` does not import `MessagingModule`** — on purpose: it only reads
> PostgreSQL and neither publishes nor consumes events. It is also the only NestJS service that
> survives a Kafka outage.

² `ai-service` also exposes a public, Keycloak-JWT-checked `/api/v1/ai/*` for its assistants, so it
is not purely internal as originally designed.

### 2.1 Why Judge and AI own no tables

Both are **stateless workers**: they take a job from Kafka, process it and publish the result.
They **never** write `submissions` or `exercises` directly — the owning service decides what to
store.

If the Judge wrote `submissions.verdict` itself, two services would write the same table and the
single point of control over a submission's state would be lost.

---

## 3. Kafka — topics and events

### 3.1 Naming

```text
codementor.<namespace>.<name>.v<n>

namespace:  evt  = something that HAS happened, past tense, many consumers   (fan-out)
            cmd  = a request to DO something, imperative, exactly 1 consumer (point-to-point)
```

`cmd` and `evt` are separate because their semantics differ: a command may be rejected and should
have exactly one handler; an event is an established fact that anyone interested may consume. The
original list mixed them (`exercise.generation.requested` is a command, `exercise.generated` is an
event).

### 3.2 Full catalog

| Topic | Producer | Consumer | Notes |
| --- | --- | --- | --- |
| `evt.user.provisioned.v1` | core | learning | creates default `learning_preferences` |
| `evt.document.uploaded.v1` | document | ai, realtime | triggers the pre-check |
| `cmd.document.analyze.v1` | document | **ai** | command — one consumer group |
| `evt.document.analyzed.v1` | ai | document, realtime | returns `ai_verdict` |
| `evt.document.moderated.v1` | document | workspace, realtime | the reviewer decided |
| `cmd.exercise.generate.v1` | workspace, exercise | **ai** | generate an exercise draft |
| `evt.exercise.generated.v1` | ai | exercise, realtime | `exercises.source='ai'` |
| `evt.exercise.published.v1` | exercise | learning, workspace | exercise enters the catalog |
| `evt.submission.created.v1` | submission | realtime | received, not yet judged |
| `cmd.judge.run.v1` | submission | **judge** | carries the source and test cases |
| `evt.judge.started.v1` | judge | realtime | updates the UI to "judging" |
| `evt.judge.completed.v1` | judge | submission | **only submission** writes the verdict |
| `evt.submission.evaluated.v1` | submission | exercise, core, workspace, realtime | fan-out after it is stored |
| `evt.lesson.completed.v1` | learning | core, realtime | XP, streak |
| `evt.course.completed.v1` | learning | core, workspace, realtime | |
| `evt.assignment.created.v1` | workspace | realtime | notify members |
| `evt.assignment.reviewed.v1` | workspace | realtime, core | |

**Judging flow — note the direction of the arrows:**

```text
submission ──cmd.judge.run──▶ judge ──evt.judge.started──▶ realtime
                               │
                               └──evt.judge.completed──▶ submission
                                                            │ writes the verdict to its own table
                                                            └──evt.submission.evaluated──┬─▶ exercise (exercise_progress)
                                                                                          ├─▶ core (user_stats: XP, streak)
                                                                                          └─▶ realtime (push the result to the UI)
```

The Judge does **not** publish `submission.evaluated` — it knows nothing about progress rules.
Submission owns the state, so it is the one that announces "evaluation finished".

### 3.3 Standard envelope

Every message shares one envelope, so tracing and versioning are not redone per topic:

```jsonc
{
  "eventId": "uuid",            // idempotency key for consumers
  "eventName": "evt.judge.completed.v1",
  "occurredAt": "2026-08-11T10:00:00Z",
  "correlationId": "uuid",      // spans one business flow (submission → judge → progress)
  "causationId": "uuid",        // which message caused this one
  "actor": { "userId": "uuid" }, // who triggered it, for auditing
  "payload": { }
}
```

- **`eventId`**: consumers record what they processed, so reprocessing has no side effects. Kafka
  guarantees *at-least-once*, so duplicates are normal and must be expected.
- **`correlationId`**: one click on "Submit" produces 5 messages across 4 services — without it,
  debugging means reading logs in 4 places.

### 3.4 Partition keys

| Topic | Key | Why |
| --- | --- | --- |
| `cmd.judge.run`, `evt.judge.*` | `submissionId` | every step of one submission stays in order |
| `evt.submission.evaluated` | `userId` | one person's XP/streak is never applied out of order |
| `evt.document.*` | `documentId` | |
| `evt.lesson.completed` | `userId` | one person's progress is processed sequentially |

A wrong partition key is a subtle bug: the system works under low load and fails with several
partitions.

---

## 4. Dependencies between services

### 4.1 Synchronous (HTTP) — only when an immediate answer is needed

```text
frontend ──▶ core          (profiles, catalog)
frontend ──▶ learning ──▶ core       (user names)
                  └────▶ exercise    (exercises attached to lessons)
frontend ──▶ exercise ──▶ core
frontend ──▶ workspace ──▶ core
                   └────▶ exercise   (assigned exercise details)
frontend ──▶ submission ──▶ exercise (limits, test cases)
                     └───▶ core
frontend ──▶ realtime  (WS/SSE, authenticated through core only)
```

**No cycles.** Dependency order: `core` ← `exercise` ← `learning`/`workspace`/`submission`.
`judge` and `ai` **make no synchronous calls** — everything they need is in the payload.

Rule: **a service may only call services earlier in that order.** Calling the other way goes
through Kafka. This prevents dependency cycles without debating each case.

### 4.2 Asynchronous (Kafka) — everything else

Use Kafka when (a) several consumers care, (b) processing takes long, (c) no immediate answer is
needed, or (d) both sides should deploy independently.

Typical example: awarding XP after judging must **not** be an HTTP call from submission to core —
if core is down, nothing could be judged. Through Kafka, core being down only delays the XP.

### 4.3 gRPC — not needed yet

HTTP/JSON is enough for the thesis traffic. gRPC is worth considering if `submission → exercise`
(fetching test cases on every submission) becomes a bottleneck. Nothing in the design prevents
the switch.

---

## 5. Shared database ownership

### 5.1 Enforced by PostgreSQL permissions, not only by convention

This is the strongest point of a shared database done properly: each service gets **its own
database user**, granted only on the tables it owns.

```sql
CREATE ROLE learning_service LOGIN PASSWORD '...';

-- Owned: full access
GRANT SELECT, INSERT, UPDATE, DELETE ON
  roadmaps, courses, chapters, lessons, lesson_progress, course_enrollments /* ... */
  TO learning_service;

-- Nothing on users, exercises, submissions...
-- Even a deliberate SELECT gets "permission denied for table users".
```

ESLint stops careless developers. Database permissions stop **deliberate** access too, as well as
hand-run scripts and faulty migrations.

### 5.2 Reading another service's data: views, not tables

Sometimes HTTP is too expensive (joining 50 users to render a group leaderboard). Then grant read
access on a **view**, not the base table:

```sql
CREATE VIEW v_user_summary AS
  SELECT id, display_name, avatar_url, role
  FROM users WHERE status <> 'deleted';

GRANT SELECT ON v_user_summary TO workspace_service, learning_service;
```

A view is a **stable read contract**: core can restructure `users` while keeping the view, and no
service breaks. Granting on the table makes every column change a breaking change.

> Rule: **read through views/HTTP, write only as the owner.** No service may `UPDATE` another
> service's table — not even "just one column".

### 5.3 Migrations still belong to `codementor-infra`

Unchanged from the earlier decision: infra owns the SQL migrations (triggers and PL/pgSQL
functions); every service only runs `prisma db pull`. The grants in §5.1 are a new migration.

With every service sharing one `schema.prisma`, each service only *uses* its own models — Prisma
cannot enforce that, so the database permissions in §5.1 are the real protection.

### 5.4 Fix before splitting: `exercises.owner_group_id`

```text
exercises.owner_group_id     → study_groups   exercise-service writing workspace's table?
group_exercises.exercise_id  → exercises      workspace-service writing exercise's table?
```

In one process this is only a design smell. Split into two services, this FK makes **clean grants
impossible** — and it breaks the moment the databases are actually separated.

Fix: drop `exercises.owner_group_id` and add `exercises.visibility ('public' | 'group')`. The
question "which group owns it" is answered by `group_exercises` (workspace-service).
→ The dependency becomes one-way, `workspace → exercise`, matching the order in §4.1.

### 5.5 Transactional outbox

The problem: write to the database, then publish to Kafka — dying between the two loses the event
forever. A submission is stored but `cmd.judge.run` is never published → it stays `pending`
forever.

The fix: write the event to an `outbox` table **in the same transaction** as the business data,
and let a poller publish it to Kafka.

```sql
CREATE TABLE outbox (
  id            uuid PRIMARY KEY,
  topic         text NOT NULL,
  partition_key text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);
CREATE INDEX ON outbox (created_at) WHERE published_at IS NULL;
```

Cost: one table and one background job in `libs/messaging`. **Worth it for submissions** (a lost
event is a lost submission). Less critical flows can publish directly at first and add the outbox
later — the `EventBus` port hides the difference.

---

## 6. Infrastructure

### 6.1 Additions

| Component | Purpose | Notes |
| --- | --- | --- |
| **Kafka (KRaft)** | asynchronous messaging between services | 1 broker, **no ZooKeeper** — much lighter |
| **Kafka UI** | inspect topics and messages while debugging | invaluable for demos and the defence |
| **Redis** | Socket.IO adapter when realtime runs more than one instance | can be skipped with a single instance |
| Keycloak | already in place | every service verifies against the same JWKS |

### 6.2 Why single-broker KRaft

Full Kafka (3 brokers + ZooKeeper) needs about 3 GB of RAM and adds nothing for a thesis. KRaft
drops ZooKeeper, and one broker still provides everything needed: topics, partitions, consumer
groups and offsets. Moving to a real cluster later is a configuration change, not a code change.

*Redpanda is lighter still (Kafka API compatible, a single Go binary, ~200 MB) — consider it on a
weak development machine.*

---

## 7. Realtime Service

Owns no tables and has no business logic. Its only job: **bridge Kafka to clients**.

```text
Kafka ──▶ realtime-service ──WS/SSE──▶ frontend
```

| Concern | How |
| --- | --- |
| Authentication | same Keycloak JWKS; `userId` comes from the token at handshake |
| Routing | each client joins `user:<id>` and the `group:<id>` rooms of its groups |
| Filtering | **only push events the user may see** — realtime is an easily forgotten data-leak surface |
| Consumer group | its own, so it never competes with the business services for messages |
| WS or SSE | WS for `/workspace` (two-way); **SSE** for judging progress (one-way, auto-reconnect, far simpler) |

---

## 8. Suggested rollout order

| Phase | Content | Verifiable result |
| --- | --- | --- |
| 1 | Monorepo + `libs/*` + extract `core-service` | one service running, health OK |
| 2 | `learning-service` + HTTP client to core | two processes calling each other over the network |
| 3 | Kafka + `libs/messaging` + `evt.user.provisioned` | one event travels end to end |
| 4 | `exercise-service`, `workspace-service` | |
| 5 | `submission` + `judge` + outbox | the full judging flow |
| 6 | `ai-service` (group documents live in `workspace-service`; `document-service` dropped) | |
| 7 | `realtime-service` | the UI updates live |
| 8 | Per-service grants (§5.1) | other services get `permission denied` |

Phase 8 should happen **as early as possible** — the longer it waits, the more places accidentally
read someone else's tables.

---

## 9. Known risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Many services for a thesis | Build and distributed-debugging time | Merge `document→workspace`, `judge→submission` if behind schedule |
| Kafka at-least-once ⇒ duplicate processing | XP awarded twice, judged twice | `eventId` + a `processed_events` table per consumer |
| Shared DB ⇒ no ACID across services | Temporary inconsistency | Accept eventual consistency; keep ACID **within** a service |
| No distributed transactions | A submission is stored but never judged | The outbox (§5.5) for critical flows |
| Still one database ⇒ one shared point of failure | The whole system stops | Accepted at this stage; splitting the database comes later |
| Debugging across 4 services | Time-consuming | `correlationId` required in every message and log line |
