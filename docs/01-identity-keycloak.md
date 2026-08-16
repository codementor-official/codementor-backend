# Identity and authorization with Keycloak

Keycloak owns login, credentials, tokens, and realm roles. `core-service` is the existing
user-profile owner, so its Identity context provides the user-service capability instead of
introducing another deployment unit with overlapping database ownership.

## Request flow

```text
Admin Next.js -> Keycloak Authorization Code + PKCE -> access token
Admin Next.js -> core-service Authorization: Bearer -> JWKS verification
core-service  -> users.external_id = token.sub -> application profile
```

The backend does not expose login, refresh, or password endpoints and never stores passwords.
JWT verification validates the RS256 signature, issuer, expiry, and `codementor-api` audience.
Signing keys come from the realm JWKS endpoint and are cached by `jwks-rsa`.

## Actors and roles

Guest means no access token. Public endpoints must use `@Public()` explicitly.

Keycloak realm roles are uppercase and are the authorization source of truth:

```text
STUDENT
LECTURER
ADMIN
AI_AGENT
```

The existing PostgreSQL `platform_role` enum is only a profile/query projection:

| Keycloak | Database projection |
| --- | --- |
| `STUDENT` | `learner` |
| `LECTURER` | `mentor` |
| `ADMIN` | `admin` |

Controllers authorize with `@Roles(UserRole.ADMIN)` and the global `RolesGuard`. Missing or
invalid authentication returns 401 through Passport; a valid token without a required role
returns 403. `AI_AGENT` is accepted as a service identity only and is never provisioned into
the human `users` table.

## Profile provisioning and API

Human identities are provisioned just in time. `users.external_id` stores the Keycloak `sub`
and remains unique; `users.id` stays the application UUID referenced by domain tables.

```text
GET   /api/v1/users/me
GET   /api/v1/users                 ADMIN
POST  /api/v1/users                 ADMIN
PATCH /api/v1/users/:id/role        ADMIN
PATCH /api/v1/users/:id/status      ADMIN
GET   /api/v1/users/ai-agent/ping   AI_AGENT
```

Admin operations go through `KeycloakAdminService`. It obtains a service-account token for
`codementor-user-service`; human admin credentials never appear in backend configuration.
Normal authenticated requests use JWT claims and do not call the Keycloak Admin API.

## Environment

```env
KEYCLOAK_URL=http://keycloak-host:8080
KEYCLOAK_REALM=codementor
KEYCLOAK_ISSUER=http://keycloak-host:8080/realms/codementor
KEYCLOAK_AUDIENCE=codementor-api
KEYCLOAK_USER_SERVICE_CLIENT_ID=codementor-user-service
KEYCLOAK_USER_SERVICE_CLIENT_SECRET=
```

The browser receives only the Keycloak URL, realm, public client ID, and API URL. Service
account secrets are backend-only.

## AI Agent

`codementor-ai-agent` uses `grant_type=client_credentials`. Its service account owns only the
`AI_AGENT` realm role. An endpoint must opt in explicitly with `@Roles(UserRole.AI_AGENT)`;
authentication alone never grants access to ADMIN endpoints.

Infrastructure configuration and DEV identity creation live in
`codementor-infra/docker/scripts/configure-codementor-realm.sh`.
