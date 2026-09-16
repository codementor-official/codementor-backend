# Email reminders (AWS SES)

## Ownership and data flow

No new microservice, Redis queue or frontend AWS credentials.

Business write → transactional SQL outbox → `evt.reminder.source-changed.v1` →
notification-service planner → PostgreSQL reminder → dispatcher → Mongo in-app notification + SES → delivery log.

Migration `codementor-infra/database/postgres/migrations/0026_email_reminders.sql` owns:

- `notification_reminders`, `email_deliveries`; one unique dedupe key and one delivery record per reminder.
- Read-only `notification_*_context` views for current recipient, membership, assignment and enrollment state.
- Small source-change triggers on assignments, group exercises, submissions, enrollments, membership and user settings.
  These reuse the existing outbox so changes made by database progress triggers are captured atomically too.
- `user_settings.email_preferences` JSON, merged with existing defaults and validated `/me` DTOs.

Core/Workspace/Learning/Submission publish through the existing outbox. They do not import SES.
The former Workspace assignment-scanning scheduler is no longer registered.
Only notification-service scans its indexed due reminder queue, not all assignments.

The reminder consumer starts from the beginning on first deployment and uses replay-safe processing:
the processed marker is written after the idempotent planner succeeds. Existing consumers keep their previous behavior.

## Covered events

| Trigger | Reminder / behavior |
| --- | --- |
| Assignment created | Assigned now; 24h, optional 6h, overdue at deadline + 1 minute |
| Deadline changed/removed | Cancel unsent old schedules; create current ones and a change notice |
| Completed / removed assignment or inactive member | Cancel remaining assignment reminders; dispatcher rechecks source state |
| Failed submission / needs-fix review | One retry reminder after 1h, only if retries are allowed; newer attempts replace unsent retry notices |
| Active course enrollment / lesson activity | One reminder per inactivity period, configurable 1–90 days; renewed activity replaces the old schedule |
| Completed course | Cancel inactivity reminder; completion notice |
| Join approved/rejected | Existing semantic Kafka notification → email |
| Directly added member | Membership source event → in-app + email; no duplicate direct-add email for join approval |
| Admin announcement | Existing authenticated Admin announcement → system-email preference |
| Group chat | Never sends email |
| Saved weekly study calendar | One notice per local day; in-app plus learning email when enabled |
| New Workspace document (pending) | In-app and optional Workspace email to active users with view + approval permissions, excluding uploader |
| Document approved / rejected | In-app and optional Workspace email. Approved: active members with view permission, excluding reviewer. Rejected: uploader only |
| Join request / membership / role change | Owner gets pending requests; active members get join/leave updates; affected user/owner get role changes |
| Assignment reviewed | Immediate in-app feedback; needs-fix also uses the existing retry email schedule |

Migrations `0027_personal_study_reminders.sql` and `0028_workspace_notification_events.sql` extend the existing queue/read views/outbox;
`npm run migrate:email-reminders` applies all three in order. Re-run the Mongo schema migration for the added notification types.
Workspace document events are separate from the AI document pipeline (`ai-service`). No AI processing is needed to notify a group.
Consumers recheck active membership, document status and effective role/member overrides before creating notifications.
Re-publishing the same document does not announce it again. Existing historical documents are not broadcast on installation.
Document email requires both `emailNotifications` and `workspaceEmailUpdates`; `workspaceNotifications` controls the bell only.
Document mail rechecks current membership, effective document permissions and pending/published/hidden/deleted state immediately before sending.
The dispatcher does not create another bell notification for the same document event. This change does not backfill previously consumed document events.

### What each visible switch controls

| Setting | In-app bell | Email |
| --- | --- | --- |
| Workspace activity | Gates all targeted `WORKSPACE_*` notifications, including documents, assignments, member changes and chat | Independent of email options |
| Email master | No effect | Required for every email |
| Assignment email | Workspace switch above | Assigned, deadline changed, retry |
| Deadline email | Workspace switch above | 24h and overdue, only while incomplete |
| Extra 6h | Workspace switch + explicit 6h opt-in | Also requires deadline email |
| Learning email | Calendar has its own saved reminders toggle | Saved calendar, inactivity and course completion |
| Workspace email | Workspace switch above | New approved document, document moderation by permission, join result and directly added member; never individual chat messages |
| System email | Existing Admin announcement | Admin announcement |

Every email also requires an active account and a verified email. SES Sandbox recipient verification is an additional provider restriction,
not the same as Keycloak email verification. `SENT` means SES accepted, not confirmed inbox receipt.

### Weekly calendar semantics

Saved enabled `study_schedule_slots` + `learning_preferences.reminders_enabled` are read every poll (default 60 seconds).
Each weekday's **start time** in the user's IANA timezone is authoritative. The UI's shared time only fills selected days; it is not a second reminder.
The job catches up at most five minutes, including across midnight, never old weeks. A nonexistent DST time is skipped;
an ambiguous repeated time uses PostgreSQL's standard-time occurrence, once per local day.
Changes/cancellation are rechecked before delivery. Once sent that day, moving the slot does not create another send.
The local backend, PostgreSQL and notification-service must be running; a closed laptop cannot deliver a local scheduled reminder.

Verification scripts (development only; isolated fixtures are removed or rolled back):

```sh
node --env-file=.env scripts/verify-study-schedule.mjs
# notification-service must be stopped: the script boots its real consumer, sends only to SES simulator with --ses
node --env-file=.env scripts/verify-email-reminders.mjs --ses
# notification-service must be running: exercise the real SQL outbox -> Kafka -> Mongo document/member flow
node --env-file=.env scripts/verify-workspace-notifications.mjs
```

Workspace has no authored/persisted **important announcement** module/event yet (activity rows have no announcement body).
This change does not invent one or convert ordinary chat to announcements. That producer remains a separate feature;
system announcements are fully connected to the existing Admin producer.

No automatic historical backfill: installing the migration will not email all old demo assignments.
Subsequent source changes schedule current reminders. Overdue reminders older than seven days are not recreated.

## Configuration and deployment

S3 and SES both use `AWS_REGION` and the SDK default credential chain.
Local development reuses `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / optional `AWS_SESSION_TOKEN`.
EC2 can use its attached IAM instance role without any source-code change or static keys.
S3 still keeps its own endpoint/bucket options; they do not affect SES endpoints.

```env
AWS_REGION=ap-southeast-1
SES_FROM_EMAIL=noreply@codementor.cloud
SES_FROM_NAME=CodeMentor
SES_ENABLED=true
CLIENT_APP_URL=https://your-client-domain.example
REMINDER_POLL_SECONDS=60
LEARNING_INACTIVITY_DAYS=3
```

`CLIENT_APP_URL` must be the URL recipients can open; localhost is only for local testing.
Templates reject off-origin CTAs, escape user-authored content, include HTML/plain text and use the user's IANA timezone
(fallback `Asia/Ho_Chi_Minh`). Database timestamps remain UTC.

```sh
npm install
npm run migrate:email-reminders
npm run migrate:notification-schema
npm run db:generate
npx nest build notification-service
npx nest build core-service
npx nest build workspace-service
npx nest build learning-service
# Rebuild any other service consuming changed shared libraries in your deployment.
npm run services -- restart notification core workspace learning
```

Apply migration before starting new binaries; keep the old Workspace scheduler stopped during rollout.
`.env.example` defaults to `SES_ENABLED=false` to prevent accidental sends in a newly cloned environment.
The local environment used for this implementation has SES enabled after simulator verification.
Disabled SES still records in-app notifications and marks email delivery SKIPPED (no surprise backlog upon enabling).

## Preferences and API

- `GET/PATCH /api/v1/me/notification-settings` (alias of existing `/me/settings`).
- `GET /api/v1/notifications/reminders?page=1&limit=20` (max 100; authenticated user only).
- No arbitrary email-send or public test endpoint.

Settings: existing `emailNotifications` master switch and `learningReminders`, plus
`assignmentNotifications`, `deadlineReminders`, `deadline6hReminders` (default off),
`workspaceEmailUpdates`, `systemAnnouncements`, `learningInactivityDays`.
The Client exposes these in Profile → Settings. Weekly digest is not advertised because no weekly-digest job exists.
The dispatcher requires an active user with a verified email and checks preferences immediately before sending.
Turning email off does not disable the separate in-app channel.

## Delivery semantics / operations

- Workers claim due rows with `FOR UPDATE SKIP LOCKED` and a fencing token.
- Scheduling uses per-user/entity/type advisory locks and validates current source versions.
- Global PostgreSQL rate gate: at most one send per 1.1s (safe for current SES Sandbox quota).
- Explicit throttling/limit rejection: exponential backoff 60s, 120s, 240s; at most 3 total attempts.
- Permanent rejection (invalid sender, Sandbox unverified recipient, missing IAM permission): FAILED, no endless retry.
- Timeout, unknown response or 5xx: delivery UNKNOWN, no automatic resend.
- A crashed worker that has not started sending can be reclaimed after 5 minutes.
  A crash after send began is UNKNOWN and requires manual provider-side investigation.
- Cancellation prevents unsent work; an email already accepted by SES cannot be recalled.
- SENT means **SES accepted the request**, not inbox delivery. Bounce/complaint ingestion and automatic suppression
  are not part of this version; configure SES account suppression/monitoring before production volume.

SES SendEmail provides no request idempotency token, so exactly-once external email delivery cannot be guaranteed.
The conservative UNKNOWN state avoids blindly duplicating an email after ambiguous acceptance.
Do not reset UNKNOWN to PENDING without investigating provider delivery.

Diagnostic SQL (recipient addresses are personal data; do not expose these queries via public endpoints):

```sql
SELECT status, count(*) FROM notification_reminders GROUP BY status;
SELECT status, error_message, count(*) FROM email_deliveries GROUP BY status, error_message;
SELECT id, type, scheduled_at, retry_count FROM notification_reminders
 WHERE status='FAILED' ORDER BY updated_at DESC LIMIT 50;
```

## AWS verification on 2026-09-02

- SES region ap-southeast-1, sending enabled, **Sandbox** (`ProductionAccessEnabled=false`).
- Domain codementor.cloud verified; DKIM SUCCESS.
- Quota 200 messages/day and 1 message/second.
- Two real reminder emails accepted for `success@simulator.amazonses.com` using existing local AWS credentials.
- EC2 13.214.122.227 IMDSv2 `/iam/info` returned 404: no attached instance profile was discoverable.
  No IAM role, credentials, or S3 permissions were changed. Attach an approved instance role for production.
- Sandbox recipients must be verified identities (or SES mailbox simulator). Application-user email verification
  is not the same as SES recipient verification. Request SES Production Access to send to ordinary users.

Example scoped policy to add to the approved backend role/user, retaining its S3 permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["ses:SendEmail", "ses:SendRawEmail"],
    "Resource": "arn:aws:ses:ap-southeast-1:YOUR_ACCOUNT_ID:identity/codementor.cloud",
    "Condition": {"StringEquals": {"ses:FromAddress": "noreply@codementor.cloud"}}
  }]
}
```

## Verification commands

```sh
npm run test:reminders
npm run verify:ses                    # read-only account/domain checks
# Stop notification-service first; the verifier boots the real service context.
npm run verify:email-reminders        # real PostgreSQL/Kafka/Mongo; recording email transport
npm run verify:email-reminders -- --ses # two real simulator emails, never real recipients
```

The integration script uses a private fixture Workspace, cleans only its own records, preserves demo users,
checks assignment/deadline notices, duplicate replay, deadline replacement, completion cancellation,
persisted opt-out, course inactivity/completion, bounded retry, ambiguous acceptance and chat exclusion.
It intentionally dispatches only fixture reminders rather than running the scheduler across existing users.

Live Client check: Owner login → disable deadline email / choose 7 days → Save → Reload → DB confirms settings.
Original Owner settings restored after testing. No password reset or broad account changes.

References: [SES SendEmail API](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html),
[SDK default credentials](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-credential-providers.html).
