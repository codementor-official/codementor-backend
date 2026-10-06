# Commerce consistency audit

Audit date: 2026-10-05. Scope: harden the existing commerce flow, not replace it.

## Current Flow

Course price/promotion → approved catalogue → order/payment → authenticated gateway evidence → journal + revenue split + access grant + notification outbox → gateway query → hold release → reserved withdrawal → payout result.

Learning service owns the flow. PostgreSQL transactions, advisory locks, unique journal event keys and an immutable ledger already protect money operations. Defaults remain unchanged: instructor 80%, platform 20%, instructor rounded down using integer arithmetic and platform receives the remainder; income held for 7 days. Orders snapshot this policy.

## Issues Found

### Critical

- Returning a previously published course to editing could allow a price write to become active immediately.
- Course moderation and approval of the proposed price committed separately, risking partially applied decisions.

### High

- Promotion proposals lacked price-version/configuration linkage. Approval could use a different price than the proposal.
- Orders kept their final amount and split but not the original price, discount or promotion snapshot.
- Reconciliation could treat evidence conflicting with an earlier successful payment as an innocuous duplicate.
- Duplicate provider references were not consistently quarantined before deduplication.

### Medium

- VNPAY IPN responses did not distinguish verified duplicates, amount mismatch and missing payment.
- A payout adapter exception did not explicitly preserve an unknown result state.
- UI validation used the active price even when editing a joint price/promotion proposal.

## Recommended Changes / Implementation Plan

1. Add migration `0037_commerce_consistency.sql`, preserving existing financial history. Keep unknown historical pricing snapshots NULL rather than inventing past prices.
2. Keep published prices active until approval. Link promotion drafts to a pending configuration and active price version. Approve/reject linked changes within the same transaction as course moderation. Price changes invalidate outdated proposals. Independent proposals cannot be approved against a pending price.
3. Lock shared course configuration during checkout and moderation. Store immutable original price, discount, final price, price version and promotion (including its timestamp version) in each new order.
4. Verify gateway identity, signatures, exact integer amounts, and references. Record immutable reconciliation issues; suspicious results do not create extra revenue or remove ledger history. Hold income until successful reconciliation resolves the discrepancy.
5. Keep reserved withdrawal funds when sending times out. Do not automatically resend an uncertain payout; final failure releases the reservation once.
6. Surface linked approval and historical price snapshots in the existing frontend screens and printable/exportable documents.

## Tests Required / Added

- Returned courses retain active pricing; joint approval/rejection; independent approval cannot cross pending/version changes; concurrent approvals apply once; failing course persistence rolls back pricing/promotion too.
- Checkout reads active pricing; changed catalogue cannot change an existing order snapshot; database trigger rejects financial-term mutations.
- Concurrent checkout/payment and duplicate/out-of-order callback; amount/reference mismatch; unknown transaction audit; contradictory reconciliation blocks hold release; verified recovery releases it.
- Revenue split and rounding; immutable balanced journals; entitlement and notification outbox idempotency.
- Insufficient/duplicate/concurrent withdrawals; successful/failed/unknown payout; thrown timeout does not resend or free held funds; refunds retain reversal history.
- VNPAY and MoMo signature/tampering/merchant checks; unsafe/fractional amounts; MoMo query identity/amount/reference mismatches; timeout; signed checkout response validation.

Tests use a dedicated loopback PostgreSQL cluster, not EC2 or production databases. Provider responses in unit tests are simulated; these tests are **not** merchant-connected sandbox certification or browser live tests.

Verification: 56 tests passed across commerce integration, provider verification and recommendation-visibility regression suites; backend TypeScript and all Node-service builds passed; all three frontend production builds and workspace typecheck passed. Lint passed with existing warnings (no errors). Migration 0037 was applied and rerun successfully on the isolated database; the test cluster was stopped afterward.

## Remaining integration gaps

- `MockPayoutAdapter` is still the configured payout adapter. Withdrawal bookkeeping is tested, but no actual bank/MoMo/VNPAY transfer is initiated.
- Reconciliation queries known internal orders. Unknown transactions received by authenticated callbacks are audited, but discovering transactions appearing only in a gateway settlement statement needs a statement/report feed. That integration is not currently configured.
- Real VNPAY/MoMo merchant credentials are required for end-to-end sandbox validation. Payment return URLs alone never confirm orders.
- Refunds are full refunds with compensating ledger entries. Partial refunds and automated retry of a conclusively failed refund are outside this request; uncertain refunds are queried using the existing reference.
- Reconciliation after funds were already released does not silently rewrite historical balances; it records a discrepancy for admin investigation. Never treat a balanced internal ledger as evidence of a bank settlement.

## Gateway contract references

[VNPAY payment/IPN](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html): signature validation and response codes 00/01/02/04/97/99; return URL is not the payment confirmation endpoint.

[MoMo wallet API](https://developers.momo.vn/v3/vi/docs/payment/api/wallet/onetime/): signed create response and IPN fields. [MoMo query API](https://developers.momo.vn/v3/vi/docs/payment/api/payment-api/query/): authenticated HTTPS query with echoed identity/amount checks; the documented query response does not supply an IPN-style signature.

## Production rollout (not executed by this task)

1. Back up the database; review pending proposals and deploy migrations 0036 then 0037 from the infrastructure repo. Do not seed test data into EC2.
2. Deploy the learning service before frontend consumers; migration must precede the backend because queries need the new columns.
3. Review existing pending promotions: legacy proposals remain independent, are not automatically paired with pending prices, and must be resubmitted if their underlying price changed.
4. Validate merchant-connected sandbox payment/refund/IPN and discrepancy handling before enabling real-money collection. Configure and certify a real payout adapter separately.
