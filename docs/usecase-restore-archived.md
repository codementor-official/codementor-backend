# Use case: restoring removed content

Test scenario for `restore` — the way out of `archived`, added on 2026-08-17.
It applies to all three content types: **learning paths**, **courses** and **coding exercises**.

## Why this use case exists

`archive` moves content to `archived`, but `submit()` accepts only
`draft | changes_requested | rejected`. Removed content had no way back, and the only way to bring
it back was a direct `UPDATE` in the database — bypassing the very layer built to guard it.

It is worse for `content_status` (courses, learning paths): the enum has no `hidden`, so **an
author who hides their own content also lands in `archived`**. An author who can hide their own
content but never show it again is a trap, not a rule.

## Rules

```
published ──(admin removes)──► archived ──(admin restores)──► draft
                                                                │
                                         (author submits)───────┘
                                                   ▼
                                            pending_review ──(admin approves)──► published
```

Three things must hold:

1. **`restore` goes to `draft`, never straight to `published`.** Content is usually removed for a
   reason; returning it straight to the catalog would be a back door around the reviewer.
2. **`published_at` does not change.** Removing and republishing is not a new release.
3. **Admin only.** `moderate` is `@Roles('admin')`, and the admin is the one who removed it. The
   author's path will be `hidden` — that state is not implemented yet; see the end of this page.

## How to run it

Needs Kong on `:8000`, learning-service on `:3002` and exercise-service on `:3003`.
Accounts: `lecturer1@test.local` and `admin1@test.local`, password `Test1234!`.

```bash
cd codementor-frontend && set -a && . ./apps/client/.env.local && set +a
K="$KEYCLOAK_INTERNAL_URL/realms/$KEYCLOAK_REALM/protocol/openid-connect/token"
tok() { curl -s -X POST "$K" -d grant_type=password \
  -d client_id="$KEYCLOAK_BFF_CLIENT_ID" --data-urlencode client_secret="$KEYCLOAK_BFF_CLIENT_SECRET" \
  -d username="$1" -d password='Test1234!' -d scope=openid \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])"; }

LEC=$(tok lecturer1@test.local); ADM=$(tok admin1@test.local)
G=http://localhost:8000/api/v1

# Replace `roadmaps` with `courses` or `exercises` to check the other two types.
ID=$(curl -s -H "Authorization: Bearer $LEC" "$G/roadmaps/mine?limit=50" \
  | python3 -c "import sys,json;[print(i['id']) for i in json.load(sys.stdin)['data']['items'] if i['slug']=='lo-trinh-frontend']")

status() { curl -s -H "Authorization: Bearer $LEC" "$G/roadmaps/$ID" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['status'])"; }
```

## Steps and expected results

| # | Step | Request | Expected |
|---|---|---|---|
| 1 | Initial state | `status` | `published` |
| 2 | Admin removes it | `POST /roadmaps/$ID/moderate {"decision":"archive"}` | `201`, status `archived` |
| 3 | Gone from the catalog | `GET /roadmaps` | no longer listed |
| 4 | **Author submits from archived** | `POST /roadmaps/$ID/submit` | **422** — cannot submit from `archived` |
| 5 | **Lecturer calls restore** | `POST .../moderate {"decision":"restore"}` with the lecturer token | **403** |
| 6 | Admin restores | `POST .../moderate {"decision":"restore"}` | `201`, status **`draft`** (not `published`) |
| 7 | Restore again | repeat step 6 | **422** — only removed content can be restored |
| 8 | Submit again | `POST /roadmaps/$ID/submit` | `201`, status `pending_review` |
| 9 | Admin approves | `POST .../moderate {"decision":"approve"}` | `201`, status `published` |
| 10 | **Release date** | `SELECT published_at FROM roadmaps WHERE slug=...` | **unchanged** since step 1 |

Steps 4, 5, 7 and 10 are the ones most likely to break — they check that `restore` does not become
a back door, and that the first release stays the first release.

## What has been verified

- **Learning paths:** all 10 steps were run against the real stack, all as expected.
- **Courses and coding exercises:** covered by domain-level specs
  (`roadmap.spec.ts`, `course.spec.ts`, `exercise.spec.ts` — the "remove and restore" cases).
  Not run by hand over HTTP; the path is the same because they share one state machine.

```bash
cd codementor-backend && npx jest --testPathPatterns="(course|exercise|roadmap).spec"
```

## Deliberately not done

**No button in the admin UI.** The moderation screen lists only the review queue
(`pending_review`); `archived` content is not there. A button first needs a way to list removed
content, and no endpoint does that today: `GET /…` is hard-wired to `publishedOnly` and
`GET /…/moderation` to `pendingOnly`. A "removed" queue is separate work, not part of this fix.

**`hidden` still does not exist in code.** It is in the `exercise_status` enum and in the diagram
in `codementor-content-model.md` §8.1, but no service can set it, and the courses/learning-paths
`content_status` does not even have it. That is why an author hiding their own content currently
goes through `archived`. Closing that gap is a separate use case.
