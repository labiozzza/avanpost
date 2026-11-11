---
name: avanpost-project
description: Safe AVANPOST Peace Lite V1 MVP-SLICE workflow, database isolation, and GDD evidence
---

# AVANPOST Peace Lite MVP-SLICE workflow

1. Read `AGENTS.md`, the task, `Avanpost_GDD_v0.9.md`, and `docs/peace-lite-v1/TECHNICAL_SPEC.md`. Treat `MVP_SLICE_PLAN.md`, `MVP_SLICE_STATUS.md`, and `MVP_SLICE_ACCEPTANCE.md` as the active slice records once created. `docs/v2/*` is historical engine/regression evidence, not the active gate list.
2. Confirm the checkout is the fixed task branch `setup/peace-v2-dev-environment` at the reviewed start SHA. Preserve the branch and clean/dirty state; never switch, rebase, or merge branches.
3. Use the approved clean clone/checkout and committed lockfile (`npm ci`). Never alter the original checkout's untracked evidence/artifacts. Follow the global review-cycle before/after code, test, API, DB, dependency, or configuration changes.
4. Before any database operation run `npm run doctor:peace:v2`, then independently verify DB name/host/identity. Use only a newly named disposable MVP database. Never target V1, `avanpost_v2_dev`, `avanpost_v2_manual`, or any previous acceptance/manual DB; no volume removal.
5. Keep the existing V2 simulation and APIs; no parallel simulator. Extend seven-SKU state/persistence additively and prove conservation, reservations, idempotency, old-save compatibility, and per-world isolation. Never fake output, auto-deliver, or mutate economic state from the client.
6. Work through M0–M7 in order. Keep the intermediate MVP scope distinct from full Lite V1; optional physical-device, mail-provider, PWA, or art generation gaps are recorded honestly and must not block safe unrelated work.
7. Run relevant typecheck, `npm run test:peace:v2`, production build, contracts/source-map/status checks, and real UI/browser tests. Record actual PASS/FAIL/SKIPPED/NOT_VERIFIED, commit SHA, DB identity, and retained evidence; no old status or unit-only run can establish acceptance.
8. For live checks use desktop Chromium and mobile emulation, ordinary UI interactions, and a disposable DB. Confirm API DB identity; never expose pairing codes, magic links, passwords, or tokens.
9. Keep credentials out of logs/Git. Never run V1 commands, reset persistent user DBs, force-push, rewrite history, merge, deploy, or delete Docker volumes.
