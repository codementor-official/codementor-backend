# Passwords: forgot, reset and change

All on CodeMentor's own pages; Keycloak keeps the credentials but none of its pages are shown.

| Flow | Where | Backend |
| --- | --- | --- |
| Forgot | client `/forgot-password` (linked from client, lecturer and admin sign-in) | `POST /system/password-reset/request` (public) |
| Reset from email | client `/reset-password?token=` | `POST /system/password-reset/check`, `POST /system/password-reset` |
| Change | Settings in client, lecturer and admin | `POST /me/password` (signed in) |

- **Reset link**: stateless token `base64url(keycloakId).expiresAtMs.HMAC`. The HMAC key is derived
  from `KEYCLOAK_USER_SERVICE_CLIENT_SECRET` and covers the password credential's `createdDate`,
  so a link lasts 30 minutes and dies as soon as the password changes. notification-service
  emails it (`cmd.identity.password-reset-email.v1`) and never sends an expired one.
- **Change** needs the current password, checked by a password grant on `codementor-user-service`
  (so that client has *Direct access grants* on); the session it opens is closed at once and
  wrong tries count toward the realm's brute-force lockout. Accounts with no password (Google /
  Facebook only) are sent to the reset flow. Both reset and change sign the account out everywhere.
- Realm `codementor` has `resetPasswordAllowed: false`, so Keycloak's own reset page is closed.
- Limits are in memory per core-service instance: 1 reset email per address per minute,
  10 requests per IP per hour, 30 checks/resets per IP per 10 minutes, 5 changes per account per 15 minutes.
