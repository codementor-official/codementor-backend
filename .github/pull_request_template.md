## Summary

<!-- What changes, and why. Link the issue or report this addresses. -->

## Type of change

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor (no behaviour change)
- [ ] Documentation
- [ ] Chore / tooling

## Services affected

<!-- e.g. core-service, learning-service, judge-service -->

## How it was tested

- [ ] `npm run lint` passes (including architecture boundaries)
- [ ] `npm test` passes
- [ ] `npm run build:all` passes
- [ ] `npm run judge:test` / `npm run ai:test` pass (if a Python service changed)
- [ ] Tested through the gateway (`npm run smoke` or manual requests)

<!-- Describe the manual checks: requests, accounts, expected results. -->

## Deployment notes

- [ ] Needs a schema migration — merged in `codementor-infra`: <!-- link -->
- [ ] Needs new or changed environment variables (listed in `.env.example`)
- [ ] Changes Kafka topics or event payloads (consumers updated, versioned if breaking)
- [ ] Changes Kong routes

## Checklist

- [ ] Each table is written only by its owning service
- [ ] No secrets in code, logs or commits
- [ ] Documentation updated where behaviour changed
