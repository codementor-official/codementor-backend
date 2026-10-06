# VNPAY reconciliation recovery (2026-10-06)

## Behavior

- PostgreSQL `commerce_provider_query_leases` atomically leases each payment for six minutes. Manual refresh, jobs and refund queries share this gate across instances and restarts. Failed/time-out requests retain the lease.
- Unsigned error envelopes (94/91/97/99) never constitute payment evidence. They produce 429/503 diagnostics, not generic HTTP 500 or a success state.
- Successful queries must pass HMAC, merchant and payment-reference verification before financial updates.
- IPN responses use HTTP 200 with VNPAY protocol codes (00, 01, 02, 04, 97, 99). Invalid requests do not apply financial changes.
- Authenticated `vnp_PayDate` distinguishes a delayed confirmation from a late payment. Existing access, cancelled/failed orders, malformed dates, and genuinely late payments retain review protections.

## Migration and rollout

Apply only `0038_vnpay_query_throttle.sql` for this isolated hotfix; it is additive and independent of the unfinished consistency-audit migration 0037. Apply before starting the updated service. Do not run all pending migrations against production blindly.

The EC2 hotfix artifact was built from source commit 1126cef with only VNPAY recovery changes, using the existing runtime image/dependencies. Other uncommitted commerce audit changes were not deployed. Release assets are under `/opt/codementor-backend/releases/vnpay-hotfix-v2-20261006`. The repository checkout itself remains unchanged; the runtime hotfix is not a Git deployment.

Rollback image: `codementor-learning-vnpay-base:20261006`. Keep the additive lease table when rolling back. Use the saved `compose.vnpay-rollback.yml` with the ordinary compose and EC2 overlay to recreate only learning-service. A future ordinary build/deploy must include this source fix or it will replace the runtime hotfix.

## Verification

- 25 provider/throttle/IPN/date unit tests passed; isolated deployment build and local learning-service build passed.
- Original sandbox order `1ad065a7-6069-4938-b48c-55891a82f715` (10,000 VND) recovered through a genuine signed query response: provider response/status 00, signature/merchant/reference verified, database paid/succeeded, purchase entitlement present.
- Public invalid IPN returns protocol 01 / HTTP 200. Repeated client refresh returns 429 without contacting VNPAY again during the lease.
- Fresh sandbox order `a84b9413-7167-4bbe-bc50-bc2fb83feb5f` (90,000 VND) completed through NCB/OTP after IPN registration. Gateway logs show a signed request from VNPAY GATEWAY/2.0 for its payment reference, HTTP 200. Database paid/succeeded and purchase entitlement present; client renders payment successful and the learning link.
- Fresh order was subsequently reconciled by the background job with `reconciled_at` 2026-10-06T13:45:42.083Z. The original order reconciled at 13:39:42.054Z. Both therefore passed settlement confirmation as well as entitlement checks.
- No manual paid flag, fabricated callback, refund, payout, course-price change or real-money collection was used.
- Lecturer earnings and Admin commerce tables were rechecked after production login: both new orders appear as paid, with income pending until the existing seven-day hold (13 October). The existing current policy is 100% instructor, unchanged by this fix. Historical orders retain their original 80/20 split. Each payment has exactly one journal; buyer/instructor outbox notifications are published.

Credentials remain in ignored environment files; reports and provider verification logs contain no API keys, signatures or raw callback payloads.
