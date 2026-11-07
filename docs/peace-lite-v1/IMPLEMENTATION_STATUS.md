# Peace Lite V1 implementation status

**Branch:** `feat/peace-lite-v1`
**Specification:** `TECHNICAL_SPEC.md` v1.0-draft
**Status:** L1 in progress. Guest provisioning, email recovery, and invitation/editor/viewer/revocation verticals are validated against disposable PostgreSQL/browser; true profile-level proof, concurrent valid-action E2E, and production email delivery remain open.

## Current checkpoint

- Implemented: additive account/world/session schema; deterministic starting-world factory; hashed guest sessions; scoped world reads/commands and idempotency; current-world selection; single-use editor/viewer invitations and revocation; viewer write denial; private-world fallback; client account recovery and owner invitation/member controls; Resend production adapter plus private local test mailbox; one-use 15-minute email links and hashed-subject rate limiting.
- Last committed source checkpoint: `377e68e` (pushed to `feat/peace-lite-v1`); email recovery and account/member/invite UI are committed.
- `npm run test:peace:v2`: 267 passed, 1 skipped. `npm run typecheck`: passed. `npm run build:peace:v2`: passed; Vite reports the existing >500 KB client bundle advisory.
- Disposable DB `avanpost_v2_lite_test_20261107` now has migrations through `0019`. LITE-E2E-01, 02, 04, and 05 PASS; LITE-E2E-03 PARTIAL (restored across cookie hosts, but not separate physical device; production mail not configured). Evidence is in `docs/peace-lite-v1/evidence/`.
- Server tick polling is restricted to worlds with a recently active session (10-second activity window, max 100 worlds per poll); inactive worlds catch up on access. The tick-lease table is not yet wired into the scheduler.
- Remaining single-world compatibility routes still use `peace-home` for existing V2 paired sessions; Lite guests are routed by membership. This compatibility path must not become a Lite default.
- No production database has been accessed or modified.

## L1 gap-check

| Requirement | Existing state | Status |
|---|---|---|
| Guest accounts and persistent sessions | Lite guest sessions are account-bound, hashed, HttpOnly and survive reload | Implemented; browser LITE-E2E-01 PASS |
| Independent accounts and worlds | Lite accounts provision isolated UUID worlds; route uses session membership | Implemented; LITE-E2E-02 PARTIAL |
| World membership and roles | Owner/editor/viewer memberships, current-world selection, invite acceptance/revocation; owner invite/member UI | Implemented; true-profile UX proof remains |
| Email recovery / magic links | 15-minute hashed one-use links, neutral responses, hashed-subject rate limit, Resend adapter, private local mailbox, account UI | Partial; provider credentials and separate-device acceptance remain |
| Invitations and revocation | Single-use editor/viewer links, owner revocation, private-world fallback; UI can create links and revoke members | Partial; separate profiles and command concurrency remain |
| Per-world command idempotency | Lite command log is keyed by `(world_id, request_id)` and records actor | Implemented, unit tested |
| Per-world simulation | Tick/persistence accepts world ID; active sessions are polled, with catch-up on access; tick lease is not wired | Partial |
| Isolation | Lite APIs resolve world through current active membership; tested forged read/write IDs, revocation fallback, and independent Chromium contexts | Implemented; separate physical-device proof remains |

## Exact next step

Complete invite acceptance/mobile UX, true separate-profile and simultaneous-command browser tests, production Resend setup, then finish remaining L1 requirements. Do not mark L1 complete until the full matrix passes.

## Blockers and external conditions

- Production email delivery credentials/domain are external. Local development must use a test mail sink and must not expose magic-link secrets in API responses or logs.
- Physical iOS/Android devices and production deployment are not available in this local implementation checkpoint.
- See `ACCEPTANCE_MATRIX.md`: LITE-E2E-01/02/04/05 are PASS; LITE-E2E-03 is PARTIAL; LITE-E2E-06–24 remain NOT_VERIFIED.
