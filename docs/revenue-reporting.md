# Revenue overview

Read-only endpoints: `GET /api/v1/commerce/admin/analytics` (admin) and
`GET /api/v1/commerce/wallet/analytics` (lecturer, restricted to authenticated human ID).
`days` accepts 7, 30 or 90; default 30. Alternatively pass both `from=YYYY-MM-DD`
and `to=YYYY-MM-DD` (inclusive, maximum 366 days). A valid calendar pair overrides
the preset; incomplete, reversed or invalid dates return 400 before querying.
These parameters also apply to the instructor directory, so its sales and charts
use the same period. Current ledger balances remain all-time. No migration required.

Periods are inclusive calendar days in Asia/Ho_Chi_Minh. Paid/refunded orders use
settled_at, other orders use created_at. Missing days have zero values. Aggregation covers
the entire period, not the current paginated history. Daily CSV exports this same period.

Gross includes paid and fully refunded orders. Revenue is the captured instructor_amount
or platform_amount of currently paid orders, before gateway fees. Refunded amounts refer
to this settlement cohort, not refunds executed during this period. This is a current
cohort report, not a cash-flow, bank balance, tax invoice, or available-wallet calculation.
Course reporting includes every course in the period; status counts retain unpaid orders
without adding their amounts to revenue. Changing the policy does not recalculate old splits.

The admin guide and confirmation describe the existing jobs/run workflow: bounded payment
and refund verification, expiration, eligible income release, and previously approved
payout processing. This UI change neither shortens holding periods nor approves requests.
VNPAY query leases continue enforcing their six-minute cooldown.

Deploy learning-service before the frontend consuming these endpoints. Existing wallet,
ledger, authorization and payment flows are unchanged. Do not deploy unrelated dirty changes.

## Local verification (2026-10-06)

Authenticated Admin and Lecturer were tested in visible Chromium against local frontend,
gateway and learning-service, reading the existing EC2 database. No reconciliation job,
payment, payout or database migration was invoked. Local commerce jobs were disabled.
Both period selectors, chart rendering, history tabs, help and CSV downloads worked.
Desktop 1440px and mobile 390px had no horizontal document overflow. Compact currency-axis
labels avoid clipping the full monetary values; tooltips and CSV retain exact amounts.

The legacy EC2 schema lacks the optional commerce_reconciliation_issues table. The summary
now checks table availability and returns null for this diagnostic, not a misleading zero,
while continuing to return existing ledger totals. UI shows an explicit availability notice.
Base analytics require no migration; full new diagnostics require the separate audit migration.

## Dedicated Admin revenue route

Admin `/revenue` is a read-only reporting surface; `/commerce` remains the operational
orders, withdrawal approvals, reconciliation and policy surface. Admin analytics accepts
an optional validated UUID `instructorId`; role enforcement stays server-side. A selected
instructor filters the same cohort while retaining platform-share semantics in the chart.
Instructor earnings are separately named in the profile and directory table.

`GET /commerce/admin/analytics/instructors?days=7|30|90` independently aggregates orders
and ledger entries to avoid join multiplication. Its revenue fields are period-scoped;
pending/available/reserved/paid are all-time ledger balances, not bank balances. Instructors
without purchases remain selectable. This endpoint reads existing tables and requires no
schema migration. Daily and course tables use 10-row pagination; course reporting no longer
silently drops records after the top ten. Directory CSV exports all matched rows.

## Calendar and combined views

Admin and Lecturer share a native calendar picker. Editing a date is a draft until
Apply dates is pressed; CSV continues exporting the applied report. Presets and Reset
clear the custom range. Charts, course totals, instructor totals, printed summaries and
daily CSV all use the returned report bounds. The All view renders every report section
with one summary and one filter bar. Operational history tabs remain separate.
