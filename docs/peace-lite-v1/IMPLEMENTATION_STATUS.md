# Peace Lite V1 implementation status

**Branch:** `feat/peace-lite-v1`
**Specification:** `TECHNICAL_SPEC.md` v1.0-draft
**Status:** L1 in progress. Guest provisioning and scoped API routing are implemented and validated in a disposable PostgreSQL/browser run; invitations, recovery, true profile-level E2E, and access revocation remain open.

## Current checkpoint

- Implemented: additive L1 identity/world schema migration; deterministic starting-world factory; hashed guest sessions; transactional guest account/world/owner provisioning; `/api/auth/guest` and `/api/me`; world resolution for legacy-compatible read/command paths; per-world command idempotency; sector ownership follows each world seed; client attempts automatic guest login without showing the pairing-key UI.
- Last green source checkpoint: `b409889`. Pending disposable-DB harness/evidence changes also pass all checks and are ready for a checkpoint commit.
- `npm run test:peace:v2`: 262 passed, 1 skipped. `npm run typecheck`: passed. `npm run build:peace:v2`: passed with the existing >500 KB client chunk advisory.
- Applied all 16 migrations (including `0016`) to new disposable DB `avanpost_v2_lite_test_20261107`. Real Chromium UI auto-login + reload restoration passed LITE-E2E-01 with DB/resource assertions and screenshot/trace evidence. LITE-E2E-02 is `PARTIAL`: two distinct cookie hosts in two tabs got isolated accounts/worlds and forged world selection returned only the caller's world; these were not separate browser profiles and full browser foreign-write denial was not exercised.
- Server tick polling is restricted to worlds with a recently active session (10-second activity window, max 100 worlds per poll); inactive worlds catch up on access. The tick-lease table is not yet wired into the scheduler.
- Remaining single-world compatibility routes still use `peace-home` for existing V2 paired sessions; Lite guests are routed by membership. This compatibility path must not become a Lite default.
- No production database has been accessed or modified.

## L1 gap-check

| Requirement | Existing state | Status |
|---|---|---|
| Guest accounts and persistent sessions | Lite guest sessions are account-bound, hashed, HttpOnly and survive reload | Implemented; browser LITE-E2E-01 PASS |
| Independent accounts and worlds | Lite accounts provision isolated UUID worlds; route uses session membership | Implemented; LITE-E2E-02 PARTIAL |
| World membership and roles | Owner at provisioning; editor/viewer schema and viewer write denial exist, but invitations and role-management APIs are absent | Partial |
| Email recovery / magic links | No account identity or email-link flow | Missing |
| Invitations and revocation | No world invitation or membership API | Missing |
| Per-world command idempotency | Lite command log is keyed by `(world_id, request_id)` and records actor | Implemented, unit tested |
| Per-world simulation | Tick/persistence accepts world ID; active sessions are polled, with catch-up on access; tick lease is not wired | Partial |
| Isolation | Lite APIs resolve world through current active membership; tested two accounts and forged query ID | Partial; separate profiles and full foreign-write E2E remain |

## Exact next step

Complete LITE-E2E-02 in two genuinely independent browser profiles and implement world membership/invitations/revocation plus secure email-link recovery. Do not claim L1 complete until isolation and collaboration flows pass.

## Blockers and external conditions

- Production email delivery credentials/domain are external. Local development must use a test mail sink and must not expose magic-link secrets in API responses or logs.
- Physical iOS/Android devices and production deployment are not available in this local implementation checkpoint.
- See `ACCEPTANCE_MATRIX.md`: LITE-E2E-01 is PASS, LITE-E2E-02 PARTIAL, and LITE-E2E-03–24 remain NOT_VERIFIED.
