# Peace Lite V1 implementation status

**Branch:** `feat/peace-lite-v1`
**Specification:** `TECHNICAL_SPEC.md` v1.0-draft
**Status:** L1 in progress. The first schema and world-provisioning building blocks are implemented; guest login and browser acceptance are not.

## Current checkpoint

- Implemented in the current uncommitted checkpoint: additive L1 identity/world schema migration, migration-contract test, deterministic starting-world factory, and starting-world tests.
- Last green source checkpoint: `c51eb4fad5e2401ecea750e677dd1d1ec865fb3e` (specification-only baseline). Current implementation checks are green but have not yet been checkpoint-committed.
- `npm run test:peace:v2`: 257 passed, 1 skipped. `npm run typecheck`: passed. `npm run build:peace:v2`: passed with the existing >500 KB client chunk advisory.
- SQL was not applied to a database. Browser/API E2E has not run. The migration test currently checks schema contract text, not PostgreSQL execution.
- Existing code is still Peace V2: one hard-coded `peace-home`, pairing-only session creation, global command-idempotency key, and a single-world tick path.
- No production database has been accessed or modified.

## L1 gap-check

| Requirement | Existing state | Status |
|---|---|---|
| Guest accounts and persistent sessions | `peace_v2_sessions` stores only token hash and expiry; `/api/session` requires a runtime pairing code | Missing |
| Independent accounts and worlds | `WORLD_ID = 'peace-home'` is hard-coded in `apps/server-v2/src/server.ts`; seed helpers also use the singleton | Missing |
| World membership and roles | No owner/editor/viewer membership model | Missing |
| Email recovery / magic links | No account identity or email-link flow | Missing |
| Invitations and revocation | No world invitation or membership API | Missing |
| Per-world command idempotency | `peace_v2_command_log.request_id` is globally unique, not scoped by world | Missing |
| Per-world simulation | Simulation timer and persistence target the singleton world | Missing |
| Isolation | No world authorization boundary exists beyond the pairing session | Missing |

## Exact next step

Connect the additive schema to server-side guest/session/world resolution and multiworld persistence/ticking without modifying existing V2 tables or any existing database. Then run the migration against a newly created Lite disposable database and prove two-account isolation in a real-browser flow before claiming L1 complete.

## Blockers and external conditions

- Production email delivery credentials/domain are external. Local development must use a test mail sink and must not expose magic-link secrets in API responses or logs.
- Physical iOS/Android devices and production deployment are not available in this local implementation checkpoint.
- All Lite E2E cases are currently `NOT_VERIFIED`; see `ACCEPTANCE_MATRIX.md`.
