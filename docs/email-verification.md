# Client email verification

- The Client shell warns authenticated users whose `/me.emailVerified` is false.
- Profile (including Settings) shows the current mailbox, status, resend and check-again controls.
- `GET /api/v1/me/email-verification` reads Keycloak and synchronizes the local email verification projection. A browser boolean or redirect parameter never proves verification.
- `POST /api/v1/me/email-verification` sends to the authenticated user's Keycloak subject only. There is no client-supplied recipient, user ID or redirect. Duplicate sends have a 60-second per-user cooldown per core-service instance, including failed/ambiguous sends.
- Verification links are generated/validated by Keycloak (`send-verify-email`), expire after 30 minutes, and return to `${CLIENT_APP_URL}/profile?tab=settings`.
- Already-verified users do not receive another message. Clicking the link requires access to the mailbox; sending alone never verifies the account.

## SMTP setup

In Keycloak **Realm settings > Email**, configure SMTP host, port, From, TLS and SMTP credentials. AWS SES API credentials used by notification-service do **not** automatically configure Keycloak SMTP. Use region-matching SES SMTP credentials (kept only in Keycloak's secret configuration), not an AWS secret key pasted as the SMTP password. SES sandbox recipient restrictions still apply.

Set `KEYCLOAK_EMAIL_VERIFICATION_CLIENT_ID` (default `codementor-web`) to a client whose allowed redirects include `${CLIENT_APP_URL}/profile?tab=settings`. The service account must be permitted to read the user and send verification mail; reading realm configuration lets the UI proactively report missing SMTP.

Do not enable realm-wide `verifyEmail` or add required actions merely to show this warning: those changes can block the existing password-login flow. The explicit verification action works without changing global login policy.

When SMTP is absent the API reports `canSend: false`; the UI explains the blocker and never shows a fake success. After configuring SMTP, wait up to 60 seconds for its availability cache and click **Tôi đã xác thực** to recheck.

After the user follows the email link, returning to Profile or clicking **Tôi đã xác thực** reads fresh state from Keycloak even if the existing access token predates verification. The local projection then permits future email reminders according to saved preferences. Previously skipped reminders are not replayed automatically.

For multi-replica production, replace the process-local resend guard with a shared durable limiter before scaling.

### Reproducible operator setup

Run from `codementor-backend` with Node 24. Backend `.env` supplies AWS/SES, Keycloak URL,
service-client credentials and Client URL; the sibling `codementor-infra/.env` supplies the
current master-realm administrator username/password. These files must remain Git-ignored.

```sh
# Read-only checks; no email is sent.
node --env-file=.env scripts/configure-keycloak-smtp.mjs
# Apply only the realm SMTP fields and test the real Keycloak -> SES SMTP route.
node --env-file=.env scripts/configure-keycloak-smtp.mjs --apply --test-simulator
```

The script derives the region-specific SMTP password from the existing long-lived IAM
credential in memory; it never prints or saves the derived password locally. It requires
existing `ses:SendRawEmail` permission and does not change IAM/S3 or broaden client/service
permissions. It checks the existing Client redirect rather than changing allowed origins.
Use dedicated SES SMTP credentials for independent rotation when moving to production.

The optional simulator test creates a passwordless temporary Keycloak identity, invokes
`send-verify-email` using the actual application service account, then deletes only that
identity. An existing simulator user is not reused or deleted. Keycloak realms configured
to use email as username are supported. Do not rerun a send blindly after an ambiguous timeout.

### Verified configuration — 2026-09-02

- Realm `codementor` on the existing Keycloak server now uses SES Singapore SMTP,
  port 587 with STARTTLS and authentication, sender `CodeMentor <noreply@codementor.cloud>`.
- Saved settings were read back; the Keycloak verification endpoint returned HTTP 204
  after sending to the AWS success simulator. The temporary identity was removed.
- Global `verifyEmail` remains unchanged (`false`); no user was marked verified, no
  password was reset, and no backend/Frontend deployment or restart was needed.
- SES is still Sandbox. A developer recipient identity verification was requested;
  its mailbox owner must click the **AWS** verification link before this address can
  receive CodeMentor mail. This is separate from clicking the subsequent **Keycloak**
  verification link. New ordinary recipients require the same Sandbox setup until
  AWS approves SES Production Access. Previously skipped reminders were not replayed.

References: [Keycloak Admin REST API](https://www.keycloak.org/docs-api/latest/rest-api/index.html),
[SES SMTP credential derivation](https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html).
