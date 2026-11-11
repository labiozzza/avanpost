---
name: avanpost-project
description: Safe AVANPOST repository workflow, Peace V2 tests, database isolation, and GDD evidence
---

# AVANPOST workflow

1. Read `AGENTS.md`, `docs/v2/STATUS.md`, `docs/v2/NEXT_ACTION.md`, and relevant acceptance/GDD documents before changing code.
2. Confirm `git branch --show-current`; preserve the requested branch and clean/dirty state. Never switch to `feat/peace-v2-rebuild` due to historical docs.
3. Use the Linux WSL checkout and `npm ci`. For local PostgreSQL, use only the isolated Compose project `avanpost-peace-v2` and the ignored `.env.v2`.
4. Before database work run `npm run doctor:peace:v2`. Keep `avanpost_v2_dev`, `avanpost_v2_test`, and `avanpost_v2_manual` distinct. Do not reset dev or manual worlds except when the owner explicitly asks to replace the manual fixture.
5. Run `npm run typecheck`, `npm run test:peace:v2`, `npm run build:peace:v2`, and `npm run check:peace:v2:source-map`, `npm run check:peace:v2:contracts`, `npm run check:peace:v2:status` as relevant. Run only the Playwright suite/scenario needed and record skips/failures accurately.
6. For hands-on browser checks use the local manual API/client and Chromium. Confirm API health database identity and Phaser canvas. Pair using the loopback handoff; do not expose one-time codes in chat, logs, or Git.
7. Keep GDD mechanics unchanged for environment/test work. Escalate ambiguous product decisions; do not start the next gameplay gate before the current handoff is complete.
8. Keep secrets out of output and Git; never use `git reset`, force push, merge, deploy, or remove Docker volumes.
