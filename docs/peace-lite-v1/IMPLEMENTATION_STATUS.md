# Peace Lite V1 implementation status

**Branch:** `feat/peace-lite-v1`
**Specification:** `TECHNICAL_SPEC.md` v1.0-draft
**Status:** L1 in progress. Guest account/world provisioning and per-world API routing are implemented against test doubles; persistent PostgreSQL and browser acceptance are not verified.

## Current checkpoint

- Implemented: additive L1 identity/world schema migration; deterministic starting-world factory; hashed guest sessions; transactional guest account/world/owner provisioning; `/api/auth/guest` and `/api/me`; world resolution for legacy-compatible read/command paths; per-world command idempotency; sector ownership follows each world seed; client attempts automatic guest login without showing the pairing-key UI.
- Last green source checkpoint: `c51eb4fad5e2401ecea750e677dd1d1ec865fb3e`. Current changes pass unit tests, typecheck, and build and are ready for a checkpoint commit.
- `npm run test:peace:v2`: 261 passed, 1 skipped. `npm run typecheck`: passed. `npm run build:peace:v2`: passed with the existing >500 KB client chunk advisory.
- Guest routes and per-world reads were exercised with a database test double. SQL was not applied to PostgreSQL; no real-browser scenario has run. LITE-E2E-01/02 remain `NOT_VERIFIED`.
- Server tick polling is restricted to worlds with a recently active session (10-second activity window, max 100 worlds per poll); inactive worlds catch up on access. The tick-lease table is not yet wired into the scheduler.
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

Run the additive migration against a newly created Lite disposable PostgreSQL database, add a real-browser two-account test, then implement and test world membership/invitations/revocation and secure email-link recovery. Do not claim L1 complete until the browser isolation and collaboration flows pass.

## Blockers and external conditions

- Production email delivery credentials/domain are external. Local development must use a test mail sink and must not expose magic-link secrets in API responses or logs.
- Physical iOS/Android devices and production deployment are not available in this local implementation checkpoint.
- All Lite E2E cases are currently `NOT_VERIFIED`; see `ACCEPTANCE_MATRIX.md`.
