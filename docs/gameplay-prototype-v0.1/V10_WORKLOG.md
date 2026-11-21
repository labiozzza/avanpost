# AVANPOST v1.0 implementation worklog

Date started: 2026-11-20
Branch: `feat/gameplay-prototype-v0.1`
Starting HEAD: `9d61f5360afaa727157213009d234f01b5c901ee`

## Baseline

- App TypeScript check: PASS.
- E2E TypeScript check: PASS.
- Gameplay prototype unit tests: PASS, 109/109 across 7 files.
- Production build: PASS; Vite warns that the Phaser bundle is about 1.35 MB after minification.
- PWA artifacts: PASS (manifest, 3 icons, service worker, 14 game assets).
- Full browser suite: NOT RUN as a baseline.
- A first sandboxed unit/build attempt failed because Vite could not spawn its Windows helper (`spawn EPERM`); the same checks passed with subprocess execution permitted.

Existing untracked files from earlier work are being preserved and excluded from implementation commits unless the v1.0 task explicitly requires a file.

## Work stages

- [x] P0 land geometry, cell states, planning grid and placement previews.
- [x] P0 roads: placement, physical material delivery, construction, travel speed, removal and persistence.
- [ ] P0 production priorities, manual construction controls, source quotas and storage reservations.
- [ ] P1 event journal with filters and bounded persisted history.
- [ ] P1 waiting/building feedback and mobile layouts.
- [ ] P0 offline catch-up parity and responsive long-absence processing.
- [ ] P0 balance tuning and measured gameplay cycles.
- [ ] Automated browser, migration, offline reload and visual acceptance.
- [ ] Independent QA, fixes and final report.
- [ ] Updated launch guide, stage commits, push and CI review.

## Current state

Stage 1 is implemented in the working tree. `apps/gameplay-prototype/src/land-grid.ts` is the shared source for contiguous world bounds, stable IDs, physical cell numbers, hit testing, scene overlays and building placement. Legacy save coordinates remain unchanged; v4→v5 migration preserves existing land state and reserves the stone source. The grid has off, borders and planning modes; selecting a building previews it and requires an explicit confirmation.

Stage 2 is implemented in `apps/gameplay-prototype/src/roads.ts` and the prototype simulation. A road occupies surface space without reserving a building cell, requires confirmed placement and physical delivery of materials, accelerates only travel on its segment, persists through saves, and can be removed with partial materials left as a ground stockpile. Invalid placement reports closed land, overlap, building clearance, or capacity limits. The road render layer now draws above the ground while remaining below residents and stockpiles.

Reviewed the stage-1 and road screenshots under `evidence-v1.0/`. Grid labels follow visible left-to-right order while stable cell IDs remain unchanged. The completed-road frame shows the segment in the scene, and the construction-order frame shows its visible progress bar.

Current checks: prototype unit tests 121/121 PASS across 9 files; app and E2E TypeScript checks PASS; production build PASS with the existing Phaser bundle-size warning (about 1.36 MB minified); targeted Chromium grid/placement test 1/1 PASS; road placement, delivery, construction, persistence, selection and removal test 1/1 PASS on `127.0.0.1:4176`. The browser tests recorded screenshots under `evidence-v1.0/`. The local sandbox initially blocked Vite's helper process with `spawn EPERM`; checks passed when subprocess execution was permitted. No independent QA has been performed. Other v1.0 stages have not started.
