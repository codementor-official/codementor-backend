# Recommendation phase one

Implementation status: 2026-09-03, reconciled with upstream f095c95 / frontend 60b6268.
This is deterministic, database-backed ranking with rules plus local TF-IDF/cosine,
not an LLM or collaborative-filtering model. Python document RAG is a separate service.

## Behavior

- The existing authenticated recommendation endpoints remain the source of ranked
  roadmaps, courses, exercises, articles and public study groups.
- Client course, roadmap and practice catalogues now display recommendations on
  the unfiltered first page. Article and group recommendations use the same
  loading/error/retry and preference-revalidation behavior.
- Course and workspace catalogues accept an optional comma-separated `ids`
  query (1–20 UUIDs). IDs narrow the existing authorized query; they never bypass
  publication, privacy or membership scope. This hydrates the actual recommended
  records instead of intersecting them with the first 100 courses / 12 groups.
- The Client preserves recommendation order and drops records that become
  unavailable between ranking and hydration. It does not restore stale records.
- Personalization uses completed preferences or existing learning history (exercises,
  enrollments and saved articles). Explicit `adaptiveRecommendations=false` wins:
  neither personal tag history nor content history is loaded for scoring. Without
  usable signals, ranking falls back to popularity. Membership/enrollment/completion
  exclusions still avoid recommendations to repeat an existing action.
- Upstream recommendation frames retain four-card grids, detail-page exclusions and
  personalized Explore sections. Local retry, account/preference invalidation and
  ID-based course/group hydration are preserved; duplicated recommendation sections
  from the merge were removed. New seed scripts were pulled but not executed.
- An empty unjoined-group candidate set remains empty; it does not fall back to
  groups already joined. Other catalogues retain their previous seen fallback.
- Source exercise tags must be published/public; article tags must be published.
- A saved preference revision or changed authenticated account reloads Client
  recommendations and discards earlier in-flight results.

No migrations, database reseeding, external AI calls or provider charges were
required for this recommendation merge. Python AI Tutor/document RAG is documented in
`apps/ai-service/README.md`; real AI exercise-studio generation is still separate work.

## Automated checks

Backend:

```powershell
npm test -- --runInBand --testPathPatterns=recommendation
npx tsc --noEmit
npx nest build recommendation-service
npx nest build learning-service
npx nest build workspace-service
```

Frontend:

```powershell
bun apps/client/src/features/recommendations/ranked-items.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

Tests cover ranking, opt-out, group exclusions, bounded ID validation, scope query
construction and frontend hydration. Repository tests inspect constructed queries;
they do not substitute for database-backed integration tests.

The full frontend lint currently reports three existing errors in
`features/reports/report-button.tsx`; lint for this change's files passes.

## Remaining live verification

Docker was stopped during implementation, so authenticated browser/database
verification remains pending. After starting local dependencies and services:

1. Sign in and open courses, roadmaps, practice, article recommendations and groups.
2. Save different interests/level in Personalization; revisit recommendations and
   verify rank/reasons against the API response.
3. Disable personalization; verify `personalized:false` and popularity reasons.
4. Switch accounts and verify no previous account's recommendations remain visible.
5. Verify course/group cards follow ranked IDs, including records outside the
   initial catalogue page.
6. Verify private exercises, unpublished courses and private/archived groups are
   absent; joining the last available group must not recommend it again.
7. Temporarily stop recommendation-service, check error/retry states, then restart.
