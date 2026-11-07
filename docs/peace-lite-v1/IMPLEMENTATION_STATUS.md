# Peace Lite V1 implementation status

**Branch:** `feat/peace-lite-v1`
**Specification:** `TECHNICAL_SPEC.md` v1.0-draft
**Status:** L1 in progress. Guest provisioning and invitation/editor/viewer/revocation backend verticals are validated against a disposable PostgreSQL/browser run; account recovery, user-facing invite UI, concurrent valid-action E2E, and true profile-level proof remain open.

## Current checkpoint

- Implemented: additive account/world/session schema; deterministic starting-world factory; hashed guest sessions; transactional guest account/world/owner provisioning; `/api/auth/guest` and `/api/me`; scoped world reads/commands and idempotency; session current-world selection; single-use editor/viewer invitations; invite acceptance and revocation; viewer command denial; private-world fallback when access is revoked; client automatic guest login.
- Last green source checkpoint: `85c909c`. Collaboration/current-world work through migration `0018` is in progress and has passed the current checks; the next commit is not yet created.
- `npm run test:peace:v2`: 264 passed, 1 skipped. `npm run typecheck`: passed. `npm run build:peace:v2`: passed with the existing >500 KB client chunk advisory.
- Applied all 18 migrations through `0018` to new disposable DB `avanpost_v2_lite_test_20261107`. LITE-E2E-01 PASS; LITE-E2E-02 PARTIAL due inability to create a truly separate browser profile in this harness; LITE-E2E-04/05 PARTIAL after real invitation/editor write/revocation browser flows. Evidence is in `docs/peace-lite-v1/evidence/`.
- Server tick polling is restricted to worlds with a recently active session (10-second activity window, max 100 worlds per poll); inactive worlds catch up on access. The tick-lease table is not yet wired into the scheduler.
- Remaining single-world compatibility routes still use `peace-home` for existing V2 paired sessions; Lite guests are routed by membership. This compatibility path must not become a Lite default.
- No production database has been accessed or modified.

## L1 gap-check

| Requirement | Existing state | Status |
|---|---|---|
| Guest accounts and persistent sessions | Lite guest sessions are account-bound, hashed, HttpOnly and survive reload | Implemented; browser LITE-E2E-01 PASS |
| Independent accounts and worlds | Lite accounts provision isolated UUID worlds; route uses session membership | Implemented; LITE-E2E-02 PARTIAL |
| World membership and roles | Owner/editor/viewer memberships, current-world selection, invite acceptance and member revocation endpoints; client UI absent | Partial |
| Email recovery / magic links | No account identity or email-link flow | Missing |
| Invitations and revocation | No world invitation or membership API | Missing |
| Per-world command idempotency | Lite command log is keyed by `(world_id, request_id)` and records actor | Implemented, unit tested |
| Per-world simulation | Tick/persistence accepts world ID; active sessions are polled, with catch-up on access; tick lease is not wired | Partial |
| Isolation | Lite APIs resolve world through current active membership; tested forged read/write IDs and revocation fallback | Partial; separate browser profiles and concurrent command fixture remain |

## Exact next step

Add owner-facing member/invite UI and secure email-link recovery; then complete true separate-profile and simultaneous-command browser tests. Do not claim L1 complete until all L1 flows pass.

## Blockers and external conditions

- Production email delivery credentials/domain are external. Local development must use a test mail sink and must not expose magic-link secrets in API responses or logs.
- Physical iOS/Android devices and production deployment are not available in this local implementation checkpoint.
- See `ACCEPTANCE_MATRIX.md`: LITE-E2E-01 is PASS, LITE-E2E-02 PARTIAL, and LITE-E2E-03–24 remain NOT_VERIFIED.
