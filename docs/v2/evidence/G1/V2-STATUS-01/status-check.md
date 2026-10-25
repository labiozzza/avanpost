# V2-STATUS-01 evidence

- Command: `npm run check:peace:v2:status`
- Exit code: 0
- Output: `STATUS_CHECK: PASS fields=14 playable=NO urls=unverified gate=G0-pass/G1-in-progress`
- Assertions: all 14 required status fields exist; G1 remains in progress; no client/phone URL or Stage I auto-QA pass is claimed; the next-action file preserves the G1→G2 gate.
- Source files: `docs/v2/STATUS.md`, `docs/v2/NEXT_ACTION.md`, `scripts/check-peace-v2-status.mjs`.
- Commit anchor: `87b463a`; this is a static status-contract check, not gameplay evidence or a gate PASS.
