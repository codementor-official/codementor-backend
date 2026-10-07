# Reconciliation results and holding policy

Only authenticated Admin POST /api/v1/commerce/admin/jobs/run runs the five stages.
GET is a non-mutating 405 with Allow: POST, never an alternate way to run financial work.
The POST returns a run UUID, timestamps, completed/partial/already_running status, and
per-stage selected/completed/waiting/failed counts with bounded record outcomes.

Completed payment/refund/payout checks mean a verified terminal response, which can
include a decline. Unknown provider answers and quarantined orders remain waiting.
Income counts only committed releases, with available-credit and debt-offset amounts
returned from the existing locked transaction. Neither field is a bank balance or
the net change across every financial action in the batch. Errors do not leak provider
payloads or secrets. Record/stage failures retain successful work in the report.

The remaining income counts are mutually exclusive: refund-blocked, unverified,
holding, or eligible backlog. Null means counts could not be read, NOT zero.
The seven-day payment query window is the reconciliation lookback, not the holding
period, and is unchanged. Existing batch limits, VNPAY cooldown and financial guards
are preserved. Jobs already running in this process do not start a duplicate run.

Holding days are already database-backed in commerce_policy.hold_days (0–90).
Admin PUT /commerce/admin/policy validates and audits the updated policy.
New orders snapshot hold_days at creation; payment confirmation uses the order's
snapshot to set available_at. Updating policy does not recalculate existing orders,
re-release funds or bypass reconciliation/refund safeguards. No migration is needed.

Admin UI explicitly sends POST after confirmation and opens a detailed results modal.
It refreshes operational data, supports reopening the latest result within the current
page and exporting CSV. Financial POSTs are not automatically retried on network errors.
Policy changes show before/after confirmation, including a warning for zero days.

Verification uses isolated unit mocks and browser-intercepted financial commands.
Read-only policy/operational GETs can use the existing EC2 data; no real jobs, payouts,
payments, policy changes or migration should be run just to exercise the UI.

Local verification on 2026-10-07: 51 tests passed across the job reports,
locked income release, holding-policy validation/controller, and existing revenue
range/report regression suites. Admin authenticated in visible Chromium; eight
UI checks covered explicit POST, empty/partial/busy reports, CSV, legacy/503 errors,
policy confirmation/cancel/validation/success/failure, mobile and dark layouts.
Every financial POST/PUT was fulfilled by browser interception without forwarding.
Real read-only GET confirmed the server policy was unchanged and jobs GET returned 405.
Local automatic commerce jobs remained disabled. This does not certify a real payout
or end-to-end provider reconciliation on EC2. Production deployment and health
checks are verified separately from these local tests.
