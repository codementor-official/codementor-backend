# Backend architecture review and proposal

Written **before any code**, after reviewing `codementor-frontend`, `codementor-infra` (44
PostgreSQL tables and 4 MongoDB collections) and the actor/use-case analysis.

---

## 1. State of the three repositories

| Repository | State | Impact on the backend |
| --- | --- | --- |
| `codementor-frontend` | Nearly complete, running on mocks. The `lib/*/*-service.ts` files are written *"shaped like a future REST/GraphQL client"* | This is the **informal API contract** — the backend should follow these shapes so the frontend only swaps mocks for `fetch` |
| `codementor-infra` | **Schema complete and verified**: 44 tables, 75 FKs, 79 CHECKs, 28 triggers, 5 availability functions, 15 passing tests | The backend **must not** generate the schema. See §5 |
| `codementor-backend` | Empty (only `README.md`) | Greenfield |

**Key point:** the database came first and **already contains business logic** — the trigger that
prevents dependency cycles, `fn_lesson_available`, triggers that maintain the progress cache. The
backend must *respect* this layer, neither duplicating nor bypassing it.

---

## 2. Boundary analysis from data, not intuition

Foreign keys crossing the proposed boundaries (counted by a script against the real database
catalog):

| Dependency direction | FKs | Assessment |
| --- | --- | --- |
| `group → identity` | 7 | OK — references `user_id` only |
| `learning → identity` | 7 | OK |
| `exercise → identity` | 4 | OK |
| `exercise → taxonomy` | 3 | Taxonomy has **no owner** in the proposal |
| `learning → taxonomy` | 2 | as above |
| `content → identity/taxonomy` | 2 | `articles` has **no owner** |
| `learning → exercise` | 1 | OK — one-way |
| `submission → exercise/group/identity` | 3 | OK — one-way |
| **`exercise → group`** | 1 | **Two-way dependency** |
| **`group → exercise`** | 1 | **Two-way dependency** |

### 2.1 The most serious issue: `Exercise ↔ Group` depend on each other

```text
exercises.owner_group_id     → study_groups(id)    Exercise must know Group exists
group_exercises.exercise_id  → exercises(id)       Group must know Exercise exists
```

This cycle makes it **impossible to split either service out first** — exactly what the goal of
*"split services later without a rewrite"* is meant to avoid.

**Proposed fix** (one small migration, best done early before real data exists):

```text
ALTER TABLE exercises DROP COLUMN owner_group_id;
ALTER TABLE exercises ADD COLUMN visibility exercise_visibility NOT NULL DEFAULT 'public';
```

`public` = the shared catalog, `group` = private. The question *"which group owns it"* is answered
by `group_exercises`. The dependency then becomes **one-way: `Group → Exercise`**.

### 2.2 `technologies` / `tags` / `companies` have no owner

Six FKs point at them from two different services. This is a classic **Shared Kernel**:

| Option | Assessment |
| --- | --- |
| Put it in Learning | Exercise would have to call Learning just to list tags |
| A separate "Catalog" service | Correct in theory, but a service for 3 read-mostly tables is over-engineering |
| **Shared Kernel module** *(chosen)* | A small bounded context, **read-only** for every service, writable by Admin only |

A Shared Kernel is a valid DDD pattern — as long as **who may write is stated explicitly**.

### 2.3 `articles` has no owner

One table, a lifecycle independent from the learning hierarchy, and no FKs pointing at it.
**Proposal:** put it in `Learning` as a separate module. Splitting it out later is cheap because
nothing references it.

---

## 3. Final list of services

| # | Service | Bounded context | Owns |
| --- | --- | --- | --- |
| 1 | **Identity** | User profiles and personalisation. **Authentication is Keycloak's** — see [01-identity-keycloak.md](01-identity-keycloak.md) | `users`, `user_stats`, `learning_preferences`, `study_schedule_slots` |
| 2 | **Catalog** *(shared kernel)* | Shared vocabulary | `technologies`, `tags`, `companies` |
| 3 | **Learning** | Path → course → chapter → lesson, dependencies, enrollment, progress, articles | 18 tables: `roadmap*`, `course*`, `chapters`, `lessons`, `*_prerequisites`, `*_enrollments`, `lesson_progress`, `articles` |
| 4 | **Exercise** | Exercises, exercise sets, dependencies, practice state | `exercises`, `exercise_*` — 9 tables |
| 5 | **Group** | Groups, members, group permissions, documents, assignments | `study_groups`, `group_*`, `assignments` — 8 tables |
| 6 | **Submission** | Submissions, judging orchestration | `submissions` |
| 7 | **AI** | AI integration: Q&A, error analysis, document pre-checks | *(no tables yet — §3.2)* |

### 3.1 Adjustments to the original proposal

| Original proposal | Adjustment | Reason |
| --- | --- | --- |
| 6 services | **7** (adds Catalog) | Taxonomy has 6 crossing FKs and no owner |
| Submission includes *"Code Execution"* | Code execution is an **outbound port**, not part of the service | Running untrusted code is a separate sandbox. Submission only *orchestrates*. Matches the "grading system" actor |
| AI as a peer service | AI is a **thin integration + anti-corruption layer** | Per the actor analysis, AI **never initiates** anything. Do not build aggregates or domain services for something that only calls an external API |
| Group includes *"Group Owner"* | Owner is a **role**, not an entity | Covered in the actor document |

### 3.2 Gap: AI has nowhere to store data

The frontend has `/ai-tutor` with conversations and the schema has `ai_verdict` on documents — but
**no table or collection stores AI conversations or context**. Add them in MongoDB (their shape
varies by provider):

```text
ai_conversations  { userId, contextType, contextId, messages[], model, createdAt }
ai_analyses       { targetType, targetId, verdict, findings[], model, promptVersion }
```

---

## 4. What enforces the boundaries?

Claiming "service boundaries" without a mechanism to enforce them means cross-context imports
within months. Three layers:

| Layer | Mechanism |
| --- | --- |
| **Compile time** | ESLint `import/no-restricted-paths`: no imports across `contexts/*` except through `*.public.ts` |
| **Architecture** | `domain/` must not import NestJS / Prisma / Mongoose — also ESLint zones |
| **Runtime** | Each context injects only its own repositories. Another context's data is written **only through domain events** |

### 4.1 Cross-service writes — use domain events, not direct calls

The current schema has two cross writes:

| Table | Owner | Who triggers the write | Solution |
| --- | --- | --- | --- |
| `exercise_progress` | Exercise | Submission (on an accepted verdict) | Submission publishes `SubmissionAccepted` → Exercise handles it |
| `user_stats` | Identity | Submission (XP, streak) | Same event, Identity is the second handler |

> **Superseded:** this document was written when the architecture was a modular monolith with an
> in-process event bus. It later moved to **independent services + Kafka** — see
> [`02-service-architecture.md`](02-service-architecture.md), the current reference. The boundary
> analysis (§2) and the migration decision (§5) still stand.

---

## 5. Key decision: who owns migrations?

> **`codementor-infra` owns the schema. The backend only reads it.**

The schema already has 28 triggers, 5 PL/pgSQL functions, 79 CHECKs and a 15-test `verify.sql`.
Prisma Migrate **cannot express** these — the first `migrate dev` would **wipe every trigger and
function**.

| Task | How |
| --- | --- |
| Change the schema | Write a SQL migration in `codementor-infra/database/postgres/migrations/` |
| Sync the backend | `prisma db pull` (introspect) → `prisma generate` |
| CI | Run `verify.sql` after migrating; `db pull --print` to detect schema drift |
| **Forbidden** | `prisma migrate dev` / `migrate deploy` in the backend repository |

Invariants stay in the database (per `04-design-decisions.md`); the backend **does not duplicate**
them and only translates SQLSTATE into readable domain errors — e.g. `23514` →
`CircularDependencyError`.

---

## 6. Technology choices

| Component | Choice | Notes |
| --- | --- | --- |
| Runtime | Node 24 | the development machine runs v24.12 |
| Framework | **NestJS 11** + **Fastify 5** | latest stable |
| Language | TypeScript 5, `strict` | |
| PostgreSQL | **Prisma 6.19.x** *(not 7)* | see §6.1 |
| MongoDB | **Mongoose 9** | |
| API docs | `@nestjs/swagger` 11 | |
| Validation | `class-validator` at the HTTP edge, **zod** for configuration | |
| Authentication | **Keycloak 26** (OIDC, RS256 via JWKS) | supports several social sign-ins |
| Logging | `nestjs-pino` | structured, with a request id |
| Testing | Jest + Supertest | |
| Events | `@nestjs/event-emitter` | **no Kafka** at this stage (since superseded) |

### 6.1 Why Prisma 6 rather than 7

Prisma 7 had just been released and was **changing its configuration model**: from
`schema.prisma` + `env()` to `prisma.config.ts` and driver adapters, alongside the in-progress
"Prisma Next" line. For this thesis project:

- We **do not use** Prisma Migrate (v7's main strength); we only need introspection and a
  type-safe client — which v6 has offered reliably for years.
- NestJS integration docs and examples mostly targeted v5/v6.
- The risk of breaking changes mid-thesis was not worth it.

Upgrading to v7 later is cheap, because `domain/` does not know Prisma exists — the change is
confined to the database infrastructure layer.

---

## 7. Proposed folder structure

```text
src/
├── main.ts
├── app.module.ts
│
├── shared/                     # shared infrastructure — NO business logic
│   ├── kernel/                 # DDD building blocks, plain TypeScript
│   │   ├── entity.ts, aggregate-root.ts, value-object.ts
│   │   ├── domain-event.ts, result.ts, domain-error.ts
│   │   └── repository.port.ts
│   ├── config/                 # env validated with zod
│   ├── database/
│   │   ├── prisma/             # PrismaService + SQLSTATE error mapping
│   │   └── mongo/              # Mongoose connection
│   ├── http/                   # exception filters, response interceptor, pipes
│   ├── logging/
│   ├── events/                 # EventBus port + in-process adapter
│   └── auth/                   # JWT strategy, guards, decorators
│
├── contexts/
│   ├── identity/
│   │   ├── domain/             # NO NestJS/Prisma imports
│   │   │   ├── model/          # User, Email, Password (value objects)
│   │   │   ├── event/
│   │   │   └── port/           # UserRepository (interface)
│   │   ├── application/        # use cases — independent of HTTP
│   │   ├── infrastructure/     # PrismaUserRepository, hashing adapter
│   │   ├── presentation/       # v1 controllers + DTOs
│   │   ├── identity.public.ts  # the ONLY contract for other contexts
│   │   └── identity.module.ts
│   └── catalog/ learning/ exercise/ group/ submission/ ai/
│
└── test/
```

**Golden rule:** other contexts **may only** import from `<context>.public.ts`. Everything else is
internal. When a context is split into its own service, `*.public.ts` is exactly where function
calls become HTTP/gRPC calls.

> The final layout is per service (`apps/<service>/src/contexts/…`) with shared code in `libs/` —
> see the repository README.

---

## 8. Summary of required adjustments

| # | Issue | Severity | Proposal |
| --- | --- | --- | --- |
| 1 | `Exercise ↔ Group` two-way dependency | **High** | Drop `exercises.owner_group_id`, add `visibility` |
| 2 | Taxonomy has no owner | Medium | Create a shared-kernel `catalog` context |
| 3 | `articles` has no owner | Low | Move it into Learning |
| 4 | AI has nowhere to store data | Medium | Add 2 MongoDB collections |
| 5 | `companies`/`exercise_companies` used by no use case | Low | Drop them or add a use case |
| 6 | Cross writes to `exercise_progress`, `user_stats` | Medium | Domain events instead of direct calls |
| 7 | Prisma Migrate would delete triggers/functions | **High** | Forbid migrations in the backend; infra owns the schema |

**Only #1 and #7 had to be settled before coding.** The rest were handled along the way.
