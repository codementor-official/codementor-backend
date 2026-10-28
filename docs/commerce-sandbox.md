# Paid courses — sandbox

No real money moves. Commerce operations are blocked when `NODE_ENV=production`.
This rollout does not apply migrations or change IAM/S3 in production.

## Architecture

- Learning Service owns the `commerce` context, the `/api/v1/commerce` API, the PostgreSQL transactions and a job that runs every minute.
- Price, beneficiary, revenue split and holding period are snapshotted when an order is created. VND is stored as integers; the lecturer's share is rounded down and the platform takes the remainder.
- `course_access_grants` distinguishes legacy/free/purchase/manual. The migration keeps access for existing enrollments. A refund revokes only the grant of that order.
- Journals and entries are balanced and made immutable by database triggers. Balances are computed from the ledger; advisory locks protect wallets and checkout, and unique constraints protect idempotency.
- A successful payment, the access grant, the revenue and the notification outbox are written in one transaction. Notification Service consumes `COMMERCE_UPDATED`.
- The VNPAY/MoMo collection adapters are independent from `MockPayoutAdapter`. A refund API is never used as a payout API.
- A timeout keeps the funds on hold; they are released only after a definite failure. Duplicate callbacks do not record revenue or payouts twice. A late or duplicate successful payment for an already-owned course moves to `review` and grants nothing again.
- A refund after a payout creates a debt; future income pays off the debt before it becomes available. Payout history is never rewritten.

## Configuration and migrations

1. Use a local database or a dedicated sandbox database. Never test against the deployed application database.
2. Add the variables from `.env.commerce.example` to your local environment. The default `COMMERCE_MODE=mock` needs no credentials.
3. Apply the infrastructure baseline migrations as described in that repository, then the commerce migrations from `database/postgres/migrations/0032_course_commerce.sql` to `0035_course_promotion_approval.sql`.
4. Optional runner: set `DATABASE_URL` in the shell and run `node scripts/migrate-commerce.mjs`. The runner does not read `.env`, needs `psql` on the `PATH`, refuses remote and production databases by default, and safely skips migrations whose tables already exist.
5. Apply the Mongo notification schema through the existing migration script (`scripts/migrate-notification-schema.mjs`), which includes the `COMMERCE_UPDATED` enum value.
6. Start Learning Service, Notification Service, the outbox/infrastructure and the frontend as usual. The gateway must route the commerce paths.

Before applying on EC2: snapshot PostgreSQL, confirm the target database has no `commerce_orders`
table yet, dry-run both migrations on a schema copy, then open a maintenance window. Never point the
local runner at production with `--allow-remote-sandbox`.

Note that one existing workspace migration depends on a column created by the
`migrate-workspace-content` script; do not blindly apply the whole chain to an empty database. The
commerce tests use a compatible baseline plus migration 0030 on a separate local PostgreSQL.

## Mock demo, from purchase to payout

Run `scripts/seed-commerce-demo.sql` against the local `commerce_test` database to create three
courses at 99,000, 199,000 and 349,000 VND. The script is safe to re-run; if
`lecturer1@test.local` exists, the courses are attached to that account so its learner list and
revenue can be checked in the lecturer app; otherwise an internal demo lecturer is used.

1. Admin opens `/commerce` → Policy. For an immediate demo, set the holding period to 0 days **before creating orders**. The test defaults are 7 days, an 80/20 split, a 100,000 VND minimum payout and manual approval.
2. A lecturer sets a 200,000 VND price on a draft course in the studio and submits it for review. Admin approves the course.
3. Another learner opens the course, buys it, lands on `/purchases/[orderId]` and chooses the successful mock result. Check access and the `/purchases` history.
4. Admin runs the job or waits for it. The lecturer's 160,000 VND moves from pending to available once eligible. The platform's 40,000 VND excludes the amount owed to the lecturer.
5. The lecturer opens `/earnings`, saves a test recipient with code `TEST-DEMO` and requests a 100,000 VND payout. Choose success/failure/pending/timeout to test each path.
6. Admin approves in `/commerce`; the job performs the mock payout. For pending/timeout the funds stay on hold; admin uses the mock result control to finish. A repeated callback does not change the balance again.
7. Admin opens the order and refunds it in full with a reason. Check access, the reversing entries and the debt if the money was already paid out.

The client, lecturer and admin screens provide cover images (with fallbacks), search, filters,
sorting, shared pagination, CSV export and detail modals. Lecturers can set up a bank account, MoMo
or VNPAY; outside the edit form an account number shows only its last four digits.

Access is never granted from the return URL. The frontend always reads the result from the backend.

## Provider sandboxes

Only fully configured methods are shown. Set `COMMERCE_MODE=sandbox`, the local client URL, and an
HTTPS tunnel to the local gateway in `COMMERCE_PUBLIC_API_URL` (including `/api/v1`).

- VNPAY needs `VNPAY_TMN_CODE` and `VNPAY_HASH_SECRET`; IPN is `GET /api/v1/commerce/webhooks/vnpay`.
- MoMo needs `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY` and `MOMO_SECRET_KEY`; IPN is `POST /api/v1/commerce/webhooks/momo`.
- Sandbox refunds are enabled only with `COMMERCE_SANDBOX_REFUNDS=true` and when the partner account has that permission.
- Only fixed sandbox endpoints are called. Real merchant connectivity has not been tested for lack of sandbox credentials; the mock does not prove a provider configuration works.

Official references used for the adapters: [VNPAY payment](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html), [VNPAY query/refund](https://sandbox.vnpayment.vn/apis/docs/truy-van-hoan-tien/querydr%26refund.html), [MoMo payment](https://developers.momo.vn/v3/vi/docs/payment/api/wallet/onetime/), [MoMo query](https://developers.momo.vn/v3/vi/docs/payment/api/payment-api/query/), [MoMo refund](https://developers.momo.vn/v3/docs/payment/api/payment-api/refund/).

## Testing

`COMMERCE_TEST_DATABASE_URL` accepts only a `commerce_test` database on localhost; it never falls
back to `DATABASE_URL`. After creating the local schema, run:

```powershell
$env:COMMERCE_TEST_DATABASE_URL='postgresql://commerce_test@127.0.0.1:55439/commerce_test'
npx jest --runInBand --testPathPatterns=commerce.integration
npx tsc --noEmit --incremental false
npm run lint
npm run build:all
```

Frontend: `pnpm lint`, `pnpm typecheck`, `pnpm build`.
The HTTP end-to-end tests use the real controllers, `RolesGuard`, validation and PostgreSQL
transactions; only the identity boundary is stubbed in the test module. They do not test Keycloak
sign-in or a browser.

## Limits before handling real money

- No real payouts, partial refunds, retries of finally-failed refunds, subscriptions or tax accounting yet.
- While a wallet has a payout on hold, refunds are blocked until that payout is reconciled; a payout with an unknown result is never clawed back automatically.
- Unknown provider fees are shown as unknown; ledger clearing is not treated as a bank balance. The reconciliation dashboard checks internal states and the ledger, not external bank statements.
- Merchant sandboxes, the IPN tunnel, real error responses and refund permissions must be tested with each partner before launch.
- Paid video must live under a private prefix with anonymous GET blocked; set `COMMERCE_PRIVATE_MEDIA_READY=true` only after verifying the bucket/CDN. IAM is never changed automatically. Content that was previously public cannot be protected by hiding a button; move the public sources to private and review embedded links.
- A local browser session was tested for all three roles against an isolated commerce database. Production still needs a smoke test on a copy of the EC2 data and with provider sandbox credentials.
