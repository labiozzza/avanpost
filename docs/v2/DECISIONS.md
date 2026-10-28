# Peace V2 binding decisions

All implementation work remains scoped to the peaceful GDD Stage I. This ledger records accepted product/architecture decisions; it does not mark any implementation or gate complete.

| ID | Decision | Source | Implementation constraint |
|---|---|---|---|
| B1 | Build a new V2 spatial world core and isolated V2 databases; preserve V1 game, saves, schema and database. | User task; master spec §0.2, §2.3, §3.1–3.2 | No V1 imports for config/migrations/runtime; no V1 DB writes |
| B2 | Peaceful world uses strict side-view, Phaser, server-authoritative economics, touch-first portrait PWA. | User task; master spec §0.1, §4, §9–10 | Client renders server snapshots and sends intents only |
| B3 | Work only on peaceful Stage I; exclude PvP, marketplace, crystals, payments and Stage II. | User task; master spec §0.1, §15; GDD §21–22 | Do not expose Stage II actions/routes in the player interface |
| B4 | No migration of V1 worlds as a prerequisite. | User task; master spec §0.5, §3.1 | V1 migration remains a separate future project |
| B5 | Water is resource/decorative only; no liquid physics/flooding. No standalone support building; use mine tunnels. | Accepted project decisions; master spec §4.2 | Water cannot change pathing or flood cells |
| B6 | OpenCode is the autonomous developer and owns setup, DB/migrations, tests, recovery and browser verification; the owner is a nontechnical player. | User D-DX-15; receipt `54e26a17-e34e-45c9-8f3b-8099975a179c` | Keep `AGENT_RUNBOOK.md` separate from terminal-free `PLAY_NOW.md` |
| B7 | One-time pairing code is handed to the owner only through a loopback-only in-memory browser view; never to LAN clients or stdout/chat/URL/log/evidence/persistent storage. | User D-DX-16; receipt `5ec4b7b9-5ffc-4062-a823-131ad9535a0f` | Verify actual peer/listener; ignore forwarded headers; fail closed |
| B8 | Accept the unresolved CEO independent post-fix spec-verification concern as recorded; proceed with G1 PASS and begin G2 without claiming that independent reread occurred. | User D7-A; receipt `9a18c437-279e-4a9e-9696-e004722a762a` | Keep `CEO DONE_WITH_CONCERNS`; do not claim independent verification; preserve the remaining G1/G2 evidence gates |
| B9 | G3.2's `Без профессии / Лесоруб / Строитель` choices are persistent work roles, separate from formal GDD professions learned at schools. | Owner selection for G3.2; GDD §5.1 remains unchanged | Store a `workRole` separately from future school-derived profession; direct role selection must not create/claim a formal trained profession |
| B10 | G3.3 is an owner-approved bounded early stone-economy slice; its numeric values are preliminary and scoped to G3.3 only. The `stone_miner` work role is direct task automation, not a formal school profession. | Owner approval, 2026-10-27; supersedes proposed values only for this slice | Stone node offset `(5,1)`, stock 600, yield 3/tick, buffer 18; workshop construction consumes 12 wood + 6 stone. Do not treat these as final GDD/G4/G5/G6 balance, and do not mark those gates complete |
| B11 | G3.4 makes the full-screen side-view world the primary control surface: world-anchored object menus, resident drag/drop plus tap-to-select fallback, and click-to-place building ghosts. New sites require an explicit resident drop; pre-G3.4 saves/orders keep compatible automatic execution. | Owner direction, 2026-10-28 | Remove permanent right-side gameplay panels; keep queue/priority in site context menus; server remains authoritative; no economics/balance changes |

## Proposed values, not approvals

Numerical bounds for pairing entropy/expiry/rate, screen budgets, performance, prices, footprints, and tuning remain marked `[estimated]` or `[proposed]` in `PLAN.md`. Do not present them as user-approved GDD values. D-DES-7/8/9 and D-DX-15/16 are individual user-selected UI/owner-flow decisions; see the detailed ledger in `PLAN.md` for their exact controls and recovery rules.
