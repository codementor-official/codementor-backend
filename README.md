<div align="center">

# CodeMentor Backend

**The backend of CodeMentor — a self-paced programming platform with courses, learning paths, auto-graded coding practice, study groups and an AI assistant.**

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=node.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![Python](https://img.shields.io/badge/Python-FastAPI-3776AB?logo=python&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?logo=mongodb&logoColor=white)
![Kafka](https://img.shields.io/badge/Kafka-KRaft-231F20?logo=apachekafka&logoColor=white)
![Keycloak](https://img.shields.io/badge/Keycloak-26-4D4D4D?logo=keycloak&logoColor=white)

</div>

---

## Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Services](#services)
- [Getting started](#getting-started)
- [Common commands](#common-commands)
- [Database](#database)
- [Authentication](#authentication)
- [Kafka](#kafka)
- [Deployment](#deployment)
- [Project structure](#project-structure)
- [Documentation](#documentation)

## Overview

A **service-based** architecture: 10 independently deployable services (8 NestJS, 2 Python) that
share one PostgreSQL database, where **every table has exactly one owning service**. Services talk
synchronously over HTTP and asynchronously over Kafka. The frontend sees **a single origin**: the
Kong gateway at `/api/v1`.

| Layer | Technology |
| --- | --- |
| Business services | NestJS · TypeScript · Prisma · Mongoose |
| Code judging, AI | Python · FastAPI · LangGraph · Docker sandboxes |
| Data | PostgreSQL (relational) · MongoDB (document content) · S3 (video, documents, images) |
| Platform | Kafka (KRaft) · Kong (DB-less) · Caddy (TLS) · Keycloak (identity) |

## Architecture

```text
                    Frontend (client · lecturer · admin)
                                   │ HTTPS
                     Caddy ── TLS via Let's Encrypt
                       │                     │ /socket.io
                  Kong gateway         realtime-service
                       │ /api/v1/*
   ┌────────┬──────────┼──────────┬───────────┬──────────────┐
  core   learning   exercise   workspace   submission   notification …
   │        │          │          │           │
   └────────┴── PostgreSQL ── MongoDB ── S3 ──┘
                       │
                  Kafka (evt.* / cmd.*) ── judge-service ── Docker sandboxes
                                         ── ai-service
```

The full design — services, topics, dependencies and data ownership — lives in
[`docs/02-service-architecture.md`](docs/02-service-architecture.md).

## Services

| Service | Port | Responsibility |
| --- | --- | --- |
| `core-service` | 3001 | Accounts, profiles, roles, audit log, content reports and moderation, announcements |
| `learning-service` | 3002 | Courses, learning paths, lessons, articles, progress, commerce (orders, revenue, payouts) |
| `exercise-service` | 3003 | Exercises, exercise sets, topics, solving progress |
| `workspace-service` | 3004 | Study groups, members, group permissions, documents, assignments, chat |
| `submission-service` | 3006 | Submissions and verdicts |
| `judge-service` *(Python)* | 3007 | Runs code in Docker sandboxes for 6 languages |
| `ai-service` *(Python)* | 3008 | AI assistants (Codey, Lecter, Tutor) and document RAG |
| `realtime-service` | 3009 | Kafka → WebSocket bridge |
| `notification-service` | 3012 | In-app notifications, email (SMTP/SES), study reminders |
| `recommendation-service` | 3013 | Course and learning-path recommendations (read-only) |

Health checks: NestJS services expose `/api/v1/health`; `judge-service` exposes
`/api/v1/judge/health`. Each service serves Swagger at `http://localhost:<port>/api/docs`.

## Getting started

**Prerequisites:** Node.js ≥ 22 · npm · Docker · [uv](https://docs.astral.sh/uv/) for the two Python
services. PostgreSQL, MongoDB and Keycloak run on the data host managed by `codementor-infra`.

```bash
# 1. Configure
cp .env.example .env                 # fill in DATABASE_URL, MONGO_URI, Keycloak, S3, SMTP…

# 2. Local platform: Kafka + Kong
docker compose up -d kafka kafka-ui kong

# 3. Install and generate the Prisma client from the live schema (introspect — never migrate)
npm ci
npm run db:sync

# 4. Run
npm run start:core                               # one service in watch mode
npm run build:all && npm run services start      # or all 8 NestJS services

# 5. Check
npm run smoke
```

| Interface | URL |
| --- | --- |
| API gateway | http://localhost:8000/api/v1 |
| Kafka UI | http://localhost:8081 |

> Use **npm**. The Docker image builds with `npm ci` from `package-lock.json`.

## Common commands

| Command | What it does |
| --- | --- |
| `npm run start:<service>` | Run one NestJS service in watch mode (`core`, `learning`, `exercise`, `workspace`, `submission`, `realtime`, `notification`, `recommendation`) |
| `npm run ai:start` · `npm run judge:dev` | Run the two Python services |
| `npm run judge:images` | Build the 6 sandbox images — required before judging |
| `npm run build:all` | Build the 8 NestJS services |
| `npm run services start\|stop\|status` | Start or stop the built services |
| `npm run lint` | Lint and **enforce architecture boundaries** |
| `npm test` · `npm run test:cov` | Unit tests · coverage (thresholds apply to `domain/model` only) |
| `npm run smoke` | Exercise the main flows through the gateway |
| `npm run db:sync` | Introspect the schema and generate the Prisma client |
| `npm run verify:smtp` | Check the email configuration |

### Architecture boundaries enforced by lint

| Violation | Do this instead |
| --- | --- |
| A service imports another service's code | Call it over HTTP or publish an event from `libs/contracts` |
| `libs/kernel` imports infrastructure | Keep the kernel plain TypeScript |
| `domain/` imports NestJS, Prisma, Mongoose or Kafka | Go through a port (repository, `EventBus`) |

## Database

> **The schema belongs to `codementor-infra`. This repository only reads it.**

The schema enforces invariants with triggers, PL/pgSQL functions and CHECK constraints (dependency
cycle prevention, cached progress, …). `prisma migrate` would drop them.

| Task | How |
| --- | --- |
| Change the schema | Add a new SQL file under `codementor-infra/database/postgres/migrations/` |
| Sync the backend | `npm run db:sync` |
| **Never** | `prisma migrate dev` / `prisma migrate deploy` |

## Authentication

Keycloak is the identity provider; the backend is a **resource server** that only verifies JWTs
(RS256 via JWKS). There is no `/login` or `/register` and no password storage. An internal profile
is provisioned just-in-time on the first request and linked through `users.external_id`. Accounts
suspended in CodeMentor are rejected on every request with `403 ACCOUNT_SUSPENDED`.

Details: [`docs/01-identity-keycloak.md`](docs/01-identity-keycloak.md) ·
[`docs/email-verification.md`](docs/email-verification.md).

## Kafka

Naming: `cmd.*` is a request for work (exactly one consumer group), `evt.*` is a fact that happened
(fan-out). Every topic is declared in `libs/contracts/src/events/topics.ts` — never hard-code a
topic string.

```text
submission ──cmd.judge.run──▶ judge ──evt.judge.completed──▶ submission
                                                               └─evt.submission.evaluated─▶ exercise · core · realtime
```

- **At-least-once:** every event carries an `eventId`; consumers deduplicate through `processed_events`.
- **Ordering:** pick the right `PARTITION_KEY` for each topic.
- **No lost messages:** critical flows enable the outbox (`enableOutbox: true`).

> Kafka is a startup dependency: a NestJS service that uses `MessagingModule` exits if it cannot
> reach the broker. In Compose, Kafka must be `healthy` before the services start.

## Deployment

Production runs on two hosts:

| Host | Runs |
| --- | --- |
| Data host | PostgreSQL, MongoDB, Keycloak — managed in `codementor-infra` |
| Application host | Caddy, Kong, Kafka and every service — `docker-compose.yml` + `docker-compose.ec2.yml` |

```bash
SSH_KEY=<key.pem> ./scripts/bootstrap-ec2.sh     ec2-user@<host>        # first time: install Docker, clone
SSH_KEY=<key.pem> ./scripts/push-env-ec2.sh      ec2-user@<host>        # copy .env (mode 0600)
SSH_KEY=<key.pem> ./scripts/deploy-branch-ec2.sh ec2-user@<host> main   # pull a branch, build, restart
```

Caddy issues TLS certificates automatically and routes `/socket.io` straight to `realtime-service`;
everything else goes through Kong. Apply schema changes in `codementor-infra` **before** deploying
the services that depend on them.

## Project structure

```text
apps/
  <service>/src/
    main.ts                    shared bootstrapService()
    contexts/<context>/        one service may host several bounded contexts
      domain/                  business model, framework-free
      application/             use cases
      infrastructure/          repositories, adapters
      presentation/            REST controllers, Kafka consumers
  ai-service/ · judge-service/ Python services (see their own READMEs)
libs/
  kernel/                      Entity, AggregateRoot, ValueObject, Result, DomainError
  platform/                    config, logging, Prisma, Mongo, auth, HTTP filters
  messaging/                   Kafka client, EventBus, outbox
  contracts/                   the ONLY code shared between services
content/                       course and article content (Markdown) used for seeding
kong/ · caddy/                 gateway and TLS configuration
prisma/schema.prisma           generated by db pull — do not edit by hand
scripts/                       deployment, seeding, data migrations, verification
```

## Documentation

| Document | Covers |
| --- | --- |
| [`docs/02-service-architecture.md`](docs/02-service-architecture.md) | Current architecture: services, topics, dependencies, data ownership |
| [`docs/01-identity-keycloak.md`](docs/01-identity-keycloak.md) | Keycloak, just-in-time provisioning, social sign-in |
| [`docs/00-architecture-review.md`](docs/00-architecture-review.md) | The original review of the three repositories |
| [`docs/commerce-sandbox.md`](docs/commerce-sandbox.md) · [`docs/vnpay-reconciliation-recovery.md`](docs/vnpay-reconciliation-recovery.md) | VNPAY payments and reconciliation |
| [`docs/revenue-reporting.md`](docs/revenue-reporting.md) | Revenue reporting |
| [`docs/email-reminders.md`](docs/email-reminders.md) · [`docs/email-verification.md`](docs/email-verification.md) | Study reminder email, email verification |
| [`apps/ai-service/README.md`](apps/ai-service/README.md) · [`apps/judge-service/README.md`](apps/judge-service/README.md) | The two Python services |

## Related repositories

- **codementor-frontend** — three Next.js applications: learner, lecturer and admin.
- **codementor-infra** — PostgreSQL schema, MongoDB, Keycloak and the data host stack.
