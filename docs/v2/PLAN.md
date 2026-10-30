<!-- /autoplan restore point: "/Users/labiozzza/Projects/avanpost/.gstack/tmp/autoplan/feat-peace-v2-rebuild-autoplan-restore-20261023-161052.md" -->
# Avanpost Peace V2: implementation plan

## Implementation plan

Current state: G0 `PASS`; G1 `PASS` by user D7-A with the CEO verification concern retained; G2 `IN_PROGRESS` pending physical-phone verification. G2.1 owner acceptance is `PASS 7/7`; G2.2 owner acceptance is `PASS 7/7`. G3.2 is `ACCEPTED PASS 5/5`; G3.3 is `ACCEPTED PASS 6/6`; G3.4 and G4.1 are owner-accepted. G4.2 is the active implementation slice; later G4/G5/G6 scope remains gated. Do not claim an independent CEO post-fix reread or full G2 PASS.

### G3.3 owner-approved early slice (2026-10-27)

The owner approved one limited advance of G4/G5/G6 work to prove a second physical resource loop without closing or redefining those gates. For this slice only, the finite stone node is offset `(dx: 5, dy: 1)`, starts with 600 units, yields 3 per server tick and has an 18-unit source buffer. A temporary `stone_miner` work role directly assigns extraction and is not a school-trained profession. The workshop construction recipe consumes 12 wood and 6 stone. These are preliminary G3.3 balance values only and must not be propagated as final Stage I/G4/G5/G6 values. The slice reuses the existing G3.2 builder footprint/work interval unless a separately approved GDD rule replaces it; it does not add sector discovery, tunneling, full geology, formal training or additional stone recipes.

### G3.4 owner-directed world-first controls (2026-10-28)

- The 2D side-view playfield is the primary full-screen interface. Remove the persistent right inspector/actions column; object details and actions appear in a compact, dismissible context menu anchored near the clicked world object and clamped to the viewport.
- Support mouse and touch: drag residents onto trees, stone deposits and construction sites; on touch, tapping a resident selects it and tapping a destination offers/executes the same compatible action. Invalid targets produce visible feedback and send no command. Camera pan/pinch must not issue gameplay commands.
- Clicking free building surface opens the contextual building catalog. Selecting an entry creates a movable translucent ghost; only explicit server-confirmed placement creates a planned site. Newly placed G3.4 sites require explicit resident-to-site assignment before their builder task starts.
- Existing schema-7 saves and orders created before G3.4 keep their current automatic dispatcher behavior. The new explicit-assignment rule applies only to orders created through the G3.4 placement flow.
- Keep queue priority and cancellation available in a construction-site menu. Reuse server snapshots/commands where possible; add only the minimal idempotent assignment contract needed to target one specific order.
- Do not change mining, recipes, resource balances, shared capacity, or resident movement authority. Scene drag is only an input gesture; server tasks remain the source of truth and never teleport residents or cargo.

### Goal and scope

Deliver the complete peaceful Stage I as a server-authoritative, strictly side-view settlement game. First ship a persistent playable vertical slice in G2, then extend it through G11. Preserve the existing V1 game, source, data, and database. V2 uses new coordinate contracts, new schema, and isolated development/test databases. PvP, marketplace, crystals, payment flows, production deploy, and migration of V1 worlds are excluded until the owner accepts Stage I.

### Architecture

- Player-facing UI/visual scope: the Phaser side-view scene and screen layout with touch/mouse controls, a DOM HUD, selection/inspector, catalog, building ghost, routes, terrain and worker sprites. The design review must assess the UI, interaction states, visual hierarchy, and responsive screens as first-class deliverables; this is an interactive game interface, not documentation-only work.
- Keep the root npm-workspace monorepo and use a modular V2 monolith, but isolate runtime and domain source from V1. Create `apps/client-v2`, `apps/server-v2`, `packages/peace-v2-shared`, and `packages/peace-v2-sim`; reuse installed dependencies and design lessons, not V1 runtime/config/migration/domain code. Leave `apps/client`, `apps/server`, `packages/shared`, `packages/sim`, root V1 `dev`/`db:*` scripts and `docker-compose.yml` behavior unchanged.
- `packages/peace-v2-shared`: V2 API/snapshot schemas, RFC 9457 errors, versioned catalog types and command contracts.
- `packages/peace-v2-sim`: pure signed-coordinate transforms, deterministic generation, support/footprint checks, typed movement graph, professions and economy rules.
- `apps/server-v2`: Fastify auth/session, isolated V2 persistence and migrations, commands, deterministic server clock, movement, haul ledger, construction, residents, schools, production, research, royal orders and snapshots. G2 also owns a loopback-only, in-memory owner handoff view for the one-time pairing code; it is not served to LAN clients, and the code is absent from stdout/logs/URLs/storage.
- `apps/client-v2`: Phaser side-view world and stable actor rendering; DOM-based accessible panels and touch controls. G2's normal route uses the isolated V2 API and persistent world; any fixture source is test-only and never presented as the playable vertical slice. The client sends intents and renders V2 snapshots, never authors economic state.
- `content/peace-v2`: versioned item/building/recipe/profession/research/world-balance catalogs with provenance and validation.
- `apps/client-v2/public/assets/peace-v2`: licensed side-view assets, sprite/animation manifest, checksums.
- `db/peace-v2/migrations` and `docker-compose.v2.yml`: new schema, container, project name and persistent volume; V2 entrypoints use this migration path explicitly, never upward-search into `db/migrations`.
- `docs/v2`: decisions, schema, source map, runbooks, evidence, status, next action, playable instructions, test matrix, gstack run log.

### World and persistence contracts

- One continuous 2D side-view. X grows right, Y grows down; signed global integer coordinates, explicit sector-local coordinates, no hidden depth axis. World scale is 1:1; Phaser camera owns screen transforms.
- Grid cells separate air/solid, material, durability, geology, discovery/preparation, occupancy, infrastructure, and topology revision. Water remains a resource/decorative tile only; no liquid physics or flooding. No standalone “support” building; use the GDD mine-tunnel infrastructure.
- Actors require body clearance and support. People, carts, buildings, and work points use typed collision/transport rules. All work begins only after physical arrival at a reachable work point.
- All object footprints and occupied cells are validated/reserved atomically, with a database uniqueness constraint on every occupied `(world_id, cell_x, cell_y)`; conflicts roll back the whole placement and material reservation. Building images may extend beyond their collision footprint but must have a checked pivot.
- Item stacks have stable IDs, integer `qty >= 0`, and exactly one authoritative location (world/node, storage/buffer, or resident cargo). Split/merge and haul load/unload are atomic ledger transitions; quantities are conserved across every legal transition. Retries cannot duplicate or destroy stock.
- Commands are idempotent by `(player_id, request_id)` and canonical payload hash. The exact successful response and the world effect commit atomically; a repeated ID with the same payload replays the response, and a changed payload returns a typed conflict without a second effect. Keep replay records for the life of the world; any later compaction must preserve request-ID tombstones and response replay behavior.
- Per-world mutations and simulation ticks serialize on the world revision row and commit a canonical command/tick sequence. Catch-up progress is persisted with a single active lease per world; while syncing, mutations are gated and clients poll the authoritative snapshot. A restart resumes from the last committed tick; the client never queues or applies economic commands offline.
- New V2 PostgreSQL databases only. `DATABASE_URL` and `TEST_DATABASE_URL` must be distinct and must never target V1 databases `avanpost` or `avanpost_test`. Before opening a pool, parse the URL, allow only the operation's V2 database name and configured local/V2-compose host identity, and reject aliases or arbitrary remote hosts. After connection, verify the connected database/server identity before any migration or destructive statement. Migrations, startup, tests, and stop scripts share this guard.
- Persist each world's seed plus generator, simulation, catalog-content and schema versions/hashes. A catalog update never silently changes an existing world's rules; incompatible versions require an explicit supported upgrade. Offline client is read-only; if the server is unavailable, elapsed time is caught up deterministically on reconnection, without replaying client-queued commands.

### Delivery gates

| Gate | Deliverable | Acceptance evidence |
|---|---|---|
| G0 | Safe baseline, source map, decisions, schema/API/simulation/economy/building contracts, isolated V2 dev/test container/database, doctor, test harnesses and OpenCode `AGENT_RUNBOOK.md` | Separate compose project/volume/ports and database names; V1 source/data/schema/saves/DB untouched; OpenCode follows a non-interactive, exact-order runbook with expected outputs and safe retry/stop behavior; V2 doctor allowlists operation-specific V2 database/host identities, rejects `avanpost` and `avanpost_test` before connection, then verifies connected identity before migrations/resets; dedicated V2 test configs use only `avanpost_v2_test`; `build:peace:v2` is compile-only and environment-free, while root `npm run build` compiles all touched workspaces; no root V1 migration/stop command used |
| G1 | Reviewed plan plus full requirement-to-gate-to-evidence matrix, API and error/rescue contracts | `SOURCE_MAP.md` assigns stable `REQ-####` IDs to every applicable GDD/master-spec requirement, with canonical section/item anchors, owner, gate, observable assertion, failure/recovery, evidence path and PASS/BLOCKED/N/A rationale; `check:peace:v2:source-map` fails on missing/unlinked in-scope requirements. `TEST_MATRIX.md` retains all 30 stable `I-E2E` IDs and adds supplemental V2-PV/security rows; `API.md`, `ERROR_REGISTRY.md` and domain contracts agree with that map; CEO, Design, DX and Eng results are recorded |
| G2 | Persistent playable Phaser side-view vertical slice at `/peace-v2` | OpenCode runs `npm run dev:peace:v2` on the isolated V2 API/client/database, verifies live HTTP/browser behavior, then gives the owner the actual URL and keeps script-owned V2 processes running while the owner plays. It stops only on owner acceptance or explicit stop request. Before world mutations, the owner pairs the phone with a 128-bit CSPRNG code bound to that launcher/world, valid for 5 minutes and atomically consumed once. Limit failed attempts to 5 per source/instance per 5 minutes. Pair only on loopback or an explicit private-LAN interface; use same-origin POST/strict Host+Origin checks, never put the code in stdout/tool output, chat, a URL/referrer, logs, evidence or persistent client storage, and reject public/untrusted interfaces. OpenCode exposes the code only through a loopback-only in-memory owner handoff on the launching computer; authorize using the actual socket peer/local listener, never untrusted forwarded headers; LAN clients cannot read it. The unpaired phone sees the world read-only with a focused pairing sheet; all mutations stay disabled until the owner session is established. Pairing errors give safe reason-specific next steps without echoing the code, remaining-attempt count or internal validation details. Owner-facing `PLAY_NOW.md` is Russian and contains no setup/terminal/database steps. Browser E2E covers touch/portrait, surface+cave, resident assignment, reachable extraction, physical delivery, building, handoff isolation (including forged Host/forwarded headers), pairing recovery and reload persistence. V1 services/data/DB are not used |
| G3 | Extend and harden the V2 authoritative world | Expand account/session lifecycle, command/snapshot coverage, deterministic world and restart/recovery beyond the minimum G2 slice; idempotency scope/payload mismatch and world command/tick ordering are explicit; invalid/stale/duplicate commands return typed errors |
| G4 | Expand finite/renewable resources, carriers and warehouses | API+Postgres+browser E2E extend physical approach/load/move/unload, finite exhaustion, fallback income, full buffers, retry and per-item conservation beyond the G2 path |
| G5 | Expand construction, logistics and infrastructure | Extend server footprint/client ghost agreement; material waits/delivery/build, overlap, no support, blocked entrance, demolition and route-disconnect cases tested |
| G6 | Expand sectors, exploration and underground | deterministic sector seams, ownership vs preparation, additional reachable dig/work points, stairs/tunnel, interruption/restart, unique deposits and cart restrictions tested |
| G7 | Population and four civil schools | one resident identity/active assignment; housing cap, arrival/work/study positions persist; all 23 catalog entries validated: 4 one-school, 6 commutative pairs, 12 triples whose first pair is commutative and final school is ordered |
| G8 | Multi-stage production and research | real inputs/fuel/buffers/output, deterministic quality, all peaceful branches, no-scientist pause and recipe failures tested; with identical seed and ordered commands, one hour online vs offline yields exact canonical world/item-ledger hashes |
| G9 | Royal orders and sustainable peaceful progression | actual stock reserved and submitted once; order expiry/limits/partial state explicit; clean account completes a peaceful order without admin tools |
| G10 | Final art, mobile UX, sound and PWA | manifest fields/checksums validate; no missing required art or placeholder at Stage I acceptance; 390×844, 375×667, 844×390 and 1440×900; safe-area respected; controls ≥44×44 CSS px; inspector never hides the selected placement; physical-device smoke before release |
| G11 | Full Stage I regression and release candidate | all 30 GDD §21.2 scenarios have script, fixture, expected/actual result, log/trace and SHA under `docs/v2/evidence/<gate>/<test-id>/`; zero open P0/P1; gstack review/QA and safe `ship` PR-preparation evidence; no merge/deploy; `STAGE_I_AUTO_QA: PASS`, owner acceptance stays `PENDING` |

Critical dependency chain is `G0 → G1 → G2 → G3 → G4 → G5 → G6 → G7 → G8 → G9 → G10 → G11`. Subtasks may be parallelized only when they do not share a schema, content catalog, or visual-state contract; no parallel track may bypass a gate. The plan does not claim a completion date or a staffing capacity that has not been measured.

#### Gate terms and evidence

- **Owner:** OpenCode executes repository inspection, code, dependencies, V2 environment/database/migrations, tests, browser checks, recovery and reports. The project owner is a player: they open the verified URL, pair, play, give feedback and perform final acceptance; no technical step is delegated to them.
- **Playable-slice boundary G2→G3:** G2's normal `/peace-v2` route uses a V2 API and isolated V2 PostgreSQL database for real worker, item, build and reload behavior. Before LAN world mutations, the owner pairs the phone with a 128-bit CSPRNG code, bound to the launcher/world, single-use and valid for 5 minutes; limit failed attempts to 5 per source/instance per 5 minutes. Pair only on loopback or an explicit private-LAN interface; require same-origin POST and strict Host/Origin checks; never put the code in a URL/referrer, stdout/tool output, assistant chat, log or persistent storage, and reject public interfaces. OpenCode exposes the code only through a loopback-only in-memory owner handoff on the launching computer; phone/LAN clients cannot fetch that handoff. Because local LAN play may use HTTP, the owner must treat it as a trusted private network; this pairing is not production authentication and must not be used on an untrusted/public network. No account or multiplayer system is added. Test fixtures may seed deterministic cases but cannot replace authoritative commands or persistence in acceptance evidence. G3 expands account/session lifecycle, world size and command/error coverage; an unavailable API or V2 database blocks G2 and never falls back to a fixture presented as saved gameplay.
- **G2 incremental checkpoints (not separate gates):** (a) isolated DB preflight, launch, health and owner pairing; (b) authoritative snapshot and resident assignment to a reachable point; (c) physical delivery and a minimal valid building; (d) reload, portrait/touch and saved-state verification. Each checkpoint must be observable and stops dependent work on failure; none independently passes G2, and none may replace the real V2 API/database with a fixture.
- **Failure matrix:** expired/missing session → 401, user-visible sign-in retry and no world mutation; missing world/layout → typed 404/409 and no scene mutation; empty world → explicit onboarding/empty scene; stale version → 409 plus fresh snapshot; duplicate `request_id` → exact stored response, no repeated effects; unreachable work point → waiting state and reason; interrupted haul load/unload → transaction leaves item at exactly one location; full input/output/storage or no worker/specialist/fuel → explicit idle reason without dropping stock; absent scientist → research pauses online and offline; duplicate/expired royal-order submission → no second reward; catch-up cap → `202 syncing` with remaining ticks and no retroactive command; incompatible PWA assets → keep old manifest/cache or reject update atomically. G1 records endpoint/state/error assertion and a failure-path test per row.
- **Severity:** P0 means data loss/duplication, unauthorized access, V1 contamination, or a core play path unusable. P1 means a mandatory GDD scenario or major user interaction is wrong/unavailable. P2 means a non-blocking visual/quality issue that does not violate an acceptance budget. G11 requires zero open P0/P1; every P2 is listed with owner and disposition.
- **Device evidence:** browser E2E covers master-spec viewports 390×844, 375×667, 844×390, and 1440×900. Touch pan is one-finger drag; pinch zooms around gesture centroid; `pointercancel` never confirms placement; all controls are ≥44×44 CSS px, safe-area insets are honored, and the selected plot stays visible when panels open. Device emulation is not a real-device pass. OpenCode performs a physical-device smoke if a connected device is available; otherwise G10/G11 are `BLOCKED` with the missing-device evidence recorded, not falsely passed.
- **Art evidence:** each asset row in `content/peace-v2/assets/manifest.json` includes ID, stage/group/role, source/license, path, dimensions/pivot/atlas/frames/animation and quality state; checksums are validated by the manifest. Temporary art is allowed only for G2–G9 and cannot close G10/G11. Use downloaded, licensed Kenney assets for placeholder roles so each gate still reads as a game; choose side-view-compatible assets and do not pass top-down art, rectangles or emoji off as side-view. If no suitable licensed placeholder exists, record the missing role as `ART_BLOCKER` rather than misrepresenting it. OpenCode owns generated/curated evidence; an external asset blocker is named per row.
- **Release labels:** `P0/P1` must be fixed and retested; `STAGE_I_AUTO_QA: PASS` is the technical release candidate; `STAGE_I_OWNER_ACCEPTANCE: PENDING` remains until the owner has played it. `gstack-ship` may push the feature branch and prepare a PR if authenticated; merge, production deploy, release publication and PvP remain forbidden.
- **Evidence retention:** every gate commits command, exit code, test count, database identifier (never secrets), required browser trace/screenshot, artifact sizes and commit SHA under `docs/v2/evidence/<gate>/<test-id>/`; status links to those exact artifacts. Redact cookies, pairing codes and credential-bearing URLs before commit. Compress traces and keep one final passing trace plus failure traces; do not store database dumps, raw network payloads or video. G0 records the evidence-size baseline and sets a tested per-artifact size cap before G11; any cap must preserve required logs/traces and SHA metadata. Missing evidence blocks PASS.

### Execution rules

- Keep a playable browser build as early as G2. Every package includes UI/scene visualization and tests, not backend-only work.
- Before each gate: inspect current status/next action, make the smallest coherent change, test targeted contracts, run build/typecheck and real browser E2E when UI changes, run gstack review/QA, repair P0/P1, record evidence, commit the gate, then proceed automatically.
- Update `docs/v2/STATUS.md`, `docs/v2/NEXT_ACTION.md`, `docs/v2/EXECUTION_LOG.md`, and `docs/v2/GSTACK_RUNS.md` after each gate. Never mark a gate PASS without artifact/evidence.
- Keep existing user work and V1 untouched. Never reset, force-push, merge, deploy production, alter V1 DB, start PvP, market, payments, or crystals.
- Use downloaded, licensed Kenney assets as the required placeholder art for G2–G9 so each gate remains visibly playable; label temporary art honestly and choose side-view-compatible assets. Full Stage I cannot pass with placeholders. If a required role lacks a suitable licensed placeholder, keep the rest of the game playable and record that role as `ART_BLOCKER`.
- Expose localhost and same-LAN URLs only after live HTTP/browser verification; never publish the dev server to the public internet.

### First actions

1. Complete G0 audit and create `BASELINE.md`, `SOURCE_MAP.md`, `DECISIONS.md`, `SCHEMA.md`, `API.md`, `SIMULATION.md`, `ECONOMY.md`, `BUILDINGS.md`, `CONTENT.md`, and isolated V2 DBs.
2. Complete G1 via autoplan using this plan and the master spec as the primary task definition; give each in-scope source requirement a stable ID/anchor, run the unlinked-requirement completeness check, and produce `TEST_MATRIX.md` plus the failure/rescue registry before G2.
3. Start G2 immediately after reviewed plan closure; do not wait for complete art or later economy packages.

## Binding decisions

| ID | Decision | Source / scope |
|---|---|---|
| B1 | Build a new V2 spatial world core and isolated V2 databases; preserve V1 game, saves, schema and database. | User task; master spec §0.2, §2.3, §3.1–3.2 |
| B2 | Peaceful world uses strict side-view, Phaser, server-authoritative economics, touch-first portrait PWA. | User task; master spec §0.1, §4, §9–10 |
| B3 | Work only on peaceful Stage I. Do not implement PvP, marketplace, crystals, payments or Stage II. | User task; master spec §0.1, §15; GDD §21–22 |
| B4 | No migration of V1 worlds as a prerequisite. | User task; master spec §0.5, §3.1; archival analysis is a risk register |
| B5 | Water is resource/decorative only; no liquid physics/flooding. No standalone “support” building; use mine tunnels. | Existing accepted project decisions; master spec §4.2 |
| B6 | OpenCode is the autonomous developer and owns technical setup, databases, migrations, tests, recovery and browser verification; the project owner is a nontechnical player and receives no terminal/DB tasks. | User-selected D-DX-15; durable receipt `54e26a17-e34e-45c9-8f3b-8099975a179c` |
| B7 | Deliver the one-time pairing code only through a loopback-only in-memory owner browser handoff; never expose it to LAN clients or stdout/chat/URL/log/evidence/persistent client storage. | User-selected D-DX-16; durable receipt `5ec4b7b9-5ffc-4062-a823-131ad9535a0f` |
| B8 | Accept the unresolved CEO independent post-fix spec-verification concern as recorded; proceed with G1 PASS and authorize G2 without claiming that independent reread occurred. | User-selected D7-A; durable receipt `9a18c437-279e-4a9e-9696-e004722a762a` |

<!-- autoplan-accepted:ceo -->
- Hold the user's scope: complete peaceful Stage I, early playable G2, strict side-view, Phaser, server-authoritative economy, V1 and its database untouched; no PvP/market/payment/production deploy/merge. Verification: gates G0–G11 and the GDD §21.2 test matrix.
<!-- /autoplan-accepted:ceo -->

<!-- autoplan-accepted:design -->
- The following detailed G2 viewport budgets supersede the earlier shorthand: usable height excludes safe-area insets; top HUD ≤8%, persistent mode bar ≤12%, and unobscured world ≥60% in normal/placement states. Expanded inspector replaces rather than stacks with the mode bar, is ≤35% including controls, leaves ≥55% unobscured world, and auto-collapses during placement to restore ≥60%. At 375×667 the sheet scrolls without covering confirm/cancel.
- Catalog groups mirror GDD building categories. Each item shows name/icon, footprint, material/technology requirement, availability and a single selection action. Selecting is distinct from placement; preview shows a text+icon reason adjacent to the footprint; confirm and cancel are separate visible controls.
- G2 HUD shows actual V2 resource counts and save/sync state; it never shows the old `ДЕМО · НЕ СОХРАНЯЕТСЯ` label or presents fixture counts as authoritative. First LAN use requires a clear one-time pairing-code step and recovery action before world commands are enabled. The world remains the visual anchor; selected resident gets identity/portrait+label, route has turns+text blockage reason, plot/target outlines differ by shape and icon.
- DOM controls have visible focus and keyboard order; canvas actors have parallel accessible list/buttons and names; selection, sync, command and placement results announce through a polite live region. G2 implements persistent world, route, build and recovery states; later gates add research/order/offline domain states with concrete recovery actions.
- G2 acceptance checks catalog categories/labels, separation of item selection vs placement, no-input/no-material/blocked route explanations, portrait sheet recovery, and the first-use flow. Tokens, pivot, route and ghost must remain legible at 390×844, 375×667 and 1440×900 before G3 uses them.
- Portrait overflow behavior is explicit at both 390×844 and 375×667: compact resource/sync indicators stay in the ≤8% top strip; the ≤12% bottom mode bar is replaced by the expanded inspector, not stacked. The inspector scrolls internally within ≤35% usable height, keeps selected resident/route and the contextual action visible, and leaves ≥55% unobscured world. Placement auto-collapses it; secondary resource detail remains available in the resource inspector rather than squeezing the world.
- Portrait placement flow: opening the catalog replaces the mode bar with a scrollable catalog sheet; selecting an item closes the catalog and shows its world-space ghost. Tap a cell to position the ghost; drag beginning on the ghost moves it; drag beginning on empty world pans the camera; two-finger pan/pinch moves/zooms the camera while the ghost remains anchored to its world cell. Keep the ghost at least 48 px above the active finger where possible, clamp it to the viewport edge with the selected footprint visible, and show fixed 44×44 confirm/cancel controls in the bottom action area. Invalid reason is adjacent to the footprint; confirm is disabled until valid; cancel exits placement without changing the world.
- Later-game work states surface on the affected actor/building via status icon+label and in the accessible world-entity list. Selecting the status highlights the entity and opens its inspector with current progress/location, exact blocker, and one primary recovery action. Blocked haul → “Показать проблему” and source/destination; research paused → show missing scholar/input and valid assignment/source action; expired order → refresh/close; material wait → open compatible source/haul action; syncing/stale/offline → sync state, last confirmed version, retry/refresh. Interrupted work preserves cargo/progress and exposes its location.
- G2 first-use completion gives a brief non-blocking confirmation that the accepted action was saved, then returns to free exploration. A persistent help action can resume/restart the short path; it never blocks world input or implies persistence for an unconfirmed action.
- Landscape 844×390 uses a right inspector up to 280 px / 36% usable width, bottom modes, and at least 60% clear world width; desktop 1440×900 uses a 320 px right inspector capped at 28% width. On resize, keep selection/camera, collapse the inspector to the mode sheet if portrait constraints would be violated, and keep confirm/cancel visible during placement.
- G2 loads its initial scene from the authoritative V2 snapshot and announces “Мир подключён · изменения сохраняются” with connection status. Preserve camera and selection across reload only when stable IDs exist in the snapshot; never submit an unconfirmed ghost.
- Preserve approved design D1–D10 from the preceding plan review where consistent with master spec: one continuous side-view surface/underground cross-section; HUD variant A (selected object/route, compact resources/sync at top, modes at bottom); inspector collapses to a bottom sheet on portrait; no zoom-to-fit whole-world requirement.
- World grid remains 1:1 at 48 px/cell; resident silhouette is approximately 64 px; zoom range 0.5–3.0, default 1.0 desktop / 0.75 portrait; camera pans both axes, zooms around gesture centroid and offers recenter. Values remain catalog/configuration data and are validated on the prototype.
- Touch is first-class: one-finger camera pan, pinch zoom, ghost offset at least 48 px above finger, separate confirmation tap; drag/pinch/`pointercancel` never place or submit. Selected route and target plot stay visible when the inspector opens.
- Use the existing approved readability-token roles from the prior plan §9.10 as proposed V2 tokens (earth/soil/rock, building/actor accents, route/valid/invalid/selection, panel/text). Full `DESIGN.md` is not a G1 blocker; visual quality is judged on rendered G2 and may tune proposed values without changing GDD behavior.
- Art direction follows GDD §16.1: hand-drawn medieval humans/buildings, soft texture, readable silhouettes. Use downloaded licensed Kenney assets as side-view-compatible placeholders through G2–G9; no rectangles/emoji as final art and no top-down assets passed off as side-view. Replace all placeholders with approved final art by G10.
- Verify portrait/landscape at master-spec viewports, ≥44×44 CSS px controls, ≥16 px body text, text contrast ≥4.5:1, status contrast ≥3:1, safe-area, reduced-motion, and non-color-only status cues. Browser emulation is not physical-device evidence.
- Evidence: Playwright touch flow at 390×844 and 375×667, landscape 844×390, desktop 1440×900; G2 records a first-use friction/task-completion note, and G10 requires physical-device smoke if hardware is accessible.
- G2 hierarchy: continuous world and the marked resident/available plot first; compact real resources and sync second; selected resident/route and one contextual next action third; build/dig/select modes at the bottom. No competing modals or permanent empty inspector.
- G2 first-use playable path: open the local owner session or pair the phone once → pan to a resident → inspect/assign a reachable task → observe physical movement and item delivery → place a building with the ghost and confirm/cancel → reload and verify the saved V2 state. Every successful mutation is authoritative; unconfirmed placement changes nothing.
- UI states show user-facing cue + recovery action for scene/loading/empty/offline/syncing; catalog unavailable; ghost valid/invalid/material-wait/cancel; resident busy/commuting/studying; haul blocked/delivered; research paused; order expired/submitted. Empty states offer context and one next action; partial states retain progress/cargo location.
- Portrait inspector is a bottom sheet. Opening/closing retains the selected object and camera point; placement controls and the selected target remain reachable while the sheet is open.
- Reuse prior readability tokens as proposed values, validated on the rendered G2 screen: sky `#BFD8E6`, grass `#6F8F4E`, soil `#6B4F3A`, rock `#5A5F63`, roof `#8C4A3C`, actor accent `#E0B35A`, route `#F2D28B`, valid `#4F8F5A`, invalid `#B5453C`, selection `#F2C14E`, text `#1F2428`, panel `#F4EFE6`; bundled Cyrillic-capable IBM Plex Sans; 16/20/24 px type scale; 4/8/12/16 px spacing; 4/8 px radii; 2 px route/3 px selected route. No external asset font fetch.
- Portrait budgets use usable height after safe-area insets: top HUD ≤8%; persistent mode bar ≤12%; normal and placement states retain ≥60% unobscured world. The expanded inspector replaces the mode bar, is ≤35% including controls, and leaves ≥55% unobscured world. Entering placement auto-collapses the inspector and restores ≥60% world; at 375×667 sheet content scrolls without covering confirm/cancel.
- Catalog organizes buildings by GDD groups; each entry shows name/icon, footprint, material/technology requirement, status and one action. Opening/selecting an item does not place it; confirm and cancel remain distinct. Ghost feedback appears adjacent to footprint with text+icon (“Можно построить”/exact refusal), not color alone.
- Scene cues: discoverable plot uses a named outline; selected resident has portrait/identity marker plus label; selected route is a solid 3 px high-contrast path with turn points and text reason at a blocked segment; target footprint uses a dashed selection edge and check/cross icon. G2 HUD shows actual V2 snapshot resources and save/sync status; fixture counts never appear as authoritative.
- Accessibility behavior: DOM controls have visible focus and predictable keyboard order; canvas objects have parallel accessible buttons/list entries; selection, pairing status/error, sync, command result and placement reason announce through a polite live region; route/validity use shape+icon+text as well as color. The pairing input has a visible label and accessible focus, and its error guidance never includes the secret or remaining-attempt count. Before owner pairing, every mutation control is unavailable to keyboard, touch and assistive technology, not merely visually dimmed. Reduced-motion preserves immediate action feedback.
- Recovery states map to UI and action: offline/read-only shows last sync + retry; syncing shows remaining progress and disables world mutations until server completion; stale version refreshes before another submit; no path retains cargo and exposes “Показать проблему”; missing materials opens the compatible source/haul action; no resident/scholar shows the valid assignment/training action; expired order exposes refresh/close.
- G2 visual acceptance checkpoint records screenshot and friction notes for the persistent first-use tasks, verifies token/font/pivot/route/ghost legibility at both portrait sizes and desktop, and approves or adjusts proposed tokens before G3 consumes them. Missing generated mockups are not substituted with fabricated imagery; live G2 rendering is the design reference.
- Pairing presentation for the first phone visit: keep the world visible but read-only; on portrait, a focused pairing sheet replaces the bottom mode bar, explains that the owner code is printed by the local launcher, and disables every world mutation until pairing succeeds. The pairing sheet follows the approved ≤35% inspector / ≥55% visible-world budget and keeps the labelled input and **Подключить** action reachable at 375×667. In landscape/desktop, place the equivalent pairing controls in the approved right-inspector area. On success remove the pairing sheet and restore the normal world controls; never imply a mutation was saved before then.
- Pairing errors use safe reason-specific recovery: invalid input prompts a code recheck; expired or already-used codes prompt the owner to request a fresh code from the launcher; rate-limited attempts prompt the user to wait and retry when available. Never echo the code, show remaining attempts, or reveal internal validation details. Every mutation stays disabled until pairing succeeds.
- Pairing input uses one visibly labelled field that accepts the complete launcher code by paste or manual entry, plus a separate **Подключить** action. Do not auto-submit. Provide an accessible show/hide control; keep the code only in transient client memory while the form is active, never in logs, URLs, local storage, IndexedDB, cookies or another persistent client store. Clear it after successful pairing or page unload.
- G2 screen hierarchy and first-use flow (faithful restatement of the accepted world-first and pairing decisions):

  ```text
  UNPAIRED PHONE                         PAIRED WORLD
  ┌────────────────────────┐            ┌────────────────────────┐
  │ compact resources/sync │            │ compact resources/sync │
  ├────────────────────────┤            ├────────────────────────┤
  │                        │            │                        │
  │ read-only world scene  │            │ world + selected actor │
  │ surface / cave / plot  │            │ route / plot / ghost   │
  │                        │            │                        │
  ├────────────────────────┤            ├────────────────────────┤
  │ labelled code + toggle │            │ inspector or catalog   │
  │ Подключить / recovery  │            │ when requested         │
  │ mode bar replaced      │            │                        │
  ├────────────────────────┤            ├────────────────────────┤
  │ no world mutations     │            │ select / build / dig   │
  └────────────────────────┘            └────────────────────────┘
       pair → saved world → assign reachable task → observe delivery
           → preview/confirm build → reload and verify saved state
  ```

  The pairing/inspector sheet uses the already approved portrait height and world-clearance budgets; landscape/desktop use the approved right-inspector region.
<!-- /autoplan-accepted:design -->
<!-- autoplan-accepted:dx -->
- **Primary developer:** OpenCode acting as an autonomous coding agent, not the project owner. It inspects the task/repository/spec, sets up isolated V2 workspaces/dependencies/environment/database/migrations, runs tests, diagnoses and recovers failures, starts the app and verifies the browser. The project owner does not write code, configure environments, execute terminal commands, manage databases/migrations or debug infrastructure.
- **Agent TTHW:** retain the previously approved `<5 minutes` target `[user-approved target; unmeasured]` from a clean checkout (Node.js ≥22/npm, no `node_modules`, required local PostgreSQL mechanism available) to OpenCode’s browser-verified full persisted play flow and verified URL handoff: pairing, reachable assignment, delivery, building and reload. OpenCode runs the end-to-end proof; the owner’s subsequent play duration is separate and has no target. TTHW must be re-measured against real G2.
- **Owner experience:** At each playable gate, OpenCode gives the owner a real computer/LAN URL only after successful HTTP and browser verification. The owner opens the game in a browser, retrieves a phone code from the loopback-only handoff on the computer when needed, pairs, plays and gives feedback; no setup or database commands are assigned to them. Formal Stage I acceptance remains after `STAGE_I_AUTO_QA: PASS`.
- For phone pairing, OpenCode opens a loopback-only owner handoff view on the computer that launched V2. It displays the one-time code in memory so the owner can copy it to the phone. It is inaccessible to unpaired LAN clients and does not put the code in stdout/tool output, chat, URLs, logs, evidence or persistent client storage.
- OpenCode keeps the verified V2 services and loopback owner handoff alive while the owner opens the URL and plays; it safely stops only script-owned V2 processes after owner acceptance or an explicit stop request. It never returns a URL for a process it has already stopped.
- The agent runs the integrated `npm run dev:peace:v2` flow through `apps/client-v2`, `apps/server-v2` and only the isolated V2 development database. It also owns V2 env setup, DB creation/identity checks, migration, tests, failure recovery and safe stop. Do not use root `.env`, V1 `npm run dev`/`dev:client`, root V1 `db:*`, V1 API/data or database `avanpost`; V1 client/server packages and scripts stay unchanged. Verification: clean-start agent run plus browser proves pairing, resident assignment, physical delivery, building, reload persistence and no V1 port/database access.
- Separate documentation by audience: `docs/v2/AGENT_RUNBOOK.md` gives OpenCode the exact sequence `inspect repo/status → check Node/npm → install dependencies if needed → prepare V2-only env → start/guard/migrate V2 DB → build/typecheck/test/E2E → launch V2 → verify HTTP/browser → open loopback handoff → return verified URL`; it names expected outputs, safe retries/stops and V1 prohibitions. Command/agent output contains only handoff readiness and URL, never the code. `docs/v2/PLAY_NOW.md` is an owner-facing Russian guide with the actual URL OpenCode supplies, the computer-to-phone handoff, pairing and controls, gameplay, feedback and final acceptance. The owner guide contains no terminal, environment, database or migration steps. Root `README.md` may link both while leaving all V1 instructions unchanged.
- The existing V1 `apps/server/src/config.ts` auto-loads root `.env` and defaults to database `avanpost`; V1 tests default `TEST_DATABASE_URL` to `avanpost_test`. V2 startup uses a V2-only env file/example and `apps/server-v2` entrypoint, rejects both V1 DB identities before connecting or mutating, and never changes or reuses the V1 loader/config. G0 adds `.env.v2.example` and the master-spec commands `dev:peace:v2`, `dev:peace:v2:stop`, `doctor:peace:v2`, `db:peace:v2:up`, `db:peace:v2:migrate`, `test:peace:v2`, and `e2e:peace:v2`; they explicitly load V2 configuration and fail closed on database identity. `test:peace:v2` and `e2e:peace:v2` use dedicated V2 Vitest/Playwright configs (for example `vitest.peace-v2.config.ts` and `playwright.peace-v2.config.ts`), run V2 app tests against the guarded `avanpost_v2_test`, and never call root V1 migration/server/client commands. Existing V1 test configs remain unchanged. Root `npm run build` includes all touched V2 workspaces in addition to its existing V1 builds; V1 workspace scripts remain unchanged. V2 apps, migrations and compose paths remain separate from V1.
- G0 developer doctor and all introduced V2 startup/setup failures use stable agent-ready codes and documented anchors. The doctor is non-interactive with text and `--json` output; failures include operation/actual values, safe fix, side-effect/retry guidance, relevant versions/config names, native nonzero/stderr channel, and redaction. Unexpected local failures have a trace path; no raw secrets or credential-bearing URLs. The one-time pairing code is shown only to the launching owner, is single-use/short-lived, and is never written to persistent logs.
- Every V2 API error uses HTTP status plus RFC 9457 problem details and a stable code/doc anchor; include caller-safe operation/IDs/expected and current versions, precise validation fields, recovery, side-effect status, request/correlation ID and retry guidance. For unknown mutation outcomes, perform one status reconciliation by the same `request_id`; never reissue with a new ID. If still unknown, stop and escalate with that ID. Read-only requests may retry once; writes are never blindly retried. Logs retain the protected trace, not secrets.
- G1 includes `docs/v2/ERROR_REGISTRY.md`, mapping each API/doctor/client-start path to what/fix/recovery/code/context/trace/redaction/channel, side effects, bounded retries, owner and evidence test. `API.md` has validated copy-paste request/response examples; G2 client/API/database startup failures show a stable code, safe next action and local trace/log location.
- `docs/v2/UPGRADE.md` documents V2-only schema/content upgrades, preflight, backup, migration verification and restore. Never migrate V1 worlds or run V1 migrations for V2. `docs/v2/AGENT_RUNBOOK.md` links to this, `API.md` and `ERROR_REGISTRY.md`; owner-facing `docs/v2/PLAY_NOW.md` links only to play/control/help content and never sends the owner to technical setup. Root README links the agent runbook and owner play guide separately without changing V1 `.env.example` instructions.
- Local tunables are the versioned `content/peace-v2` catalogs and explicitly named client configuration values; contributors may edit them in their worktree and restart the client. Validate catalogs before use and document defaults. Coordinate/version semantics, server-authoritative balances and safety limits are invariants, not runtime overrides; no new env-override API is introduced.
- Measure the approved fresh-clone TTHW once at G2 and save command, clean start state, elapsed time, first interaction and blockers under `docs/v2/evidence/G2/`. G2 records the first-use friction note; no product telemetry, hosted analytics or recurring measurement process is introduced.
- V2 development/test setup remains isolated and local. No hosted service, public SDK/API, V1 migration, or release-policy expansion is accepted by this DX review.
- G2 client-start errors stay on Vite's native nonzero/stderr channel. The play guide supplies one safe fix for unsupported Node, missing dependencies and occupied ports; it opens Vite's printed `Local:` URL rather than assuming port 5173. Fixture initialization shows stable `V2_SCENE_INIT`, a local trace/log path and one retry after the stated fix; failure has no database/world side effects, then escalates with that code.
<!-- /autoplan-accepted:dx -->


<!-- autoplan-accepted:eng -->
- Preserve complete peaceful Stage I and V1 safety. G2 is the persistent V2 playable vertical slice, with a launcher/world-bound 128-bit pairing code `[estimated security default]`, 5-minute expiry `[estimated default]`, five failed attempts per source/instance per 5 minutes `[estimated rate-limit default]`, atomic one-time redemption, private-interface-only LAN mode and an owner-scoped session. G3 expands account/session lifecycle; no Stage II, PvP, market, payment, merge or production deployment is introduced.
- D3/D4 change the earlier G2 interaction and onboarding. Reopen Design and DX review against the persistent, paired G2 before G1 can pass; Engineering must review the final revised plan afterward.
- Keep four separate V2 workspaces: `apps/client-v2`, `apps/server-v2`, `packages/peace-v2-shared` and `packages/peace-v2-sim`. V1 packages, runtime, database, migrations and existing test configuration remain unchanged.
- V2 database commands preflight operation-specific database names and local/V2-compose host identities before connection, then verify actual connected identity before migrations/resets. Reject `avanpost`, `avanpost_test`, aliases and unapproved remote hosts; keep dev/test database URLs distinct.
- Commands are idempotent by `(player_id, request_id)` plus canonical payload hash; commit effects and exact response atomically, conflict on changed payload, and preserve replay records for the active world lifetime. Serialize mutations/ticks by world revision and canonical sequence; persist catch-up progress/lease and block mutations until sync completes.
- Occupancy has a database uniqueness constraint and atomic footprint/material reservation. Item stacks have stable IDs, nonnegative quantities and one location; split/merge/haul transitions conserve quantities atomically. Persist seed and generator/simulation/catalog/schema versions; the client is read-only offline and never queues economic commands.
- G0 creates V2-only Vitest/Playwright configs, a compile-only `build:peace:v2`, guarded dev/test databases and an identity doctor; root build covers all touched workspaces without loading app environments or databases. G1 maps stable `REQ-####` source IDs, passes `check:peace:v2:source-map`, and adds V2-DBSAFE-01, V2-PAIR-01 and V2-PV-01 while preserving all 30 `I-E2E` IDs.
- G2 uses cumulative observable checkpoints for boot/pair/snapshot, reachable assignment/delivery, building and reload; no checkpoint is a gate pass or fixture fallback. G2/G11 performance evidence records small/medium/stress profiles, frame rate, scene load, command latency and memory; 60/30 FPS remain provisional targets until measured.
- Required evidence is redacted and committed under `docs/v2/evidence/<gate>/<test-id>/`; traces are compressed, pairing codes/secrets and raw database/network dumps are excluded, size baseline is recorded in G0 and a measured artifact cap is set before G11.
<!-- /autoplan-accepted:eng -->
## Review record
<!-- autoplan-baseline-edits:eng {"sourceSha256":"f92e403cf574b9a12f87803d65097c46021082aeb5557f3dcd5936a25d4d765b","replacements":[{"oldText":"- All object footprints and occupied cells are validated/reserved atomically. Building images may extend beyond their collision footprint but must have a checked pivot.\n- Items always have a physical source/location/destination. Haul load and unload transitions atomically update a per-item ledger; retries cannot duplicate or destroy stock.\n- New V2 PostgreSQL databases only. `DATABASE_URL` and `TEST_DATABASE_URL` must be distinct and must never target V1 databases `avanpost` or `avanpost_test`. Migrations, startup, tests, and stop scripts reject V1 database identities before connecting or performing destructive operations.\n- V2 world state, simulation clock, generation/catalog/schema versions, commands, snapshots, and PWA assets are versioned. Offline client is read-only; offline server simulation remains deterministic.","newText":"- All object footprints and occupied cells are validated/reserved atomically, with a database uniqueness constraint on every occupied `(world_id, cell_x, cell_y)`; conflicts roll back the whole placement and material reservation. Building images may extend beyond their collision footprint but must have a checked pivot.\n- Item stacks have stable IDs, integer `qty >= 0`, and exactly one authoritative location (world/node, storage/buffer, or resident cargo). Split/merge and haul load/unload are atomic ledger transitions; quantities are conserved across every legal transition. Retries cannot duplicate or destroy stock.\n- Commands are idempotent by `(player_id, request_id)` and canonical payload hash. The exact successful response and the world effect commit atomically; a repeated ID with the same payload replays the response, and a changed payload returns a typed conflict without a second effect. Keep replay records for the life of the world; any later compaction must preserve request-ID tombstones and response replay behavior.\n- Per-world mutations and simulation ticks serialize on the world revision row and commit a canonical command/tick sequence. Catch-up progress is persisted with a single active lease per world; while syncing, mutations are gated and clients poll the authoritative snapshot. A restart resumes from the last committed tick; the client never queues or applies economic commands offline.\n- New V2 PostgreSQL databases only. `DATABASE_URL` and `TEST_DATABASE_URL` must be distinct and must never target V1 databases `avanpost` or `avanpost_test`. Before opening a pool, parse the URL, allow only the operation's V2 database name and configured local/V2-compose host identity, and reject aliases or arbitrary remote hosts. After connection, verify the connected database/server identity before any migration or destructive statement. Migrations, startup, tests, and stop scripts share this guard.\n- Persist each world's seed plus generator, simulation, catalog-content and schema versions/hashes. A catalog update never silently changes an existing world's rules; incompatible versions require an explicit supported upgrade. Offline client is read-only; if the server is unavailable, elapsed time is caught up deterministically on reconnection, without replaying client-queued commands."},{"oldText":"| G0 | Safe baseline, source map, decisions, schema/API/simulation/economy/building contracts, isolated V2 dev/test container/database, doctor and test harnesses | Separate compose project/volume/ports and database names; V1 source/data/schema/saves/DB untouched; V2 doctor rejects `avanpost` and `avanpost_test` before connection; dedicated V2 test configs use only `avanpost_v2_test`; root `npm run build` compiles all touched workspaces while retaining V1 workspace scripts; no root V1 migration/stop command used |\n| G1 | Reviewed plan plus full requirement-to-gate-to-evidence matrix, API and error/rescue contracts | `SOURCE_MAP.md`, `TEST_MATRIX.md`, `API.md`, `ERROR_REGISTRY.md`, and domain contracts map every applicable GDD §0–6, §13.3, §15–17, §19–21, §23 item to owner, gate, observable assertion, error/rescue behavior, evidence path, and PASS/BLOCKED/N/A rationale; CEO, Design, DX and Eng results recorded |\n| G2 | Persistent playable Phaser side-view vertical slice at `/peace-v2` | `npm run dev:peace:v2` starts the isolated V2 API/client and uses only the V2 development database; the owner pairs the phone with a short-lived, single-use local code before world mutations. Browser E2E covers touch/portrait, surface+cave, resident assignment, reachable extraction, physical delivery, building, and reload persistence. V1 services/data/DB are not used |\n| G3 | Extend and harden the V2 authoritative world | Expand account/session lifecycle, command/snapshot coverage, deterministic world and restart/recovery beyond the minimum G2 slice; invalid/stale/duplicate commands return typed errors |","newText":"| G0 | Safe baseline, source map, decisions, schema/API/simulation/economy/building contracts, isolated V2 dev/test container/database, doctor and test harnesses | Separate compose project/volume/ports and database names; V1 source/data/schema/saves/DB untouched; V2 doctor allowlists operation-specific V2 database/host identities, rejects `avanpost` and `avanpost_test` before connection, then verifies the connected identity before migrations/resets; dedicated V2 test configs use only `avanpost_v2_test`; `build:peace:v2` is compile-only and environment-free, while root `npm run build` compiles all touched workspaces; no root V1 migration/stop command used |\n| G1 | Reviewed plan plus full requirement-to-gate-to-evidence matrix, API and error/rescue contracts | `SOURCE_MAP.md` assigns stable `REQ-####` IDs to every applicable GDD/master-spec requirement, with canonical section/item anchors, owner, gate, observable assertion, failure/recovery, evidence path and PASS/BLOCKED/N/A rationale; `check:peace:v2:source-map` fails on missing/unlinked in-scope requirements. `TEST_MATRIX.md` retains all 30 stable `I-E2E` IDs and adds supplemental V2-PV/security rows; `API.md`, `ERROR_REGISTRY.md` and domain contracts agree with that map; CEO, Design, DX and Eng results are recorded |\n| G2 | Persistent playable Phaser side-view vertical slice at `/peace-v2` | `npm run dev:peace:v2` starts the isolated V2 API/client and uses only the V2 development database; before world mutations, the owner pairs the phone with a 128-bit CSPRNG code bound to that launcher/world, valid for 5 minutes and atomically consumed once. Limit failed attempts to 5 per source/instance per 5 minutes. Pair only on loopback or an explicit private-LAN interface; use same-origin POST/strict Host+Origin checks, never place the code in a URL/referrer/log, and reject public/untrusted interfaces. Browser E2E covers touch/portrait, surface+cave, resident assignment, reachable extraction, physical delivery, building, and reload persistence. V1 services/data/DB are not used |\n| G3 | Extend and harden the V2 authoritative world | Expand account/session lifecycle, command/snapshot coverage, deterministic world and restart/recovery beyond the minimum G2 slice; idempotency scope/payload mismatch and world command/tick ordering are explicit; invalid/stale/duplicate commands return typed errors |"},{"oldText":"- **Playable-slice boundary G2→G3:** G2's normal `/peace-v2` route uses a V2 API and isolated V2 PostgreSQL database for real worker, item, build and reload behavior. Before LAN world mutations, the owner pairs the phone with a short-lived, single-use local code and receives an owner-scoped session; no account or multiplayer system is added. Test fixtures may seed deterministic cases but cannot replace authoritative commands or persistence in acceptance evidence. G3 expands account/session lifecycle, world size and command/error coverage; an unavailable API or V2 database blocks G2 and never falls back to a fixture presented as saved gameplay.","newText":"- **Playable-slice boundary G2→G3:** G2's normal `/peace-v2` route uses a V2 API and isolated V2 PostgreSQL database for real worker, item, build and reload behavior. Before LAN world mutations, the owner pairs the phone with a 128-bit CSPRNG code, bound to the launcher/world, single-use and valid for 5 minutes; limit failed attempts to 5 per source/instance per 5 minutes. Pair only on loopback or an explicit private-LAN interface; require same-origin POST and strict Host/Origin checks; never put the code in a URL/referrer/log and reject public interfaces. Because local LAN play may use HTTP, the owner must treat it as a trusted private network; this pairing is not production authentication and must not be used on an untrusted/public network. No account or multiplayer system is added. Test fixtures may seed deterministic cases but cannot replace authoritative commands or persistence in acceptance evidence. G3 expands account/session lifecycle, world size and command/error coverage; an unavailable API or V2 database blocks G2 and never falls back to a fixture presented as saved gameplay.\n- **G2 incremental checkpoints (not separate gates):** (a) isolated DB preflight, launch, health and owner pairing; (b) authoritative snapshot and resident assignment to a reachable point; (c) physical delivery and a minimal valid building; (d) reload, portrait/touch and saved-state verification. Each checkpoint must be observable and stops dependent work on failure; none independently passes G2, and none may replace the real V2 API/database with a fixture."},{"oldText":"- **Evidence retention:** every gate stores command, exit code, test count, database identifier (never secrets), browser trace/screenshot, and commit SHA in `docs/v2/evidence/<gate>/<test-id>/`; status links to those exact artifacts. Missing trace/test output blocks PASS.","newText":"- **Evidence retention:** every gate commits command, exit code, test count, database identifier (never secrets), required browser trace/screenshot, artifact sizes and commit SHA under `docs/v2/evidence/<gate>/<test-id>/`; status links to those exact artifacts. Redact cookies, pairing codes and credential-bearing URLs before commit. Compress traces and keep one final passing trace plus failure traces; do not store database dumps, raw network payloads or video. G0 records the evidence-size baseline and sets a tested per-artifact size cap before G11; any cap must preserve required logs/traces and SHA metadata. Missing evidence blocks PASS."},{"oldText":"2. Complete G1 via autoplan using this plan and the master spec as the primary task definition; produce `TEST_MATRIX.md` and the failure/rescue registry before G2.","newText":"2. Complete G1 via autoplan using this plan and the master spec as the primary task definition; give each in-scope source requirement a stable ID/anchor, run the unlinked-requirement completeness check, and produce `TEST_MATRIX.md` plus the failure/rescue registry before G2."}]} -->
<!-- autoplan-baseline-edits:dx {"sourceSha256":"1a622ed8076980f2f8f869b6ac1ea1ea9bf03a743fcf11e5da33932e76f21724","replacements":[{"oldText":"- Keep the existing workspace/module boundaries and modular-monolith deployment. Share validated contracts; do not duplicate the V1 economy or create microservices.\n- `packages/shared`: V2 API/snapshot schemas, errors, versioned catalog types.\n- `packages/sim`: pure signed-coordinate transforms, deterministic generation, support/footprint checks, typed movement graph, professions and economy rules.\n- `apps/server`: Fastify auth/session, isolated V2 persistence, commands, deterministic server clock, movement, haul ledger, construction, residents, schools, production, research, royal orders, snapshots.\n- `apps/client`: Phaser side-view world and stable actor rendering; DOM-based accessible panels and touch controls. Client sends intents and renders server snapshots; it never authors economic state.\n- `content/peace-v2`: versioned item/building/recipe/profession/research/world-balance catalogs with provenance and validation.\n- `apps/client/public/assets/peace-v2`: licensed side-view assets, sprite/animation manifest, checksums.","newText":"- Keep the root npm-workspace monorepo and use a modular V2 monolith, but isolate runtime and domain source from V1. Create `apps/client-v2`, `apps/server-v2`, `packages/peace-v2-shared`, and `packages/peace-v2-sim`; reuse installed dependencies and design lessons, not V1 runtime/config/migration/domain code. Leave `apps/client`, `apps/server`, `packages/shared`, `packages/sim`, root V1 `dev`/`db:*` scripts and `docker-compose.yml` behavior unchanged.\n- `packages/peace-v2-shared`: V2 API/snapshot schemas, RFC 9457 errors, versioned catalog types and command contracts.\n- `packages/peace-v2-sim`: pure signed-coordinate transforms, deterministic generation, support/footprint checks, typed movement graph, professions and economy rules.\n- `apps/server-v2`: Fastify auth/session, isolated V2 persistence and migrations, commands, deterministic server clock, movement, haul ledger, construction, residents, schools, production, research, royal orders and snapshots.\n- `apps/client-v2`: Phaser side-view world and stable actor rendering; DOM-based accessible panels and touch controls. G2 fixture source is independent of API/DB; later client sends intents and renders V2 snapshots, never authors economic state.\n- `content/peace-v2`: versioned item/building/recipe/profession/research/world-balance catalogs with provenance and validation.\n- `apps/client-v2/public/assets/peace-v2`: licensed side-view assets, sprite/animation manifest, checksums.\n- `db/peace-v2/migrations` and `docker-compose.v2.yml`: new schema, container, project name and persistent volume; V2 entrypoints use this migration path explicitly, never upward-search into `db/migrations`."},{"oldText":"| G0 | Safe baseline, source map, decisions, schema/API/simulation/economy/building contracts, isolated V2 dev/test databases and doctor | V1 untouched; DB identity logged and guarded; restore evidence if V1 access permits; no V1 URL used by V2 |\n| G1 | Reviewed plan plus full requirement-to-gate-to-evidence matrix and failure/rescue contracts | `SOURCE_MAP.md`, `TEST_MATRIX.md`, and API/simulation/economy/building contracts map every applicable GDD §1–6, §13.3, §15–17, §19–21, §23 item to owner, gate, observable assertion, error/rescue behavior, evidence path, and PASS/BLOCKED/N/A rationale; CEO, Design, DX and Eng results recorded |\n| G2 | Early interactive Phaser side-view at `/peace-v2` | Verified browser E2E at 390×844 and desktop; pan/zoom/touch, surface and a fixture-only underground seam/cave, selectable worker, visual route, ghost and cancel. No authoritative dig, economy, or save exists until G3/G6; demo source explicitly labeled non-authoritative |","newText":"| G0 | Safe baseline, source map, decisions, schema/API/simulation/economy/building contracts, isolated V2 dev/test container/database and doctor | Separate compose project/volume/ports and database names; V1 source/data/schema/saves/DB untouched; V2 doctor refuses V1 identity before connection; no root V1 migration/stop command used |\n| G1 | Reviewed plan plus full requirement-to-gate-to-evidence matrix, API and error/rescue contracts | `SOURCE_MAP.md`, `TEST_MATRIX.md`, `API.md`, `ERROR_REGISTRY.md`, and domain contracts map every applicable GDD §0–6, §13.3, §15–17, §19–21, §23 item to owner, gate, observable assertion, error/rescue behavior, evidence path, and PASS/BLOCKED/N/A rationale; CEO, Design, DX and Eng results recorded |\n| G2 | Early interactive Phaser side-view at `/peace-v2` from the isolated `apps/client-v2` entrypoint | `npm run dev:peace:v2:client` starts fixture-only client; verified browser E2E at 390×844 and desktop covers pan/zoom/touch, surface/underground seam, selectable worker, route, ghost and cancel. No V1 API, database, server, authoritative dig, economy or save; demo source explicitly labeled non-authoritative |"}]} -->

### Inputs and precedence

- `AVANPOST_V2_MASTER_SPEC.md` is the execution contract.
- `Avanpost_GDD_v0.9.md` is the game-design source of truth for Stage I.
- `docs/reference/peace-sideview-migration_ARCHIVE.md` is a historical risk register. Its V1 migration process is not part of V2; reuse only applicable spatial, ledger, idempotency, security, and rollback contracts.
- Exact inputs at plan start: master spec v1.0 SHA-256 `74e6207249ebbc0c45117f484525ac731a4f9a330f71536b9b56474525ced052`; GDD v0.9 SHA-256 `61bd13f8212409cfa8a253da6f56ed542ded0efef3b08289638619498678e671`; architecture archive SHA-256 `e617e83118b40a6bffadee5fe61d59bd700be04c0aa400e8f920dec6171bd732`.
- Existing user changes are preserved. V1 game and database remain untouched.

### Current evidence

- Working branch: `feat/peace-v2-rebuild`.
- Existing V1 PostgreSQL container is `avanpost-postgres-1`, host port 5433; do not connect V2 migrations/tests to database `avanpost`.
- Current untracked user files include the previous migration plan and its backup restore report; preserve both.
- G2 acceptance uses the isolated authoritative V2 world; test seeds may initialize deterministic cases but cannot replace the V2 server or persistence.
- Autoplan restore-point files under `.gstack/tmp/autoplan/` are private recovery artifacts only. They do not represent plan approval or a gate pass.
- The header restore pointer is a gstack recovery location for the pre-review draft, not an accepted/final plan. CEO is `DONE_WITH_CONCERNS`; Design and DX reviews are complete with outside coverage unavailable; Engineering remains required. G0/G1 remain `IN_PROGRESS`.

### CEO phase: scope challenge, evidence and decisions

**Review depth:** implementation-ready. **Mode:** SELECTIVE EXPANSION, selected by autoplan's phase override. The direct user instruction already authorizes the complete peaceful Stage I. No optional capability is accepted until the phase decision audit is complete. User direction, exclusions, and V1 safety are binding.

**Review status:** `IN_PROGRESS`; CEO is the first phase. G1 cannot be PASS until the sequential Design, DX and Eng phases finish. This section does not claim approval of a final reviewed plan.

#### 0A. Premise challenge

The problem is not a lack of a Phaser surface: the repository already contains a side-view visual spike and a Phaser client. The gap is that its authoritative world model, storage, and user-facing state remain V1 and are not a separately isolated, durable side-view world satisfying GDD I.1–I.8. A CSS/camera-only conversion would leave placement, movement, extraction, hauling, building, professions, and saved state inconsistent. Doing nothing leaves the user with no independently playable V2 settlement and risks coupling new spatial behavior to V1 saves/database. A new V2 core solves the actual problem; the user's choice is supported by `AVANPOST_V2_MASTER_SPEC.md:18-26`.

#### 0B. Existing-code leverage

| Capability | Existing evidence | Disposition | Why |
|---|---|---|---|
| Phaser 3 + TypeScript + Vite + DOM panels | `docs/adr/0001-stack-and-repo-layout.md:5-12`, `apps/client/src/phaser/main.ts:1-15` | REUSE PATTERNS/DEPENDENCIES ONLY | Keep the working V1 client package untouched; new `apps/client-v2` owns the V2 renderer, route and Vite proxy. |
| Fastify, Kysely, SQL migrations, HttpOnly sessions | `apps/server/src/app.ts:1-50,116-162`, `docs/adr/0001-stack-and-repo-layout.md:7-12` | ADAPT | Reuse server/runtime patterns, introduce isolated V2 entry/config/database and schema. |
| Deterministic server clock/offline catch-up | `docs/adr/0005-server-time-and-offline.md:14-35`, `apps/server/src/domain/simulate.ts` | ADAPT | Preserve server-time lessons but test V2 world from clean schema; do not carry client-tick API. |
| Resident, profession, craft and research logic | `apps/server/src/domain/population.ts`, `craft.ts`, `research.ts`, `content/recipes.yaml`, `content/tech_tree.yaml` | ADAPT | Reuse domain/catalog concepts after proof; V2 persistence and spatial work points remain separate. |
| Existing 1×1 placement and tile graph | `docs/adr/0007-phaser-authoritative-client.md:20-25,38-40`, `apps/server/src/domain/region.ts`, `packages/sim/src/graph.ts` | ARCHIVE/ADAPT | Cannot prove 2D body support, multi-cell footprints, depth, or typed transitions. Do not expand V1 tables in place. |
| Side-view artwork/composition spike | `apps/client/src/spike/scene.ts:7-34`, `apps/client/public/assets/avanpost/` | REUSE AFTER REVIEW | Useful renderer/projection/asset evidence; it is not an authoritative saved V2 world. |
| V1 Postgres service/configuration | `docker-compose.yml:1-20`, `apps/server/src/config.ts:35-48` | ARCHIVE/READ-ONLY | Current default `DATABASE_URL` targets V1 `avanpost`; new V2 commands must reject it. |

#### 0C. Dream state

```text
CURRENT                              THIS PLAN                           12-MONTH IDEAL
V1 Phaser settlement, server          isolated V2 world and database,    self-sustaining peaceful settlement:
economy and I.5 systems;              continuous side-view, physical       sectors, underground routes, residents,
separate visual side-view spike        routes/items, complete Stage I      schools, production, research, royal orders,
                                       in progressive playable gates       PWA and readable art; PvP remains gated
```

This plan closes the gap by shipping the persistent V2 vertical slice in G2, then expanding its authoritative world through G11. It does not claim the current spike is the complete game.

#### 0D/0E. Alternatives and mode provenance

- **Current user choice:** new isolated V2 spatial core; keep V1 available and do not migrate its worlds as a prerequisite. Source: user's request and master spec §0.2/0.5.
- **Rejected alternative:** mutate V1 geometry and database in place. Rejected because it conflicts with the explicit V2 boundary and puts old saves at risk.
- **Rejected shortcut:** deliver only a mockup or top-down variation. Rejected by master spec §1.1–1.3 and direct user request for a live interactive side-view game.
- **Mode provenance:** autoplan's required CEO phase override selected SELECTIVE EXPANSION. The mode does not authorize additional product scope.

#### 0F/0G. Selective-expansion scan

The 10× outcome is one authoritative peaceful world that can be understood and operated on a phone, rather than a collection of disconnected menus. Platform potential comes from typed geometry, item-ledger, resident identity, and versioned catalog contracts shared by future modules without implementing them now.

Five delight checks are mapped to existing approved requirements, not added as new features: (1) a resident's selected route is visibly traceable; (2) a build ghost aligns with the server-accepted cell; (3) a blocked haul explains the exact cause; (4) delivered materials remain visible at the destination after reload; (5) touch camera, portrait layout, and safe-area behavior work without keyboard/mouse. All are already inside the master spec and GDD. No separate optional scope additions are proposed; no entry is added to `TODOS.md` because none exists and no independent deferred work was approved.

#### Decision ledger

| ID / owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| B1 / user | New V2 core; preserve V1 and its database. Master spec §0.2, §2.3, §3.1 | User direction | Keep | approved | Direct request: “Старую игру и её базу данных не изменяй”; stage I only |
| B2 / user | Strict side-view, Phaser, server-authoritative economy, mobile PWA. Master spec §0.1, §4, §9–10 | User direction | Keep | approved | Direct task plus master spec |
| B3 / user | PvP, marketplace, merge, production deploy excluded. Master spec §0.1, §2.3, §15 | User direction | Keep | approved | Direct task; no automatic stage II |
| B4 / user | Isolated V2 dev/test databases. Master spec §0.2, §3.2 | User direction | New container/volume and distinct DB names | approved | Direct task; no V1 connection or destructive SQL |
| B5 / review | Optional scope beyond master. | None approved | None proposed | settled | Keep five delight checks inside accepted requirements |

#### Reality rows

```text
REALITY: premise-table finding Current Phaser game and separate side-view spike do not prove a V2 authoritative side-view world AVANPOST_V2_MASTER_SPEC.md:36-52; docs/adr/0007-phaser-authoritative-client.md:14-25
REALITY: already-done finding Existing Phaser, Fastify, clock, resident/craft/research modules and a visual spike can be reused selectively; no V2 core found in target workspace apps/client/src/spike/scene.ts:7-34; apps/server/src/app.ts:116-162; packages/sim/src
REALITY: surface-check finding Existing root npm scripts are dev/build/test/typecheck/db:up/db:down/db:migrate/e2e; V2 scripts in the master spec do not yet exist package.json:13-24; AVANPOST_V2_MASTER_SPEC.md:98-109
REALITY: binding-decisions pass User's V2/new-database/V1-safety and stage-I-only decisions are recorded in B1-B4 and the master spec AVANPOST_V2_MASTER_SPEC.md:16-28; AVANPOST_V2_MASTER_SPEC.md:73-97
REALITY: numbers pass Counts “G0–G11”, “30 tests”, “23 professions”, “4 schools”, and cell scale 48 are source requirements/proposals, not measurements AVANPOST_V2_MASTER_SPEC.md:423-493; AVANPOST_V2_MASTER_SPEC.md:502-537; Avanpost_GDD_v0.9.md:183-240; docs/reference/peace-sideview-migration_ARCHIVE.md:152
REALITY: deferred-asks pass PvP, market, crystals, V1 migration, production, and merge are explicitly excluded with user/master-spec rationale AVANPOST_V2_MASTER_SPEC.md:7; AVANPOST_V2_MASTER_SPEC.md:73-77; AVANPOST_V2_MASTER_SPEC.md:575-579
REALITY: pr-count pass No .gstack/ship-policy.json exists; installed ship default is one PR per wave; no split PR is planned .gstack; docs/v2/PLAN.md:1-3
REALITY: transaction-semantics pass No driver, pool, or wire-protocol change is proposed; V2 commands require transaction boundaries and idempotency by contract AVANPOST_V2_MASTER_SPEC.md:327-359; docs/adr/0001-stack-and-repo-layout.md:7-12
REALITY: perf-table finding Performance targets are proposed and must be measured on real target devices; no benchmark is claimed AVANPOST_V2_MASTER_SPEC.md:407-415
REALITY: dependency-fallback pass D3 moves the minimum authoritative persistence path into G2; only deterministic test fixtures may seed state, while G3 extends the V2 world AVANPOST_V2_MASTER_SPEC.md:36; AVANPOST_V2_MASTER_SPEC.md:440-451; docs/v2/PLAN.md:965
REALITY: obligation-tiers pass G0/G1 safety and reviewed-plan contracts precede G2; D3 makes G2 persistent and G3+ expand it; PvP/market remain out AVANPOST_V2_MASTER_SPEC.md:423-498; docs/v2/PLAN.md:965
REALITY: prior-art pass No new external library or patched/vendored dependency is proposed; current Phaser 3/Fastify/Kysely stack is already installed docs/adr/0001-stack-and-repo-layout.md:5-12; package-lock.json
REALITY: contract-assumptions pass Shared boundaries are internal repo contracts; verify actual package versions and command routes at G0 before implementation docs/adr/0001-stack-and-repo-layout.md:5-12; package.json:6-24
REALITY: units pass No existing V1 input units are retuned; V2 cell coordinates and item quantities use explicit integer units and versioned catalog metadata AVANPOST_V2_MASTER_SPEC.md:136-142; AVANPOST_V2_MASTER_SPEC.md:227-247; Avanpost_GDD_v0.9.md:113-126
PLAN_REALITY: phase=ceo rows=14/14 missing=none verdict=complete
```

**Outside preflight:** Aside unavailable (no `aside` executable); no WebSearch tool is exposed. Codex CLI is not installed. Native Plan/TaskStop tools are not exposed for the bounded fallback. These reviews cannot receive outside-voice credit.

### Accepted requirements

#### CEO spec review loop

The plan and CEO summary were reviewed together twice. Attempt 1 input SHA-256 was `178db17e7f23669b1586cf5d664d394326be14a55f3d2cc17813059d860462f8`; result `FAIL 5/10`, 9 issues. Attempt 2 input SHA-256 was `eca2a480a3839859c7409b5bd68c8c2ca80d00c7e9f747f9013c299b83469547`; result `FAIL 6/10`, 13 findings. Neither review reported an unapproved player-facing feature expansion. Applied clarifications:

| Finding | Disposition |
|---|---|
| Requirement-to-gate traceability and failure cases | G1 explicitly requires `SOURCE_MAP.md`, `TEST_MATRIX.md`, domain contracts, observable assertions, rescue behavior and evidence locations. |
| G2/G6 underground overlap | Historical CEO disposition kept only a fixture cave in G2; superseded by Engineering D3, which moves the minimum persistent accessible cave/dig path into G2 while G6 expands sectors and underground rules. |
| Profession and offline-equivalence criteria | G7 names 4 one-school, 6 commutative-pair and 12 ordered-final-school triple entries; G8 compares exact canonical state and item-ledger hashes for identical seeds/commands over one hour. |
| Mobile, safe-area, art and physical-device evidence | G10 defines viewports, 44×44 px targets, touch/pointercancel/safe-area behavior, asset manifest ownership, and BLOCKED if no real device is reachable. |
| Ship scope and evidence retention | G11 uses gstack ship for feature-branch/PR preparation only; traces/logs/screenshots/SHA live under `docs/v2/evidence/<gate>/<test-id>/`; no merge/deploy. |
| V2 database isolation and owner | Master spec §3.2 and direct task authorize isolated V2 DB; OpenCode owns all technical gates, owner acceptance remains explicitly pending. |

Attempt 3 input SHA-256: `d01380cde21c6e694093a25b7b97c3fbfb8bd9c81d53bd2c2345e82546e7d29d`; result `FAIL 6/10`, final allowed launch. Its 8 findings are reconciled here; total counts vary by whether overlapping sub-items are counted separately. No fourth spec review will run.

| Finding | Disposition / verification owner |
|---|---|
| Source map and test matrix were still future artifacts | `docs/v2/SOURCE_MAP.md` and `docs/v2/TEST_MATRIX.md` now exist with the canonical source hashes and all 30 scenario IDs. They remain `IN_PROGRESS/NOT_STARTED`; G1 cannot PASS until the owner/gate/assertion/evidence mapping and executable tests are completed and reviewed. |
| Failure matrix omitted authorization, placement, partial construction/demolition | G1 failure/rescue registry must include wrong owner/world, invalid coordinates, overlap/no support/blocked entrance, stale version, insufficient materials, partial load/unload, construction/demolition rollback, and the existing session/catch-up/haul/PWA/order cases; each row needs status code, visible result, no-mutation/rollback rule, and test evidence. |
| Owner acceptance procedure was undefined | After `STAGE_I_AUTO_QA: PASS`, OpenCode provides `PLAY_NOW.md` and tested URLs. Owner may play the clean-world sequence (build after delivery, assign resident, observe haul, train, research, complete royal order, reload/mobile). `ACCEPTANCE.md` records build SHA, date, completed steps, findings and `ACCEPTED`/`REJECTED`; this is after the technical candidate and never authorizes Stage II. |
| G2 underground work could be confused with G6 | Historical CEO disposition deferred persistence; superseded by Engineering D3. G2 includes only the minimum persistent cave/dig path required by the master-spec PV; G6 expands sectors, exploration and underground edge cases. |
| G7/G8/test definitions lacked specifics | School combinations and exact online/offline hash comparison are enumerated in the gate and `TEST_MATRIX.md`. |
| Device availability and touch proof | At G0 OpenCode probes physical-device availability. E2E covers master-spec viewports, ≥44×44 CSS px, safe-area, one-finger pan, pinch centroid, `pointercancel`, and no panel occlusion. If no real device is accessible, keep G10/G11 `BLOCKED` and record `DEVICE_ACCESS_REQUIRED`; no emulation is labeled real-device smoke. |
| G11 PR evidence could imply merge/deploy | `gstack-ship` is limited to feature branch/PR preparation. No merge, release publication, production deploy or PvP. |
| Separate V2 container/volume authorization | Master spec §3.2 explicitly permits a separate V2 database/container/volume; choose separate container/volume only if available, otherwise separate databases with guarded distinct names. Never use or modify V1 DB. |

The failure/rescue registry will add explicit rows for wrong owner/world authorization, invalid coordinate/footprint, occupied/support/entrance rejection, insufficient build materials, interrupted/partial construction and demolition, and route-disconnect after topology changes. Each row defines HTTP/domain error, whether a transaction is committed or rolled back, the world state left behind, player-visible text, and a regression case. These are acceptance details of already-approved mechanics, not new features.

Owner acceptance is not a prerequisite for the technical release candidate. After `STAGE_I_AUTO_QA: PASS`, OpenCode supplies `PLAY_NOW.md` and verified URLs; the owner plays the clean-world flow, then OpenCode records build SHA, date, actions, findings and `ACCEPTED`/`REJECTED` in `ACCEPTANCE.md`. Physical-device access is probed at G0. If unavailable, OpenCode completes browser E2E and LAN availability work, records `DEVICE_ACCESS_REQUIRED`, and leaves the real-device release gate `BLOCKED`; no phone setup or technical command is delegated to the owner.

**CEO spec-review disposition:** three launches used (5/10, 6/10, 6/10); the third review's output was reconciled against the actual files. Remaining implementation artifacts and tests are tracked as G0/G1 work, not represented as completed. G1 remains `IN_PROGRESS` until all plan-review phases and source-to-requirement evidence pass.

**0H decision: `spec not re-verified` (pending).** Manual read-back confirmed the reported fixes are present in the plan and the source/test matrix files exist; no independent reviewer re-read the amended packet after the third launch. The three-launch cap prevents another spec dispatch in this phase. Preserve this limitation in the final report; do not label the CEO spec loop independently clean.

#### CEO primary review (native in-host)

Input: `ceo d01380cde21c6e694093a25b7b97c3fbfb8bd9c81d53bd2c2345e82546e7d29d`. Review completed; 6 findings (3 High, 3 Medium); no outside reviewer result exists.

| Finding | Disposition | Verification / scope |
|---|---|---|
| Full Stage I before product loop proves enjoyable | Preserve the user's complete Stage I scope; make G2 the first authoritative, persistent fun-proof loop: gather, physically haul, build, visible consequence, reload. G3–G5 expand coverage and edge cases. | G2 clean-world E2E and first-player task flow; no feature cut or V1 conversion. |
| Success outcome not stated at player level | Define the first-session outcome as constructing a house from physically delivered material, assigning a resident and observing the saved world after reload. Measure time-to-first-building, task completion and observed confusion in G2; do not invent retention targets. | GDD §15.4 and G2 evidence. |
| Scope/evidence burden without capacity model | Keep the user's entire scope. No completion date is claimed; estimate/re-estimate the next gate at its start and record actual work/evidence. Block only on failed required evidence, never silently reduce Stage I. | Master spec §2, §12–14; gate-by-gate status. |
| Art feasibility discovered too late | At G2, validate representative character pivot, terrain transition, house footprint and cave seam with licensed/existing art; inventory source/license/hash before scaling to all assets. | G2 asset feasibility record; final asset acceptance remains G10. |
| Touch usability not demonstrated | G2 browser playtest runs first-time tasks: pan/zoom, assign/follow worker, deliver materials, build, reload, open/close inspection. Record completion and friction; distinguish Playwright/device emulation from a real-player/device test. | G2 E2E + usability notes; final device smoke remains G10/G11. |
| Sequential gates may delay learning | G2 is the first persistent vertical implementation loop; G3–G5 expand its security, resource and construction edge cases. The complete GDD gates continue afterward; this does not merge or remove any gate. | G2 acceptance requires delivery/build surviving reload; later gates cover full behavior. |

The suggested alternative to reduce Stage I scope is rejected by the user's direct requirement to complete the peaceful stage. Premises about the target experience are validated through the G5 playable loop and owner acceptance, not by changing the approved side-view or V1-isolation boundaries. A physical device is checked at G0; if unavailable, the real-device gate remains visibly blocked.

#### CEO Sections 1–11 (implementation-ready)

**Section 1 — Architecture.** Current scope is B1–B5 and the whole Peace Stage I only. No additions were approved; the optional 10× extras were skipped. Per user-selected Engineering D3, G2 is already V2-server-backed and persistent; G3–G11 extend that same isolated world.

```text
V1 (read-only legacy)                           V2 (new isolated service/data)
apps/client/src/phaser + old API        X       apps/client-v2 /peace-v2
apps/server + database avanpost         X       Fastify V2 API + V2 Postgres container/volume
                                                   │ authenticated/validated command boundary
                                                   ├── packages/peace-v2-shared (snapshot/errors/contracts)
                                                   ├── packages/peace-v2-sim (coordinates/graph/ledger rules)
                                                   ├── V2 domain (world/residents/economy/logistics/buildings)
                                                   └── versioned catalog + asset manifest
                                                          │ snapshot / command response
                                                          ▼
                                                     Phaser scene + DOM UI

G2: owner pairing ──> ApiWorldSource ──HTTP intents/snapshot──> V2 API ──transaction──> isolated V2 DB
G3+: same source/contracts, expanded account/session lifecycle, world and error coverage
```

G2 owner-code handoff:

```text
OpenCode launcher ──in-memory code──> 127.0.0.1-only owner handoff page ──copy──> owner's phone
                                      │                                      │
                                      └─ no code in stdout/chat/logs/storage  └─ LAN /peace-v2 pairing sheet
                                                                                │
                                                     private LAN, code POST only after explicit submit
                                                                                ▼
                                                     owner-scoped V2 session → mutations enabled
```

The handoff page is not proxied or exposed to LAN clients; authorize it from the actual loopback socket/listener, not `Host`/forwarded headers alone. Tests must deny direct LAN requests and forged forwarded-client headers.

The V2 API is the only writer; Phaser and DOM render snapshots and submit intents. `packages/peace-v2-sim` is pure TypeScript and does not import Phaser/Kysely/Fastify. PostgreSQL and the V2 process are operational single points of failure; on failure the last client snapshot is read-only, with a clear `offline` state. Rollback stops only the V2 process/container and keeps its DB volume for diagnosis; V1 is never a fallback writer.

Core flows:

```text
G2 128-bit launch/world-bound code -> origin/host check -> rate-limited atomic consume -> owner-scoped V2 session cookie -> world snapshot
  invalid/expired/reused/public interface -> deny mutation and show safe re-pair action; DB error -> 503, no partial world
G3+: expanded account/session lifecycle and world ownership checks

Command: intent+request_id+canonicalPayloadHash+expectedVersion -> Zod/size/owner -> world revision lock + sequence -> pure sim validation -> DB transaction/occupancy constraints -> effect+stored response commit -> snapshot
  invalid type/NaN/out-of-bounds -> 400, no mutation; stale -> 409 + latest snapshot; same request/hash -> exact prior response; same request/different hash -> 409, no second effect
  empty/zero footprint -> 422; overlap -> 409, no material debit; transaction error/timeout -> rollback; retain replay response for world lifetime, retry only with the same idempotency key

Tick: persisted server clock -> catch-up lease/remainingTicks -> same per-world lock/sequence as commands -> ordered ticks -> atomic source/movement/buffer transitions -> checkpoint -> snapshot
  no due ticks -> unchanged snapshot; zero workers/resources -> explicit idle; budget exceeded -> persist progress + remainingTicks/syncing and gate mutations
  worker/server restart -> resume from last committed tick; DB/constraint error -> rollback failed batch; no client time or FPS changes economic state

Assets/PWA: versioned manifest -> download to staged cache -> verify every checksum -> atomically activate
  empty/missing/hash mismatch -> keep old cache and show update failure; incompatible JS/atlas -> reject staged version
```

State machines and impossible transitions:

```text
cell: unknown -> discovered -> owned -> prepared -> occupied
  guard: owned != prepared; build only when owner+prepared+support+entrance+occupancy transaction pass
building: ghost -> awaiting_materials -> building -> complete -> upgrade/demolition -> removed
  guard: complete only after delivered materials + work; demolished cannot resurrect; sited building never teleports
haul: queued -> reserved -> to_source -> loading -> moving -> unloading -> complete
  failure: waiting_path/blocked retains cargo/reservation exactly once; complete requires unloaded_qty == loaded_qty
resident: idle -> commuting -> working|studying|hauling|building -> idle
  guard: one active incompatible assignment; work starts only at reachable work point
```

Performance risks: snapshots and grid retrieval, graph rebuild/pathfinding, catch-up tick loops, actor polling and asset memory. G0 records query/catalog sizes; G2 establishes a representative small-world baseline; G11 measures the master-spec small/medium/stress profiles (sectors, workers and cells) with frame rate, scene load and command latency. Avoid unanchored 10×/100× multipliers unless they are defined relative to those measured profiles. Chunked terrain/revision caching, indexed sector/coordinate lookups, viewport culling, bounded catch-up and explicit DB pools are implementation candidates, not proven fixes. No new microservice, broker, external API, or dependency is approved.

**Section 2 — Error & Rescue Registry.** Until concrete implementation classes are settled at G1, these are method-level contracts owned by the V2 API/domain task:

| Method/codepath | Failure / class | Rescued? / action | Player sees | Regression |
|---|---|---|---|---|
| `createSession` | DB unavailable / `DatabaseUnavailable` | Yes; no partial player, return retryable 503 | “Мир временно недоступен” | API+DB outage |
| `loadWorldSnapshot` | no world or mismatched version / `WorldMissing`, `SnapshotVersionError` | Yes; typed 404/409, never empty-success | onboarding only for genuine new world; otherwise refresh/update | missing vs empty vs stale |
| `authorizeCommand` | invalid/expired cookie or wrong owner / `Unauthorized`, `Forbidden` | Yes; no mutation, 401/403 | sign in again / action denied | cross-player IDOR attempt |
| `buildCommand` | bad footprint, support, entrance, conflict / `ValidationError`, `PlacementConflict` | Yes; transaction not entered or rolled back | exact ghost reason | overlap, NaN, bounds, stale version |
| `assignWork`/`startGather` | resident busy, no specialist/path / `AssignmentConflict`, `NoPath` | Yes; preserve prior assignment/location | actionable reason | parallel assignment and absent route |
| `loadCargo`/`unloadCargo` | conflict/crash / `ItemInvariantError` | Yes; atomic item transition, same `request_id` replay | paused haul with cargo location | crash injection between phases |
| `simulateCatchUp` | time budget/DB failure / `CatchUpBudget`, `DatabaseError` | Yes; retain remaining ticks; rollback failing transaction | syncing or retryable server error | deterministic split vs full interval |
| `startResearch`/`tickResearch` | missing scholar/tech/material / `ResearchUnavailable` | Yes; keep progress, no silent completion | named pause reason | zero scholar online+offline |
| `submitRoyalOrder` | duplicate/expired/reserved stock / `OrderConflict`, `InsufficientStock` | Yes; atomic consume/reward or full rollback | order reason, no duplicate reward | duplicate request and two submitters |
| `activateAssetManifest` | missing file/hash/version / `AssetIntegrityError` | Yes; preserve prior cache and report update rejected | last-good scene + update notice | mismatched JS/atlas upgrade |

No catch-all may convert an unknown failure into a successful empty snapshot. All unexpected errors log operation, `request_id`, world/tick, code and trace without secrets; only retry after reconciling uncertain transaction outcome.

**Section 3 — Security.** Attack surface is new V2 HTTP commands and a separate DB service. Session tokens are hashed and HttpOnly; every read/write is scoped from authenticated server-side player ID, never request `ownerId`. Validate integer coordinates, bounds, footprint, enum/catalog IDs, body size and `request_id`; reject HTML/script payloads and do not insert user content into scene markup. Use parameterized Kysely queries, command rate limits, DB least privilege and no V1 credential in V2 process. Test cross-player reads/writes, SQL/string injection, oversized payload, Unicode edge coordinates, duplicate requests and production rejection of test clock/admin fixtures. No secrets or payment integration are added.

| Threat | Likelihood | Impact | Mitigation/status |
|---|---|---|---|
| Forged world/player ID crosses ownership boundary | Medium | High | derive owner from session; every command/query scoped; `V2-REG-01` required |
| V2 process points at V1 DB | Low after guard; High before guard | Critical | fail-fast URL/database identity doctor before connect/migrate/test; no V1 env import |
| Malformed/huge coordinates or footprint cause invalid placement/resource exhaustion | Medium | High | Zod integer/bounds/body-size limits, typed graph validation, rate limit; `V2-REG-02` |
| SQL/XSS injection via user names, catalog IDs or dynamic filters | Low | High | parameterized Kysely, allow-listed IDs, DOM textContent/escaping, input bounds |
| Replay/concurrent commands double spend or reward | Medium | High | request-id unique constraint + row locks + atomic ledger; I-E2E-09/25 |
| Secrets leak into logs or test credentials leak to client | Low | High | redact cookies/DB URLs; log identifiers only; inspect browser bundle/log fixtures |

**Section 4 — Data/interaction edge cases.** Inputs are validated before generation/mutation; unknown fields reject; missing world is not an empty world; empty catalog has an explicit unavailable state; zero quantities do not create jobs; stale snapshot commands require refresh; timeout retries keep request ID; navigation away cancels visual ghost but not committed server work; lists update by stable IDs; offline cached world is read-only.

Concurrency boundary is one `(worldId, command request_id, expectedWorldVersion)` transaction. Duplicate command and concurrent build/haul/order operations must serialize by row/advisory lock plus unique constraints. Example:

```text
Build A: lock world/version -> reserve cells+materials -> commit version+1
Build B:                                  waits -> sees version+1/occupied -> 409, no materials
Haul A: lock source+destination -> loaded_qty++, source--, worker cargo++ -> commit
Topology B:                       lock world -> remove bridge, topologyRevision++ -> commit
Haul A next tick: compare route revision -> waiting_path, cargo remains worker-owned
Fresh consumer: reads one canonical snapshot; total item count is unchanged by both failures
```

Tests pause/release the commands at transaction boundaries to exercise both completion orders; parallel API E2E proves no duplicate building, order reward or cargo. Touch edge cases include double tap, stale submit, `pointercancel`, pinch during ghost, rotate/resize, panel open, network timeout and zero/large resident lists.

**Section 5 — Code quality.** Keep V2 shared schema/types in `packages/peace-v2-shared`, pure math in `packages/peace-v2-sim`, transactional ownership in V2 server domain, scene drawing in Phaser and DOM accessibility in UI. Do not copy the V1 world authority or add a second economy. Use domain-specific errors/results and explicit units. G0 must inventory current code so reuse is based on tests and API contracts, not file names. Keep methods cohesive and testable; split at meaningful responsibility, error or transaction boundaries rather than a numeric branch-count cap. Do not add an abstraction without a concrete V2 caller.

**Section 6 — Test review.** Flow map: `G0 V2 config/DB guard → isolated migration → server health`; `G2 pairing code → owner session → snapshot → render`; `input → command validation → sim rule → transaction → response`; `server clock → ordered domain transitions → checkpoint`; `asset manifest → checksum → versioned cache`; UI flows camera/selection/build/assignment/reload. G0 adds V2-specific Vitest and Playwright configs; the Playwright config must not invoke V1 `db:migrate`, server or client commands. Preserve all 30 GDD IDs in `TEST_MATRIX.md` and add supplemental G2 persistent-slice/pairing cases during G1; G1 fills exact assertions, failure paths and `no_claim`. G0 adds pure unit/property tests, each gate adds focused integration/browser scenarios. Pyramid: geometry/catalog/state unit tests; transactional PostgreSQL tests; focused Playwright real-API flows, including all 30 stage scenarios by G11. Critical paths include V1 DB rejection before connection/reset, single-use pairing, physical gather→haul→build→reload, item-ledger conservation, duplicate-command idempotency, and pointercancel. Chaos: fail API/DB across load/unload and catch-up, restart, then compare item hashes. No mocks replace actual V2 PostgreSQL/browser in required E2E; emulation does not claim real device.

**Section 7 — Performance.** Candidate slow paths are canonical world snapshot, topology mutation/path search and offline catch-up; per-sector terrain/actor/catalog reads may create N+1 behavior, but no V2 measurement exists. G0 records schema/query/catalog sizes. G2 measures a small-world baseline; G11 measures small, medium (multiple sectors/tens of workers) and stress (hundreds of active entities/many thousands of cells), reporting machine/OS, CPU/memory, browser/engine/build, world sizes, run count `N`, p50/p95, cold/warm cache state, steady/pathological case, interleaved G2-baseline/G11-branch results, and `reproduced on main?` (yes/no/N/A with a reason if V1 is not comparable). Measure frame rate, scene-load time, command latency and client/server memory; repeat scene open/close to detect retained actors/textures. Master-spec proposals are 60 FPS desktop and at least 30 FPS on a reasonable phone at standard zoom; they remain provisional targets, not measured claims or hard release thresholds until evaluated against G2/G11 evidence. Browser emulation is preliminary, never a real-device pass. Add indexes/bounds/caching only where measurements justify them; do not claim p99 or a 10×/100× speedup without a defined base and reproduced measurement.

**Section 8 — Observability.** Structured command logs include player/world/request ID, tick, command, latency, result/error, geometry/catalog versions; never tokens. Metrics include commands by code, catch-up remaining ticks/lag, haul ledger mismatch, waiting-path counts, route rebuilds, snapshot bytes/time, frame time/actor count, asset hash failure and PWA update outcome. Alert on any ledger mismatch, V1 DB target rejection, uncaught migration/transaction failure, or prolonged catch-up. G0 creates V2 startup/DB runbook; G3+ adds incident steps for safe retry/reconciliation and backup restore. Process artifacts `STATUS.md`/`NEXT_ACTION.md` are user-requested resume controls; system logs/evidence are product observability, not a substitute for behavior.

Day-one dashboard panels: API health/error code/latency; tick lag and remaining catch-up; per-item ledger mismatch count; active/waiting haul counts and causes; snapshot bytes/time and DB pool usage; client FPS/visible actors/asset cache version. Alert on any ledger mismatch, V1 DB target rejection, repeated 5xx or checksum mismatch. Runbooks document V2-only startup, recovery, rollback and last-good PWA cache.

**Section 9 — Deployment/rollback.** G0 uses a separate V2 PostgreSQL container/volume if available, with distinct `avanpost_v2_dev` and `avanpost_v2_test` databases. Preflight validates operation-specific V2 database names and local/compose host identities before connecting; after connection, verify actual server/database identity before migration/reset. Reject `avanpost`, `avanpost_test`, aliases and unapproved remote hosts. Bind localhost by default; explicit LAN mode prints the actual IP/port and never the pairing code. OpenCode displays that one-time code only through the loopback-only in-memory owner handoff; it is absent from stdout/tool output, chat, URLs, logs, evidence and persistent client storage. LAN mode allows only private interfaces and is never publicly exposed. Order: compile-only build → migrate only V2 DB → start V2 API/client → health/API/browser smoke. Rollback: stop only script-owned V2 processes; retain V2 volume and last snapshot; revert V2 branch commit; restore only V2 DB after identity confirmation. No V1 migrations, schema changes or fallthrough. The `/peace-v2` route is dev-only until G11.

**Section 10 — Long-term trajectory.** Reversibility is 4/5 before V2 data adoption and 3/5 after V2 worlds exist; isolated V1 means V2 can be stopped without converting legacy saves. Keep stable `residentId`, item IDs and versioned data catalog for later Stage II contracts, but do not create PvP APIs. Main debt risks are duplicate catalog truth, snapshot size, asset licensing and test runtime; assign owner/gate and retire each temporary G2 adapter at G3. A new engineer should start from `SOURCE_MAP.md`, `SCHEMA.md`, `API.md`, `SIMULATION.md` and runnable `PLAY_NOW.md`.

**Section 11 — Design & UX.** Classifier: OPERATE/game interface. First LAN visit shows the world read-only with a focused pairing sheet replacing the portrait mode bar; landscape/desktop places it in the approved right-inspector area. The sheet explains the local launcher code and blocks all mutations until the owner session exists. Entry is one visibly labelled full-code field with paste/manual input, an accessible show/hide control and a separate **Подключить** button; partial input never submits. Invalid, expired/reused and rate-limited states give safe next actions without echoing the code, attempt count or internal validation. Keep the code transient in client memory only and clear it on success or page unload. After pairing, the first viewport shows world/selected resident+route, resource/sync bar, and bottom select/build/dig modes. Panels are secondary and do not hide the selected plot. State coverage: pairing loading/empty/invalid/expired-or-reused/rate-limited/success; scene loading/empty/offline/ready/syncing; build catalog loading/empty/error/ready; ghost valid/invalid/material-wait/cancel; resident available/busy/commuting/working/studying; haul queued/in-flight/blocked/delivered; order available/reserved/expired/submitted. First-session journey: open the read-only world → enter launcher code → choose **Подключить** → see the saved world and selected resident/plot → inspect/assign reachable work → observe delivery → choose building and preview/confirm/cancel → reload to verify persistence. UI remains portrait-first; no unsupported feature cards/dashboard mosaics. Accessibility gates include a visible label and keyboard focus for pairing, polite live announcements for its state/errors, non-color-only status, contrast, 44px touch targets, safe area, reduced-motion, and controls that are unavailable to assistive technology until pairing succeeds. Run `/plan-design-review` and later `/design-review` after rendered UI exists.

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Pairing | verify owner code after explicit submit | labelled full-code field with paste/manual entry and show/hide | invalid → recheck; expired/reused → request fresh code; rate-limited → wait/retry; no code, attempt-count or internal-validation disclosure | explicit **Подключить** establishes owner session; mutations enabled | visible read-only world; no auto-submit; code remains transient and is cleared on success/page unload |
| Scene | syncing + last snapshot | guided first plot | retryable offline/server banner | world and actors visible | cached read-only scene |
| Build catalog/ghost | list busy | no eligible building + next action | exact support/ownership/material reason | accepted footprint highlight | waiting materials/progress |
| Resident/assignment | list busy | no residents/available worker | busy/invalid assignment reason | worker and route selected | commuting/studying/blocked route |
| Haul/logistics | queue busy | no active haul | no-path/full-destination reason | delivered at named store | waiting_path with cargo visible |
| Research/orders | state loading | no unlocked project/order | no scholar/stock/expired reason | progress/reward once | paused with retained progress/reservation |

| Step | User does | User feels | Plan support |
|---|---|---|---|
| 1 | Opens the phone URL | “I can see what I’m connecting to” | real world is visible read-only; pairing sheet explains the local owner code; all world mutations disabled |
| 2 | Enters the code, or recovers from an error | “I know what to do next” | invalid → check code; expired/reused → request a fresh code; rate-limited → wait and retry; never echo secret/attempt count |
| 3 | Pairs successfully and explores | “This is my saved world” | owner session established; actual V2 resources/sync shown; first-use path can resume |
| 4 | Selects a resident and assigns reachable work | “This person has a real job” | stable identity, work, route and reason visible |
| 5 | Chooses a building and watches materials travel | “I control where it goes; the economy is physical” | grid ghost, footprint, safe cancel; worker follows route and cargo reaches a named buffer |
| 6 | Reloads/uses portrait view | “My world persisted and fits my device” | canonical server snapshot, safe area, read-only offline state |

Time-horizon check: in the first 5 seconds, the owner sees the settlement and understands why pairing is needed; within 5 minutes, they pair, assign reachable work, observe delivery, build and reload; over repeated play, stable identity and truthful save/sync state make the world feel dependable rather than disposable.

User flow:

```text
Open /peace-v2 -> visible read-only world + pairing sheet -> owner-code check
       │ invalid / expired or reused / rate-limited
       └ -> safe reason + next action; mutations remain disabled
       │ valid one-time owner pairing
       ▼
paired session -> (offline?) last snapshot read-only -> reconnect/sync
       │ new world
       ▼
View settlement -> select resident -> inspect route/work state -> assign intent
      │ choose build
      ▼
Catalog -> ghost/grid -> valid? yes: confirm -> server result -> physical haul/build -> persisted snapshot
                    └ no: reason + cancel/adjust
      │ select resident/production
      ▼
Residents / logistics / research / orders bottom sheet -> action -> success or typed reason -> return to scene
```

**Section outcome:** six CEO findings are dispositioned above; additional work is verification and clarity inside approved requirements. No new player-facing capability, Stage II scope, V1 migration, merge or deploy is approved.

**0H document approval:** The user's direct instruction to execute the master spec autonomously authorizes this plan and CEO summary as working documents, only insofar as they preserve B1–B5 and add no capability beyond the master spec. This is not code approval, owner acceptance, or permission to touch V1, merge, deploy, or start Stage II.

**0I temporal interrogation** (effort is `[estimated]`, not a release date):

| Horizon | Implementer needs to resolve | Deliverable / effort |
|---|---|---|
| Hour 1: foundations | V2 DB isolation; schema/catalog versions; signed coordinates; source-of-truth and screen ownership | G0/G1 contracts and doctor; human 2–4 days / CC+gstack 4–8 hours `[estimated]` |
| Hours 2–3: core | G2 API-backed vertical slice: reachable worker, physical delivery, basic construction/cave path and persistence; no fixture→API swap | G2/G3/G5 contracts and tests; human 1–2 weeks / CC+gstack 2–4 days `[estimated]`, re-estimate after breakdown |
| Hours 4–5: integration | load/unload crash points, catch-up concurrency, school/research roles, order idempotency, safe retries | G4–G9 domain contracts and concurrency/offline tests; human 4–8 weeks / CC+gstack 3–7 days `[estimated]` |
| Hour 6+: polish/tests | all 30 E2E fixtures, art licenses/pivots, PWA upgrade, physical-device evidence, runbooks and regression load | G10/G11 trace bundles and release record; human 3–6 weeks plus any external art/device access / CC+gstack 3–8 days `[estimated]` |

These estimates are broad because the current branch has no V2 world schema, simulation or playtest measurements. Re-estimate before G2 and after the first real server-backed haul; do not infer completion dates from them.

**Approval readiness: PASS for the review packet only.** Direct user approval references B1–B5; there are no optional additions, approved scope cuts, or pending product decisions. G1 itself remains `IN_PROGRESS` until the remaining review phases and matrix verification pass.

#### NOT in scope

- PvP/outpost/combat/classes/healing/loot/ranking/leagues/bots (GDD Part II, §§7–12).
- Player marketplace/trading-post/listings/currency settlement (GDD §13.1–13.2, §13.4–13.11); only peaceful royal orders §13.3 are included.
- Premium currency, payments and acceleration (GDD §14).
- V1 world migration, mutation of V1 code/schema/database, merge to `main`, production deploy, public dev hosting, or any new game feature outside peaceful Stage I.
- Hosted CI/CD workflows and public artifact publication are deferred; OpenCode runs and records each gate's local build, typecheck, test and browser evidence. G11 may prepare a feature-branch PR but does not merge or deploy.
- No scope items are deferred to `TODOS.md`; none exists and no separate proposal was approved.

#### What already exists

| Sub-problem | Existing implementation/evidence | Planned treatment |
|---|---|---|
| Stack/workspace | `docs/adr/0001-stack-and-repo-layout.md`, `package.json` | reuse Phaser 3, TypeScript, Vite, Fastify, Kysely and workspaces |
| Server-authored world/session | `apps/server/src/app.ts`, `apps/server/src/db/` | adapt handlers/runtime; point only at isolated V2 DB |
| Offline tick/catch-up | `docs/adr/0005-server-time-and-offline.md`, `apps/server/src/domain/simulate.ts` | reuse clock/determinism lessons; V2 state/schema is new |
| Resident/craft/research domains | `apps/server/src/domain/population.ts`, `craft.ts`, `research.ts` | reuse pure/catalog rules only after tests; no V1 persistence coupling |
| Phaser scene/DOM UI and placement | `apps/client/src/phaser/main.ts`, `apps/client/src/game/scene.ts` | retain V1 unchanged; implement `/peace-v2` in `apps/client-v2` against the V2 API; fixtures are test-only |
| Side-view visual spike | `apps/client/src/spike/scene.ts` and assets | reuse as renderer/art reference only; it is not saved or authoritative |
| V1 database defaults | `docker-compose.yml`, `apps/server/src/config.ts` | never run existing V1 dev/migration scripts for V2; new target guard required |

#### Dream state delta

```text
Current: Phaser V1 settlement + server I.5 and a visual-only side-view spike
   -> G2: persistent playable gather/haul/build vertical slice with an accessible cave path
   -> G3-G6: expand and harden persistence, resources, construction, sectors and underground rules
   -> G6-G9: full peaceful progression and orders
   -> G10-G11: production art, mobile/PWA, all 30 acceptance journeys
Ideal: an independently playable, self-sustaining human settlement on one continuous surface/underground world; PvP remains dormant until owner acceptance.
```

#### Error & Rescue Registry

| Method/codepath | Exception/failure | Rescued? / rescue action | User sees | Test |
|---|---|---|---|---|
| `V2Session#create` | missing/expired auth, DB unavailable | yes; 401/503, no world mutation | sign-in or retryable outage | session/API tests |
| `V2World#snapshot` | missing world, empty world, stale schema | yes; distinguish 404/new-world from 409/version conflict | onboarding or refresh/update | missing/empty/stale tests |
| `V2Command#authorize` | wrong owner/world | yes; 403 and no transaction | action denied | `V2-REG-01` |
| `BuildCommand#execute` | invalid bounds, unsupported/overlap/entrance, insufficient materials | yes; reject before mutation or rollback full transaction | precise ghost/inspector reason | `V2-REG-02`, I-E2E-02/12/13 |
| `HaulTask#load/#unload` | partial crash, stale route, duplicate retry | yes; atomic ledger, waiting_path retains cargo, same request returns stored response | named pause and cargo location | I-E2E-03/04/09, V2-REG-03 |
| `WorldClock#catchUp` | budget exhausted, clock/DB failure | yes; checkpoint completed ticks and remaining ticks; rollback failed tick | syncing/retry | I-E2E-19/22 |
| `Training/Research#advance` | no room/scholar/path, invalid class | yes; pause with progress retained | exact reason | I-E2E-14–20 |
| `RoyalOrder#submit` | expired/duplicate/reserved stock | yes; transaction returns one result/reward or rolls back | named order status | I-E2E-24/25 |
| `AssetManifest#activate` | checksum/key/version mismatch | yes; keep last-good cache | update rejected; cached scene stays | I-E2E-29 |

#### Failure Modes Registry

| CODEPATH | FAILURE MODE | RESCUED? | TEST? | USER SEES? | LOGGED? |
|---|---|---:|---:|---|---:|
| Session | invalid/expired or wrong owner | Y | Y | sign-in/denied | Y |
| Snapshot | DB unavailable or version mismatch | Y | Y | retry/update, never fake empty world | Y |
| Build/demolish | invalid footprint, collision, no support/entrance, would disconnect | Y | Y | cell reason; no partial spend | Y |
| Haul | crash between load/unload or route removal | Y | Y | waiting with exact cargo location | Y |
| Catch-up | tick budget or transaction failure | Y | Y | syncing/retry; no skipped time | Y |
| Research/orders | absent worker, duplicate reward, expired order | Y | Y | pause/rejection reason | Y |
| PWA | mismatched asset manifest | Y | Y | keep last-good scene/update error | Y |

#### Diagrams and stale-diagram audit

The system, state, request/error and first-player diagrams are in “CEO Sections 1–11” above. Deploy/rollback sequence:

```text
new V2 volume/container -> create dev/test DBs -> doctor identity guard -> V2-only migrations
 -> start API+client localhost -> health -> browser E2E -> optional explicit LAN mode
failure: stop only V2-owned process -> keep volume -> inspect evidence -> revert V2 commit/restore V2 backup
never: point V2 at `avanpost`, stop/delete V1, merge, deploy production
```

Current V2 plan contains four diagrams (architecture, command/tick/assets flows, state machines/concurrency, UI flow) plus deployment/rollback above. They match the planned `WorldSource` boundary and V2-only DB. The archived side-view analysis remains historical reference and is not edited; its V1 migration diagrams are not adopted as V2 steps.

## Implementation Tasks

Synthesized from CEO and Engineering reviews. Checkboxes show current execution progress; gstack JSONL is phase-specific and the actual gate checklist remains in G0–G11.

- [x] **T1 (P0, human: ~2–3 days / CC+gstack: ~1 day, estimated)** — G0 — baseline/doctor, isolated V2 databases, V2-only Vitest/Playwright configs, compile-only `build:peace:v2` and root build coverage. Preflight database/host allowlists before connect; verify actual identity before migration/reset; reject both `avanpost` and `avanpost_test`; verify no V1 runtime, scripts, containers or DB are changed. Evidence: `docs/v2/evidence/G0/REQ-0003/`, `REQ-0004/`, `V2-DBSAFE-01/`, `V2-BASELINE-01/`, and `V2-RUNBOOK-01/`.
- [x] **T2 (P1, human: ~3–4 days / CC+gstack: ~1 day, estimated)** — G1 — complete requirement map, failure/rescue, API/schema/simulation/economy/building contracts and test matrix. Assign stable `REQ-####` IDs, implement `check:peace:v2:source-map`, and add V2-DBSAFE-01, V2-PAIR-01 and V2-PV-01 without renumbering I-E2E-01..30; verify each source row maps to an observable assertion and evidence path. Evidence: `SOURCE_MAP.md` 37-row source/test trace, `TEST_MATRIX.md`, `check:peace:v2:source-map`, `check:peace:v2:contracts`, 43 V2 unit tests, and `V2-DBSAFE-01` / `V2-CATALOG-01` artifacts. G1 disposition PASS by user B8/D7-A; CEO concern remains recorded, with no independent reread claimed.
- [ ] **T3 (P1, human: ~2–3 weeks / CC+gstack: ~3–5 days, estimated)** — G2 — persistent playable vertical slice. Implement a launcher/world-bound 128-bit pairing code `[estimated security default]` (5-minute expiry and five failed attempts per source/instance per five minutes `[estimated defaults]`, atomic one-use), owner-scoped session, isolated V2 API/Postgres flow, portrait touch, reachable worker, physical delivery/building and reload persistence. Verify browser E2E and no V1 service/database access.
- [ ] **T4 (P1, human: ~2 weeks / CC+gstack: ~2 days, estimated)** — G3–G5 — expand and harden the G2 gather→haul→build loop. Verify complete API/session/error coverage, broader item conservation, full resource/footprint edge cases, restart and recovery without duplicating the minimum G2 slice.
- [ ] **T5 (P1, human: ~4 weeks / CC+gstack: ~4 days, estimated)** — G6–G9 — sectors, residents/schools, production/research, orders. Verify full catalog and relevant I-E2E tests.
- [ ] **T6 (P1, human: ~4 weeks plus art/device / CC+gstack: ~1 week, estimated)** — G10–G11 — final asset/PWA/mobile, 30-test regression and performance profile evidence. Verify no P0/P1; record FPS, scene-load, command p50/p95 and memory at master-spec scales; physical-device absence remains a named blocker.

No optional scope proposals were accepted; no CEO TODOs are proposed. The estimates are planning ranges, not a delivery date.

## Completion Summary

```text
  +====================================================================+
  |              MEGA PLAN REVIEW — CEO PHASE SUMMARY                  |
  +====================================================================+
  | Mode selected        | SELECTIVE_EXPANSION                         |
  | System Audit         | Phaser/Fastify/Postgres V1, no V2 authority   |
  | Step 0               | new-core, V1-safe, no optional additions     |
  | Section 1 (Arch)     | 4 architectural risks mapped                 |
  | Section 2 (Errors)   | 9 codepaths mapped, 0 silent critical gaps   |
  | Section 3 (Security) | 6 threat classes, mitigations specified      |
  | Section 4 (Data/UX)  | command/tick/asset flows + concurrency cases |
  | Section 5 (Quality)  | 2 boundary/reuse risks                       |
  | Section 6 (Tests)    | 30 GDD scenarios + 3 supplemental regressions|
  | Section 7 (Perf)     | 3 unmeasured hot paths                       |
  | Section 8 (Observ)   | metrics, dashboards, alerts and runbooks     |
  | Section 9 (Deploy)   | V2-only startup, rollback and LAN boundary    |
  | Section 10 (Future)  | reversibility 4/5 pre-data, 3/5 post-data     |
  | Section 11 (Design)  | UI states, user journey and accessibility    |
  +--------------------------------------------------------------------+
  | NOT in scope         | 5 explicit groups                           |
  | What already exists  | 7 reuse/adapt/archive rows                  |
  | Dream state delta    | written                                    |
  | Error/rescue registry| 9 rows, 0 silent critical gaps             |
  | Failure modes        | 7 capability rows, 0 critical gaps         |
  | TODOS.md updates     | 0 proposed                                 |
  | Scope proposals      | 1 optional candidate, 0 accepted            |
  | CEO plan             | saved in ~/.gstack/projects/avanpost/ceo-plans/ |
  | Outside voice        | unavailable; Codex/Aside/Plan fallback absent|
  | Lake Score           | N/A (no scored coverage decisions)          |
  | Diagrams produced    | architecture/flows/states/UI/deploy/rollback|
  | Stale diagrams found | 0                                          |
  | Unresolved decisions | 1: spec not independently re-verified       |
  | Reality rows         | 14/14 PLAN_REALITY, 0 unverified             |
  +====================================================================+
```

### Unresolved Decisions

- `spec not re-verified`: 8 findings from the third spec review were manually reconciled, but no independent spec reviewer re-read the amended plan after the three-launch cap. G1 stays `IN_PROGRESS`; do not claim a clean independent spec audit.

```text

<!-- autoplan-baseline-edits:ceo {"sourceSha256":"8de73958f09e77adc40e8da0d1e4ea1cbd01d0a40a8f1994d15468c125a28944","replacements":[{"oldText":"|---|---|---|\n| G0 | Safe baseline, source map, decisions, schema/API contracts, isolated V2 dev/test databases and doctor | V1 untouched; DB identity logged and guarded; restore evidence if V1 access permits; no V1 URL used by V2 |\n| G1 | Reviewed plan plus full requirement-to-gate-to-evidence matrix | every applicable GDD §1–6, §13.3, §15–17, §19–21, §23 item maps to an owner, gate, test/evidence and PASS/BLOCKED/N/A rationale; CEO, Design, DX and Eng review results recorded |\n| G2 | Early interactive Phaser side-view at `/peace-v2` | Real browser E2E; pan/zoom/touch, terrain/underground, actors, selectable worker, ghost placement, route; explicitly labeled demo seed |\n| G3 | V2 authoritative world and persistence | New V2 DB, API/session/snapshot, deterministic world, movement and reload/restart persistence |\n","newText":"|---|---|---|\n| G0 | Safe baseline, source map, decisions, schema/API/simulation/economy/building contracts, isolated V2 dev/test databases and doctor | V1 untouched; DB identity logged and guarded; restore evidence if V1 access permits; no V1 URL used by V2 |\n| G1 | Reviewed plan plus full requirement-to-gate-to-evidence matrix and failure/rescue contracts | `SOURCE_MAP.md`, `TEST_MATRIX.md`, and API/simulation/economy/building contracts map every applicable GDD §1–6, §13.3, §15–17, §19–21, §23 item to owner, gate, observable assertion, error/rescue behavior, evidence path, and PASS/BLOCKED/N/A rationale; CEO, Design, DX and Eng results recorded |\n| G2 | Early interactive Phaser side-view at `/peace-v2` | Verified browser E2E at 390×844 and desktop; pan/zoom/touch, surface and a fixture-only underground seam/cave, selectable worker, visual route, ghost and cancel. No authoritative dig, economy, or save exists until G3/G6; demo source explicitly labeled non-authoritative |\n| G3 | V2 authoritative world and persistence | New V2 DB, auth/session/state/commands, deterministic world and movement; refresh and API restart preserve server snapshot; invalid/stale/duplicate commands return typed errors |\n"},{"oldText":"| G6 | Sectors, exploration and underground | deterministic sector seams, ownership vs preparation, reachable dig/work point, stairs/tunnel, interruption/restart, unique deposits and cart restrictions tested |\n| G7 | Population and four civil schools | one resident identity/active assignment; housing cap, arrival/work/study positions persist; all 23 proposed catalog entries and school permutations validated |\n| G8 | Multi-stage production and research | real inputs/fuel/buffers/output, deterministic quality, all peaceful branches, no scientist/no progress, offline equivalence and recipe failure states tested |\n| G9 | Royal orders and sustainable peaceful progression | actual stock reserved and submitted once; order expiry/limits/partial state explicit; clean account completes a peaceful order without admin tools |\n| G10 | Final art, mobile UX, sound and PWA | manifest fields/checksums validate; no missing required art or placeholder at Stage I acceptance; 390×844, 375×667, 844×390 and desktop layouts; real-device smoke before release |\n| G11 | Full Stage I regression and release candidate | all 30 GDD §21.2 scenarios have script, fixture, expected result, actual result, trace/SHA; zero open P0/P1; review/QA/ship evidence; `STAGE_I_AUTO_QA: PASS`, owner acceptance stays `PENDING` |\n\n","newText":"| G6 | Sectors, exploration and underground | deterministic sector seams, ownership vs preparation, reachable dig/work point, stairs/tunnel, interruption/restart, unique deposits and cart restrictions tested |\n| G7 | Population and four civil schools | one resident identity/active assignment; housing cap, arrival/work/study positions persist; all 23 catalog entries validated: 4 one-school, 6 commutative pairs, 12 triples whose first pair is commutative and final school is ordered |\n| G8 | Multi-stage production and research | real inputs/fuel/buffers/output, deterministic quality, all peaceful branches, no-scientist pause and recipe failures tested; with identical seed and ordered commands, one hour online vs offline yields exact canonical world/item-ledger hashes |\n| G9 | Royal orders and sustainable peaceful progression | actual stock reserved and submitted once; order expiry/limits/partial state explicit; clean account completes a peaceful order without admin tools |\n| G10 | Final art, mobile UX, sound and PWA | manifest fields/checksums validate; no missing required art or placeholder at Stage I acceptance; 390×844, 375×667, 844×390 and 1440×900; safe-area respected; controls ≥44×44 CSS px; inspector never hides the selected placement; physical-device smoke before release |\n| G11 | Full Stage I regression and release candidate | all 30 GDD §21.2 scenarios have script, fixture, expected/actual result, log/trace and SHA under `docs/v2/evidence/<gate>/<test-id>/`; zero open P0/P1; gstack review/QA and safe `ship` PR-preparation evidence; no merge/deploy; `STAGE_I_AUTO_QA: PASS`, owner acceptance stays `PENDING` |\n\nCritical dependency chain is `G0 → G1 → G2 → G3 → G4 → G5 → G6 → G7 → G8 → G9 → G10 → G11`. Subtasks may be parallelized only when they do not share a schema, content catalog, or visual-state contract; no parallel track may bypass a gate. The plan does not claim a completion date or a staffing capacity that has not been measured.\n\n"},{"oldText":"\n- **Owner:** OpenCode executes code, tests, browser checks, reports and branch commits. The project owner is only needed for the explicit final hands-on game acceptance; no technical step is delegated to the owner.\n- **Demo boundary G2→G3:** G2 implements a `WorldSource` interface with a disposable deterministic fixture source. It may animate a worker route and accept non-persistent visual interactions, but does not change item balances or claim to save a world. G3 adds the API-backed source implementing the same snapshot/command contract and removes demo mutation from the normal playable route. A failed API or missing V2 DB blocks G3, not the already-labeled G2 demo.\n- **Failure matrix:** expired/missing session → 401 and re-session; missing world/layout → typed error and no scene mutation; empty world → explicit onboarding/empty scene; stale version/duplicate `request_id` → prior result or conflict without double effects; unreachable work point → waiting state with reason; interrupted load/unload → item ledger remains conserved; full input/output/storage → work waits without dropping stock; catch-up budget → `syncing` with remaining work; incompatible PWA assets → retain old manifest or reject update atomically.\n- **Severity:** P0 means data loss/duplication, unauthorized access, V1 contamination, or a core play path unusable. P1 means a mandatory GDD scenario or major user interaction is wrong/unavailable. P2 means a non-blocking visual/quality issue that does not violate an acceptance budget. G11 requires zero open P0/P1; every P2 is listed with owner and disposition.\n- **Device evidence:** browser E2E covers the named master-spec viewports (390×844, 375×667, 844×390, 1440×900). Device emulation is not a real-device pass. If no physical mobile device is reachable, report `BLOCKED` for the release gate rather than claiming the smoke passed.\n- **Art evidence:** each asset row includes ID, stage/group/role, source/license, path, dimensions/pivot/atlas/frames/animation and quality state; checksums are validated by the manifest. Temporary art is allowed only for G2–G9 and cannot close G10/G11.\n- **Release labels:** `P0/P1` must be fixed and retested; `STAGE_I_AUTO_QA: PASS` is the technical release candidate; `STAGE_I_OWNER_ACCEPTANCE: PENDING` remains until the owner has played it. Neither status authorizes PvP, merge or production deploy.\n\n","newText":"\n- **Owner:** OpenCode executes code, tests, browser checks, reports and branch commits. Each gate's owner is the V2 implementation task; the project owner is only needed for explicit final hands-on game acceptance. No technical step is delegated to the owner.\n- **Demo boundary G2→G3:** G2 implements a `WorldSource` interface with a disposable deterministic fixture source. It may animate a worker route and accept non-persistent visual interactions, but does not change item balances or claim to save a world. G3 adds the API-backed source implementing the same snapshot/command contract and removes demo mutation from the normal playable route. A failed API or missing V2 DB blocks G3, not the already-labeled G2 demo.\n- **Failure matrix:** expired/missing session → 401, user-visible sign-in retry and no world mutation; missing world/layout → typed 404/409 and no scene mutation; empty world → explicit onboarding/empty scene; stale version → 409 plus fresh snapshot; duplicate `request_id` → exact stored response, no repeated effects; unreachable work point → waiting state and reason; interrupted haul load/unload → transaction leaves item at exactly one location; full input/output/storage or no worker/specialist/fuel → explicit idle reason without dropping stock; absent scientist → research pauses online and offline; duplicate/expired royal-order submission → no second reward; catch-up cap → `202 syncing` with remaining ticks and no retroactive command; incompatible PWA assets → keep old manifest/cache or reject update atomically. G1 records endpoint/state/error assertion and a failure-path test per row.\n- **Severity:** P0 means data loss/duplication, unauthorized access, V1 contamination, or a core play path unusable. P1 means a mandatory GDD scenario or major user interaction is wrong/unavailable. P2 means a non-blocking visual/quality issue that does not violate an acceptance budget. G11 requires zero open P0/P1; every P2 is listed with owner and disposition.\n- **Device evidence:** browser E2E covers master-spec viewports 390×844, 375×667, 844×390, and 1440×900. Touch pan is one-finger drag; pinch zooms around gesture centroid; `pointercancel` never confirms placement; all controls are ≥44×44 CSS px, safe-area insets are honored, and the selected plot stays visible when panels open. Device emulation is not a real-device pass. OpenCode performs a physical-device smoke if a connected device is available; otherwise G10/G11 are `BLOCKED` with the missing-device evidence recorded, not falsely passed.\n- **Art evidence:** each asset row in `content/peace-v2/assets/manifest.json` includes ID, stage/group/role, source/license, path, dimensions/pivot/atlas/frames/animation and quality state; checksums are validated by the manifest. Temporary art is allowed only for G2–G9 and cannot close G10/G11. OpenCode owns generated/curated evidence; an external asset blocker is named per row.\n- **Release labels:** `P0/P1` must be fixed and retested; `STAGE_I_AUTO_QA: PASS` is the technical release candidate; `STAGE_I_OWNER_ACCEPTANCE: PENDING` remains until the owner has played it. `gstack-ship` may push the feature branch and prepare a PR if authenticated; merge, production deploy, release publication and PvP remain forbidden.\n- **Evidence retention:** every gate stores command, exit code, test count, database identifier (never secrets), browser trace/screenshot, and commit SHA in `docs/v2/evidence/<gate>/<test-id>/`; status links to those exact artifacts. Missing trace/test output blocks PASS.\n\n"},{"oldText":"\n1. Complete G0 audit and create `BASELINE.md`, `SOURCE_MAP.md`, `DECISIONS.md`, `SCHEMA.md`, `API.md`, and isolated V2 DBs.\n2. Complete G1 via autoplan using this plan and the master spec as the primary task definition; produce `TEST_MATRIX.md` before G2.\n3. Start G2 immediately after reviewed plan closure; do not wait for complete art or later economy packages.\n","newText":"\n1. Complete G0 audit and create `BASELINE.md`, `SOURCE_MAP.md`, `DECISIONS.md`, `SCHEMA.md`, `API.md`, `SIMULATION.md`, `ECONOMY.md`, `BUILDINGS.md`, `CONTENT.md`, and isolated V2 DBs.\n2. Complete G1 via autoplan using this plan and the master spec as the primary task definition; produce `TEST_MATRIX.md` and the failure/rescue registry before G2.\n3. Start G2 immediately after reviewed plan closure; do not wait for complete art or later economy packages.\n"}]} -->


```
<!-- autoplan-baseline-edits:ceo {"sourceSha256":"3356acb16a06c6b006da84798c53634d579a38bc6e55bc306c764f86b1f1b1a5","replacements":[]} -->
<!-- autoplan-accepted:ceo -->
- Hold the user's scope: complete peaceful Stage I, early playable G2, strict side-view, Phaser, server-authoritative economy, V1 and its database untouched; no PvP/market/payment/production deploy/merge. Verification: gates G0–G11 and the GDD §21.2 test matrix.
<!-- /autoplan-accepted:ceo -->

### Accepted design requirements

<!-- autoplan-baseline-edits:design {"sourceSha256":"04804a348e29f2f9299deba28a0b04e735ca2160db7e9e87c4192ac588623bea","replacements":[]} -->

<!-- autoplan-accepted:design -->
- The following detailed G2 viewport budgets supersede the earlier shorthand: usable height excludes safe-area insets; top HUD ≤8%, persistent mode bar ≤12%, and unobscured world ≥60% in normal/placement states. Expanded inspector replaces rather than stacks with the mode bar, is ≤35% including controls, leaves ≥55% unobscured world, and auto-collapses during placement to restore ≥60%. At 375×667 the sheet scrolls without covering confirm/cancel.
- Catalog groups mirror GDD building categories. Each item shows name/icon, footprint, material/technology requirement, availability and a single selection action. Selecting is distinct from placement; preview shows a text+icon reason adjacent to the footprint; confirm and cancel are separate visible controls.
- G2 HUD shows actual V2 resource counts and save/sync state; it never shows the old `ДЕМО · НЕ СОХРАНЯЕТСЯ` label or presents fixture counts as authoritative. First LAN use requires a clear one-time pairing-code step and recovery action before world commands are enabled. The world remains the visual anchor; selected resident gets identity/portrait+label, route has turns+text blockage reason, plot/target outlines differ by shape and icon.
- DOM controls have visible focus and keyboard order; canvas actors have parallel accessible list/buttons and names; selection, sync, command and placement results announce through a polite live region. G2 implements persistent world, route, build and recovery states; later gates add research/order/offline domain states with concrete recovery actions.
- G2 acceptance checks catalog categories/labels, separation of item selection vs placement, no-input/no-material/blocked route explanations, portrait sheet recovery, and the first-use flow. Tokens, pivot, route and ghost must remain legible at 390×844, 375×667 and 1440×900 before G3 uses them.
- Portrait overflow behavior is explicit at both 390×844 and 375×667: compact resource/sync indicators stay in the ≤8% top strip; the ≤12% bottom mode bar is replaced by the expanded inspector, not stacked. The inspector scrolls internally within ≤35% usable height, keeps selected resident/route and the contextual action visible, and leaves ≥55% unobscured world. Placement auto-collapses it; secondary resource detail remains available in the resource inspector rather than squeezing the world.
- Portrait placement flow: opening the catalog replaces the mode bar with a scrollable catalog sheet; selecting an item closes the catalog and shows its world-space ghost. Tap a cell to position the ghost; drag beginning on the ghost moves it; drag beginning on empty world pans the camera; two-finger pan/pinch moves/zooms the camera while the ghost remains anchored to its world cell. Keep the ghost at least 48 px above the active finger where possible, clamp it to the viewport edge with the selected footprint visible, and show fixed 44×44 confirm/cancel controls in the bottom action area. Invalid reason is adjacent to the footprint; confirm is disabled until valid; cancel exits placement without changing the world.
- Later-game work states surface on the affected actor/building via status icon+label and in the accessible world-entity list. Selecting the status highlights the entity and opens its inspector with current progress/location, exact blocker, and one primary recovery action. Blocked haul → “Показать проблему” and source/destination; research paused → show missing scholar/input and valid assignment/source action; expired order → refresh/close; material wait → open compatible source/haul action; syncing/stale/offline → sync state, last confirmed version, retry/refresh. Interrupted work preserves cargo/progress and exposes its location.
- G2 first-use completion gives a brief non-blocking confirmation that the accepted action was saved, then returns to free exploration. A persistent help action can resume/restart the short path; it never blocks world input or implies persistence for an unconfirmed action.
- Landscape 844×390 uses a right inspector up to 280 px / 36% usable width, bottom modes, and at least 60% clear world width; desktop 1440×900 uses a 320 px right inspector capped at 28% width. On resize, keep selection/camera, collapse the inspector to the mode sheet if portrait constraints would be violated, and keep confirm/cancel visible during placement.
- G2 loads its initial scene from the authoritative V2 snapshot and announces “Мир подключён · изменения сохраняются” with connection status. Preserve camera and selection across reload only when stable IDs exist in the snapshot; never submit an unconfirmed ghost.
- Preserve approved design D1–D10 from the preceding plan review where consistent with master spec: one continuous side-view surface/underground cross-section; HUD variant A (selected object/route, compact resources/sync at top, modes at bottom); inspector collapses to a bottom sheet on portrait; no zoom-to-fit whole-world requirement.
- World grid remains 1:1 at 48 px/cell; resident silhouette is approximately 64 px; zoom range 0.5–3.0, default 1.0 desktop / 0.75 portrait; camera pans both axes, zooms around gesture centroid and offers recenter. Values remain catalog/configuration data and are validated on the prototype.
- Touch is first-class: one-finger camera pan, pinch zoom, ghost offset at least 48 px above finger, separate confirmation tap; drag/pinch/`pointercancel` never place or submit. Selected route and target plot stay visible when the inspector opens.
- Use the existing approved readability-token roles from the prior plan §9.10 as proposed V2 tokens (earth/soil/rock, building/actor accents, route/valid/invalid/selection, panel/text). Full `DESIGN.md` is not a G1 blocker; visual quality is judged on rendered G2 and may tune proposed values without changing GDD behavior.
- Art direction follows GDD §16.1: hand-drawn medieval humans/buildings, soft texture, readable silhouettes. Use downloaded licensed Kenney assets as side-view-compatible placeholders through G2–G9; no rectangles/emoji as final art and no top-down assets passed off as side-view. Replace all placeholders with approved final art by G10.
- Verify portrait/landscape at master-spec viewports, ≥44×44 CSS px controls, ≥16 px body text, text contrast ≥4.5:1, status contrast ≥3:1, safe-area, reduced-motion, and non-color-only status cues. Browser emulation is not physical-device evidence.
- Evidence: Playwright touch flow at 390×844 and 375×667, landscape 844×390, desktop 1440×900; G2 records a first-use friction/task-completion note, and G10 requires physical-device smoke if hardware is accessible.
- G2 hierarchy: continuous world and the marked resident/available plot first; compact real resources and sync second; selected resident/route and one contextual next action third; build/dig/select modes at the bottom. No competing modals or permanent empty inspector.
- G2 first-use playable path: open the local owner session or pair the phone once → pan to a resident → inspect/assign a reachable task → observe physical movement and item delivery → place a building with the ghost and confirm/cancel → reload and verify the saved V2 state. Every successful mutation is authoritative; unconfirmed placement changes nothing.
- UI states show user-facing cue + recovery action for scene/loading/empty/offline/syncing; catalog unavailable; ghost valid/invalid/material-wait/cancel; resident busy/commuting/studying; haul blocked/delivered; research paused; order expired/submitted. Empty states offer context and one next action; partial states retain progress/cargo location.
- Portrait inspector is a bottom sheet. Opening/closing retains the selected object and camera point; placement controls and the selected target remain reachable while the sheet is open.
- Reuse prior readability tokens as proposed values, validated on the rendered G2 screen: sky `#BFD8E6`, grass `#6F8F4E`, soil `#6B4F3A`, rock `#5A5F63`, roof `#8C4A3C`, actor accent `#E0B35A`, route `#F2D28B`, valid `#4F8F5A`, invalid `#B5453C`, selection `#F2C14E`, text `#1F2428`, panel `#F4EFE6`; bundled Cyrillic-capable IBM Plex Sans; 16/20/24 px type scale; 4/8/12/16 px spacing; 4/8 px radii; 2 px route/3 px selected route. No external asset font fetch.
- Portrait budgets use usable height after safe-area insets: top HUD ≤8%; persistent mode bar ≤12%; normal and placement states retain ≥60% unobscured world. The expanded inspector replaces the mode bar, is ≤35% including controls, and leaves ≥55% unobscured world. Entering placement auto-collapses the inspector and restores ≥60% world; at 375×667 sheet content scrolls without covering confirm/cancel.
- Catalog organizes buildings by GDD groups; each entry shows name/icon, footprint, material/technology requirement, status and one action. Opening/selecting an item does not place it; confirm and cancel remain distinct. Ghost feedback appears adjacent to footprint with text+icon (“Можно построить”/exact refusal), not color alone.
- Scene cues: discoverable plot uses a named outline; selected resident has portrait/identity marker plus label; selected route is a solid 3 px high-contrast path with turn points and text reason at a blocked segment; target footprint uses a dashed selection edge and check/cross icon. G2 HUD shows actual V2 snapshot resources and save/sync status; fixture counts never appear as authoritative.
- Accessibility behavior: DOM controls have visible focus and predictable keyboard order; canvas objects have parallel accessible buttons/list entries; selection, sync, command result and placement reason announce through a polite live region; route/validity use shape+icon+text as well as color. Reduced-motion preserves immediate action feedback.
- Recovery states map to UI and action: offline/read-only shows last sync + retry; syncing shows remaining progress and disables world mutations until server completion; stale version refreshes before another submit; no path retains cargo and exposes “Показать проблему”; missing materials opens the compatible source/haul action; no resident/scholar shows the valid assignment/training action; expired order exposes refresh/close.
- G2 visual acceptance checkpoint records screenshot and friction notes for the persistent first-use tasks, verifies token/font/pivot/route/ghost legibility at both portrait sizes and desktop, and approves or adjusts proposed tokens before G3 consumes them. Missing generated mockups are not substituted with fabricated imagery; live G2 rendering is the design reference.
<!-- /autoplan-accepted:design -->

### Historical DX Phase 2.5 accepted export (superseded by D-DX-15/16)

<!-- autoplan-accepted:dx -->
- Primary developer is OpenCode as an autonomous coding agent; the project owner is a nontechnical player. OpenCode owns repository inspection, dependency/environment/isolated DB setup, migrations, tests, failure recovery, launch and browser verification. The owner only opens the verified URL, pairs, plays, gives feedback and accepts; DX mode remains POLISH.
- Agent TTHW retains the approved `<5 minutes` target `[user-approved target; unmeasured]` from clean checkout/Node.js ≥22/npm/no `node_modules` and local Postgres available to the full persisted owner flow: pair, assign reachable work, observe delivery, build and reload. It must be re-measured against real G2. Owner TTP has no terminal/setup steps.
- OpenCode runs the integrated V2 path through `apps/client-v2`, `apps/server-v2` and `npm run dev:peace:v2` on only the isolated V2 database. It does not use root `.env`, V1 `npm run dev`/`dev:client`, root V1 `db:*`, V1 API/data or database `avanpost`; V1 workspaces and scripts remain unchanged. It verifies the real URL/browser flow before handing it to the owner.
- For phone pairing, OpenCode displays the one-time code in a loopback-only, in-memory owner handoff on the launching computer; no LAN client, chat transcript, URL, log, evidence or persistent client store may contain it.
- Separate documents by audience: `AGENT_RUNBOOK.md` contains OpenCode setup, V2 DB/migration/test/start/recovery, browser verification, persistent service lifetime and loopback code handoff procedures; `PLAY_NOW.md` is a Russian browser-only guide for the owner, with verified URL handoff, computer-to-phone code copy, pairing, controls, play, feedback and acceptance. No owner terminal/DB/migration steps appear in `PLAY_NOW.md`.
- The existing V1 `apps/server/src/config.ts` auto-loads root `.env` and defaults to database `avanpost`; V1 tests default `TEST_DATABASE_URL` to `avanpost_test`. V2 startup uses a V2-only env file/example and `apps/server-v2` entrypoint, rejects both V1 DB identities before connecting or mutating, and never changes or reuses the V1 loader/config. G0 adds `.env.v2.example` and the master-spec commands `dev:peace:v2`, `dev:peace:v2:stop`, `doctor:peace:v2`, `db:peace:v2:up`, `db:peace:v2:migrate`, `test:peace:v2`, and `e2e:peace:v2`; they explicitly load V2 configuration and fail closed on database identity. `test:peace:v2` and `e2e:peace:v2` use dedicated V2 Vitest/Playwright configs (for example `vitest.peace-v2.config.ts` and `playwright.peace-v2.config.ts`), run V2 app tests against the guarded `avanpost_v2_test`, and never call root V1 migration/server/client commands. Existing V1 test configs remain unchanged. Root `npm run build` includes all touched V2 workspaces in addition to its existing V1 builds; V1 workspace scripts remain unchanged. V2 apps, migrations and compose paths remain separate from V1.
- G0 developer doctor and all introduced V2 startup/setup failures use stable agent-ready codes and documented anchors. The doctor is non-interactive with text and `--json` output; failures include operation/actual values, safe fix, side-effect/retry guidance, relevant versions/config names, native nonzero/stderr channel, and redaction. Unexpected local failures have a trace path; no raw secrets or credential-bearing URLs. The one-time pairing code is shown only to the launching owner, is single-use/short-lived, and is never written to persistent logs.
- Every V2 API error uses HTTP status plus RFC 9457 problem details and a stable code/doc anchor; include caller-safe operation/IDs/expected and current versions, precise validation fields, recovery, side-effect status, request/correlation ID and retry guidance. For unknown mutation outcomes, perform one status reconciliation by the same `request_id`; never reissue with a new ID. If still unknown, stop and escalate with that ID. Read-only requests may retry once; writes are never blindly retried. Logs retain the protected trace, not secrets.
- G1 includes `docs/v2/ERROR_REGISTRY.md`, mapping each API/doctor/client-start path to what/fix/recovery/code/context/trace/redaction/channel, side effects, bounded retries, owner and evidence test. `API.md` has validated copy-paste request/response examples; G2 client/API/database startup failures show a stable code, safe next action and local trace/log location.
- `docs/v2/UPGRADE.md` documents V2-only schema/content upgrades, preflight, backup, migration verification and restore. Never migrate V1 worlds or run V1 migrations for V2. `docs/v2/AGENT_RUNBOOK.md` links to this, `API.md` and `ERROR_REGISTRY.md`; owner-facing `docs/v2/PLAY_NOW.md` links only to play/control/help content and never sends the owner to technical setup. Root README links the agent runbook and owner play guide separately without changing V1 `.env.example` instructions.
- Local tunables are the versioned `content/peace-v2` catalogs and explicitly named client configuration values; contributors may edit them in their worktree and restart the client. Validate catalogs before use and document defaults. Coordinate/version semantics, server-authoritative balances and safety limits are invariants, not runtime overrides; no new env-override API is introduced.
- Measure the approved fresh-clone TTHW once at G2 and save command, clean start state, elapsed time, first interaction and blockers under `docs/v2/evidence/G2/`. G2 records the first-use friction note; no product telemetry, hosted analytics or recurring measurement process is introduced.
- V2 development/test setup remains isolated and local. No hosted service, public SDK/API, V1 migration, or release-policy expansion is accepted by this DX review.
- G2 client-start errors stay on Vite's native nonzero/stderr channel. The play guide supplies one safe fix for unsupported Node, missing dependencies and occupied ports; it opens Vite's printed `Local:` URL rather than assuming port 5173. Fixture initialization shows stable `V2_SCENE_INIT`, a local trace/log path and one retry after the stated fix; failure has no database/world side effects, then escalates with that code.
<!-- /autoplan-accepted:dx -->

<!-- autoplan-accepted:eng -->
- Preserve complete peaceful Stage I and V1 safety. G2 is the persistent V2 playable vertical slice, with a launcher/world-bound 128-bit pairing code `[estimated security default]`, 5-minute expiry `[estimated default]`, five failed attempts per source/instance per 5 minutes `[estimated rate-limit default]`, atomic one-time redemption, private-interface-only LAN mode and an owner-scoped session. G3 expands account/session lifecycle; no Stage II, PvP, market, payment, merge or production deployment is introduced.
- D3/D4 change the earlier G2 interaction and onboarding. Reopen Design and DX review against the persistent, paired G2 before G1 can pass; Engineering must review the final revised plan afterward.
- Keep four separate V2 workspaces: `apps/client-v2`, `apps/server-v2`, `packages/peace-v2-shared` and `packages/peace-v2-sim`. V1 packages, runtime, database, migrations and existing test configuration remain unchanged.
- V2 database commands preflight operation-specific database names and local/V2-compose host identities before connection, then verify actual connected identity before migrations/resets. Reject `avanpost`, `avanpost_test`, aliases and unapproved remote hosts; keep dev/test database URLs distinct.
- Commands are idempotent by `(player_id, request_id)` plus canonical payload hash; commit effects and exact response atomically, conflict on changed payload, and preserve replay records for the active world lifetime. Serialize mutations/ticks by world revision and canonical sequence; persist catch-up progress/lease and block mutations until sync completes.
- Occupancy has a database uniqueness constraint and atomic footprint/material reservation. Item stacks have stable IDs, nonnegative quantities and one location; split/merge/haul transitions conserve quantities atomically. Persist seed and generator/simulation/catalog/schema versions; the client is read-only offline and never queues economic commands.
- G0 creates V2-only Vitest/Playwright configs, a compile-only `build:peace:v2`, guarded dev/test databases and an identity doctor; root build covers all touched workspaces without loading app environments or databases. G1 maps stable `REQ-####` source IDs, passes `check:peace:v2:source-map`, and adds V2-DBSAFE-01, V2-PAIR-01 and V2-PV-01 while preserving all 30 `I-E2E` IDs.
- G2 uses cumulative observable checkpoints for boot/pair/snapshot, reachable assignment/delivery, building and reload; no checkpoint is a gate pass or fixture fallback. G2/G11 performance evidence records small/medium/stress profiles, frame rate, scene load, command latency and memory; 60/30 FPS remain provisional targets until measured.
- Required evidence is redacted and committed under `docs/v2/evidence/<gate>/<test-id>/`; traces are compressed, pairing codes/secrets and raw database/network dumps are excluded, size baseline is recorded in G0 and a measured artifact cap is set before G11.
<!-- /autoplan-accepted:eng -->

#### Design re-review Step 0 and mockup availability

- **Initial rating: 7/10.** The prior approved layout, touch model, viewport budgets and design tokens are strong. The persistent paired G2 adds a new first-run gate, error recovery and code-entry behavior that the earlier fixture-only review did not cover.
- **DESIGN.md:** none found. The previous review explicitly kept a full brand book non-blocking; reuse the approved D1–D10 and token decisions where they match the master spec. Existing UI leverage is `apps/client/src/phaser/main.ts`, `apps/client/src/game/scene.ts`, `apps/client/index.html`, and `apps/client/src/simple/simple.css`; reuse interaction/ARIA/safe-area patterns selectively, not V1 top-down styling.
- **Focus:** user selected all seven dimensions. The current review covers persistent first-run hierarchy, pairing/recovery states, journey, visual specificity, token fit, responsive/accessibility and open choices.
- **Mockups:** designer binary passed `DESIGN_READY`, but `$D variants --count 3` exited 2 with `No OpenAI API key found`; its output reports `requested: 0`, `saved: []`, no images and no board. Continue text-only; no mockup is treated as approval or pixel evidence.

## Design Review Completion Summary

| Review dimension | Before → after | Evidence / disposition |
|---|---:|---|
| System audit | UI scope present | Phaser game scene + DOM HUD; no `DESIGN.md`; prior D1–D10 and explicit V2 tokens remain applicable; selectively reuse V1 interaction/ARIA/safe-area patterns |
| Step 0 | 7/10 initial | Persistent G2’s pairing gate, recovery and secure code-entry behavior were not covered by the prior fixture-only assessment |
| Pass 1: Information architecture | 8/10 → 10/10 | Added unpaired/paired hierarchy and first-use flow; world remains visible and read-only before pairing |
| Pass 2: Interaction states | 7/10 → 10/10 | Pairing loading/empty/error/success/partial states now show safe next steps and lock mutations until success |
| Pass 3: Journey | 7/10 → 10/10 | Storyboard now starts with read-only world, pairing/recovery, persisted interaction and reload; 5-second/5-minute/long-term trust check added |
| Pass 4: AI slop risk | 8/10 → 8/10 | OPERATE/game UI; no card mosaic; side-view scene and Kenney placeholders specified; no pixel claim without images |
| Pass 5: Design system | 8/10 → 8/10 | Explicit palette, IBM Plex Sans, type/spacing/radii; previously accepted decision keeps `DESIGN.md` non-blocking |
| Pass 6: Responsive & accessibility | 8/10 → 9/10 | Pairing sheet uses approved portrait/inspector budgets; field, show/hide, errors, announcements, keyboard and no-mutation semantics specified |
| Pass 7: Unresolved decisions | 3 resolved, 0 deferred | D-DES-7/8/9 individually answered and logged; prior user decisions remain binding |
| Overall design score | 7/10 → 8/10 | Minimum of rated passes 1–6; no rendered pixels or outside review, no consensus implied |

**Scope update:** This re-review covers the persistent paired G2 selected under Engineering D3/D4. The original Phase 2 score of 8/10 applied to fixture-only G2 and is superseded for current readiness; its prior decisions remain where compatible.

### Design re-review decisions

| ID | Decision | User approval | Plan effect |
|---|---|---|---|
| D-DES-7 | Unpaired phone sees the world read-only with a focused pairing sheet; portrait replaces the mode bar, landscape/desktop uses the inspector region. | 1A, durable receipt `71d8e1ec-d1a1-46e7-989e-cc218269bab5` | Pairing can be understood in context; all world mutations remain disabled until pairing succeeds. |
| D-DES-8 | Pairing errors show safe, reason-specific next actions for invalid, expired/reused and rate-limited codes. | 2A, durable receipt `5c0e2220-8c43-455f-a383-905a72f1914f` | No secret echo, remaining-attempt count or internal validation details; no mutation before success. |
| D-DES-9 | One labelled field supports full-code paste/manual entry, show/hide, explicit **Подключить**, no auto-submit, and transient memory only. | 3A, durable receipt `5243d7ae-2a80-4b3b-8326-7e191ebb8802` | No logs or persistent client storage; clear after success or page unload. |

All three decisions are added to the approved G2 design requirements, state table, journey, ledger and build tasks. Prior user decisions D2–D5 and D-DES-1..6 remain binding; none was reopened.

### Pass 4: AI-slop hard rules and litmus

Classifier: **OPERATE / game UI**. Evidence is plan text, not rendered pixels; no mockups were generated. Hard-rejection hits: **none in the plan**; verify the actual G2 scene after implementation.

| Litmus check | Result | Evidence |
|---|---|---|
| Product unmistakable in first screen? | YES (plan) | Side-view settlement, selected resident/route, pairing state and actual saved-world status are specified. |
| One strong visual anchor? | YES (plan) | Continuous side-view world stays visible behind the read-only pairing sheet. |
| Scannable by headlines/labels? | YES (plan) | Compact resource/sync strip, one primary pairing action, entity inspector and bottom modes each have one job. |
| Each section has one job? | YES (plan) | World, pairing/inspector, catalog, sync and modes are separated. |
| Are cards necessary? | YES (not used) | No decorative card grid; catalog entries are the interaction. |
| Does motion improve hierarchy or atmosphere? | YES (planned behavior) | Worker movement and delivered cargo communicate the physical economy; no decorative motion is required. |
| Premium without decorative shadows? | NO (not verifiable) | No generated image or rendered G2 pixels were available to judge. |

### NOT in scope

- Paid mockup generation without an available key; final art/audio/PWA polish before G10; creating a new formal `DESIGN.md` before G2 (previously accepted as non-blocking); Stage II, PvP, market and payment UI.

### What already exists

- Approved V2 palette, IBM Plex Sans, type/spacing/radii, UI hierarchy, responsive budgets and interaction/accessibility contracts in `docs/v2/PLAN.md`; reuse V1 interaction, ARIA and safe-area patterns only, not V1 presentation.
- `DESIGN.md` remains absent; `/design-consultation` is appropriate only if the owner later wants a full brand book.

### Additional design notes

- **Temporary art:** use licensed, side-view-compatible Kenney placeholders through G2–G9; no top-down art passed off as side-view; record a missing asset role as `ART_BLOCKER`.
- **TODOS.md:** none exists; no new out-of-scope design debt was proposed.
- **Mockups:** 0 generated, 0 approved. The attempted variant command failed before generating images because no OpenAI API key was configured; this is not visual approval.

### Unresolved Decisions

None in this Design re-review. The 3 pairing decisions above received individual user answers and durable receipts.

### Historical Phase 2 findings and disposition (fixture-only G2)

1. **High — portrait hierarchy/overflow:** set resource/mode budgets, inspector replacement and scrolling, visible-world minimum, and preserve selected resident/route/action.
2. **High — mobile placement flow:** specify catalog, tap-to-position, ghost drag vs camera pan, two-finger camera gesture, 48 px finger offset, edge clamping, fixed confirm/cancel, and invalid/cancel outcomes.
3. **High — later-game states:** status on affected entity and accessible list; show progress/location, exact blocker and recovery action for haul/research/order/material/sync; preserve interrupted cargo/progress.
4. **Medium — G2 journey finish/recovery:** historical decision for fixture-only G2; Engineering D3 supersedes it with saved-action confirmation and persistent resume/restart.
5. **Medium — landscape/desktop:** right inspector dimensions, mode controls, clear-world width, resize preservation and portrait fallback.
6. **Medium — G2→G3 continuity:** historical transition decision; Engineering D3 requires G2 to load the authoritative snapshot and retain selection only by stable IDs across reload.

### Historical Phase 2 litmus scorecard (fixture-only G2)

Classifier: **OPERATE / game UI**. Evidence is the plan and interaction contracts; no rendered mockup was available for pixel-level judgments.

| Litmus check | In-host reviewer | Outside voice | Evidence |
|---|---|---|---|
| Product unmistakable in first screen? | YES (plan) | N/A | Side-view world, selected resident/route and demo marker |
| One strong visual anchor? | YES (plan) | N/A | Continuous side-view world; panels are secondary |
| Scannable by headlines only? | N/A | N/A | In-game workspace, not a headline-led page |
| Each section has one job? | YES (plan) | N/A | Resource strip, world, inspector/catalog and modes are distinct |
| Are cards actually necessary? | N/A | N/A | No decorative card grid; catalog entries are the interaction |
| Does motion improve hierarchy or atmosphere? | N/A | N/A | No rendered motion available to assess |
| Premium without decorative shadows? | N/A | N/A | No rendered pixels; plan does not depend on shadow decoration |

### Historical Phase 2 required design outputs (fixture-only G2)

- **NOT in scope:** generated/approved mockups (designer reports ready, but no authorized `OPENAI_API_KEY`; no paid generation), final art/audio/PWA polish (G10), authoritative states before their gates, and PvP/market/payment scope.
- **What already exists:** V1 `apps/client/src/phaser/main.ts`, `apps/client/src/game/scene.ts`, `apps/client/index.html`, `apps/client/src/simple/simple.css`; reuse interaction, ARIA and safe-area patterns selectively, not V1 styling. No `DESIGN.md` exists.
- **TODOS.md:** no separate design-debt TODO; all six in-scope findings and verification are in G2/G3/G10 contracts/tasks; no unrelated deferred choice.
- **Mockups:** 0 generated, 0 approved. Unavailable is not visual approval.

### Design implementation tasks

- [ ] **D1 (P1, human: ~1 day / CC+gstack: ~2h)** — G2 portrait HUD/inspector — implement safe-area budgets, internal sheet scrolling and world clearance. Verify 390×844 and 375×667 with 44 px controls.
- [ ] **D2 (P1, human: ~1 day / CC+gstack: ~2h)** — G2 touch placement — implement catalog, ghost, camera and confirm/cancel interactions. Verify tap, ghost drag, background pan, pinch, invalid reason, cancel and `pointercancel`.
- [ ] **D3 (P1, human: ~2 days / CC+gstack: ~1 day)** — G3+ entity-state recovery — render entity/list/inspector state, progress, blocker and action. Verify named haul/research/order/material/sync states and partial-work preservation.
- [ ] **D4 (P2, human: ~4h / CC+gstack: ~30min)** — G2 saved-action completion/re-entry — add non-blocking save confirmation and resume/restart. Verify free exploration and truthful persistence state.
- [ ] **D5 (P2, human: ~1 day / CC+gstack: ~2h)** — G2 landscape/desktop panel — implement responsive widths and resize fallback. Verify 844×390 and 1440×900 while selected and placing.
- [ ] **D6 (P1, human: ~1 day / CC+gstack: ~2h)** — G2 API-backed state continuity — announce connected/saved, retain only stable-ID selection through reload, and reject unconfirmed placement. Verify against authoritative snapshot.
- [ ] **D7 (P1, human: ~1 day / CC+gstack: ~2h, estimated)** — G2 phone pairing presentation — keep the world visible/read-only, place the pairing sheet in the approved portrait/landscape/desktop region, and restore controls only after pairing. Verify at 390×844, 844×390 and 1440×900; all world mutations must remain disabled before pairing.
- [ ] **D8 (P1, human: ~4h / CC+gstack: ~1h, estimated)** — G2 pairing recovery — show safe next actions for invalid, expired/reused and rate-limited codes without echoing codes, attempt counts or internal validation details. Verify each denial and that no world mutation occurs.
- [ ] **D9 (P1, human: ~4h / CC+gstack: ~1h, estimated)** — G2 secure code input — use one labelled field for paste/manual entry, a show/hide control and an explicit `Подключить` action; no automatic submit or persistent client storage/logging. Verify manual/paste entry, visibility, explicit submit, success/page-unload clearing and absence from logs/storage.

Design task JSONL: `/Users/labiozzza/.gstack/projects/avanpost/tasks-design-review-20261024-090310.jsonl` (3 tasks; saved for Autoplan aggregation).

## DX Review Context

Step 0 reuses the approved primary type API/Service (D-DX-1), DX POLISH mode (D-DX-5), competitive `<5 min` Agent TTHW threshold (D-DX-3), and skipped `/office-hours` prerequisite (D-DX-13). The user superseded the prior human-first persona with D-DX-15 and selected the loopback owner-code handoff in D-DX-16. No product type, mode, hosted service, public SDK or V1 boundary is reopened.

### Agent Developer Experience

- **Who:** OpenCode acting as the autonomous coding agent and primary developer; the project owner is not the developer.
- **Context:** Starts in the repository with a task, inspects the GDD/master spec and current workspace, then owns V2 setup through verified playability and continuation across sessions.
- **Responsibilities:** Create/use V2-only workspaces, dependencies, environment, databases and migrations; run tests; diagnose/recover failures; launch and verify the app; open the loopback-only owner code handoff when phone pairing is needed; return the actual accessible URL and owner-facing play instructions. Never route these technical actions to the project owner.
- **TTHW:** retain the previously approved `<5 minutes` target `[user-approved target; unmeasured]` from a clean checkout (Node.js ≥22/npm, no `node_modules`, required local PostgreSQL mechanism available) through the first full owner flow: pair, assign reachable work, observe delivery, build and reload. Validate against real G2, not an API ping or warm server.
- **Expects:** authoritative V2 instructions, non-interactive commands, pre-connect DB safety, clear recovery, browser-verifiable results and resumable progress.
- **Evidence:** user-stated agent workflow; `README.md:5-25,27-35`, root `package.json:10-24`, V1 config/test evidence and the V2 G0/G2 contracts. This persona is user-specified; behavior remains unimplemented.

### Player/Owner Experience

- **Who:** nontechnical project owner; not expected to write code, configure environments, execute terminal commands, manage databases/migrations or debug development infrastructure.
- **Context:** OpenCode has completed setup and verified the local or LAN URL for the current playable gate; the owner opens that URL on a computer or phone, retrieves a phone code from the owner-only loopback handoff on the computer when needed, pairs, plays and gives feedback. Formal Stage I acceptance is a separate final step after `STAGE_I_AUTO_QA: PASS`.
- **Expects:** a working browser URL, clear pairing/game controls and actual persistent gameplay; no setup commands or database work.

### Developer perspective

> **OpenCode agent:** I receive a task and inspect the repository before acting. The README quick start is for V1, so I must not copy its `.env` or run its database commands. I independently set up the isolated V2 environment and databases, verify identity before migration, run checks, diagnose failures, start the V2 game, verify HTTP and browser behavior, then give the owner a real URL and play instructions. The plan requires all this, but no V2 runtime exists yet, so the result is not proven.
>
> **Project owner:** I receive the verified URL and open it in a browser. I pair my phone through the approved pairing flow, assign a worker, watch real delivery and building, reload, and confirm the saved world. I give feedback and final acceptance. I never need to open a terminal or manage the database.

This role split and journey are user-stated; setup, URL verification and persistent play remain planned, not observed.

### Competitive DX benchmark and TTHW target

Keep two clocks separate. **Agent TTHW:** clean clone, Node.js ≥22/npm available, no `node_modules`, local PostgreSQL mechanism available → OpenCode finishes setup and browser-verifies the complete persisted flow (pair, assign reachable work, observe delivery, build, reload) before handing over the actual URL. The previously approved target remains under 5 minutes; it is not measured and must be tested on real G2. **Owner time-to-play:** after OpenCode supplies the verified URL and loopback handoff, the owner opens the browser and plays; no terminal/setup time is assigned to them. Aside was unavailable and this host has no WebSearch tool, so external research was unavailable and no provider result is claimed.

| Product/path | Start → useful result | Time + evidence | DX choice | Source |
|---|---|---|---|---|
| Typical Vite starter (category reference) | fresh JS/TS app → local page | ~2–5 min `[estimated: in-distribution knowledge, not researched/timed]` | one local dev server and visible URL | No external research; Aside unavailable |
| Typical Phaser starter (category reference) | install template → first scene | ~5–10 min `[estimated: in-distribution knowledge, not researched/timed]` | game canvas is the result, not an API ping | No external research; Aside unavailable |
| Avanpost current README | clone → existing V1 app | 5 setup commands; ~10–15 min `[estimated: prior DX review, unmeasured]` | This is a V1 agent/developer path; owner must not run it for V2 | `README.md:11-25`; prior DX record |
| Planned OpenCode agent flow | clean checkout → isolated V2 setup/tests → browser-verifies complete persistent flow → hands off verified owner URL | under 5 min `[approved target, re-measure before G2]`; full path unimplemented | agent owns V2 env/DB/migrations/launch/recovery; no V1 files or DB | User-approved D-DX-3; `docs/v2/PLAN.md` G0/G2 contracts |
| Planned owner flow | receive verified URL → browser → secure local pairing handoff → play → feedback/acceptance | zero terminal/setup actions; play duration not measured | owner only opens browser and plays | User-stated workflow; D-DX-15/16 |

- **Selected target:** retain the previously approved Competitive tier and `<5 min` agent TTHW threshold, now measured to OpenCode’s browser-verified full persisted flow and URL handoff rather than a warm API ping. User clarified the useful-result endpoint as assign→delivery→build→reload. This remains a provisional, unmeasured target, not a release claim.
- **Agent magical moment:** OpenCode completes isolated V2 setup, tests and browser checks, then hands the owner an actual working local/LAN URL and opens the loopback handoff without exposing the code in output.
- **Owner magical moment:** open the provided URL, pair if needed, assign reachable work, see real delivery/building, reload and find the same saved world.
- **Delivery vehicle:** OpenCode executes the integrated `npm run dev:peace:v2` path and all required V2 DB/test commands. Do not ask the owner to run root `npm run dev`, `npm run dev:client`, `npm run db:up`, `npm run db:migrate`, copy `.env.example`, or configure Postgres.
- **Mode:** DX POLISH, as required by the Autoplan phase driver. Existing capability only; no hosted service or public API is proposed.

### Two-lane DX contract

```text
OpenCode agent: task/spec → inspect repo/status → V2-only install/env/DB → guard → migrate
                 → build/test/E2E → start integrated V2 app → live HTTP/browser check
                 → open loopback owner handoff when needed → give owner actual URL/play guide

Project owner:   receive URL → open computer/phone browser → copy code from local handoff if needed
                 → pair → assign worker → observe delivery/build → reload → feedback/acceptance
```

OpenCode owns technical setup, dependency management, database/migration work, test execution, recovery, service lifecycle and verification. The owner performs only browser actions and feedback; if the agent hits a hard environmental boundary, it reports the exact blocker without delegating terminal or database commands.

**Agent runbook order (planned commands, not yet registered):** inspect task/repository/status and the V1 boundary; check Node/npm and run `npm ci` when dependencies are absent; create/use only V2 environment configuration; run the V2 doctor and database identity guard; bring up and migrate only the V2 database; run typecheck/build/unit/integration/browser E2E; start `npm run dev:peace:v2`; verify `/api/health`, the actual browser URL and the complete pairing→assignment→delivery→build→reload flow; open the owner handoff on loopback; keep script-owned services alive while the owner plays. Launcher stdout contains only readiness, actual URLs and a handoff-ready signal, never the code; the local page holds it in memory. `AGENT_RUNBOOK.md` gives exact commands, expected success/failure markers, safe retries and stop behavior. G0 must verify every command against the implemented registry; no root V1 `dev`/`db:*` command is permitted.

```text
node --version / npm --version → npm ci if required
→ npm run doctor:peace:v2 -- --json
→ npm run db:peace:v2:up → npm run db:peace:v2:migrate
→ npm run typecheck → npm run build → npm run test:peace:v2 → npm run e2e:peace:v2
→ npm run dev:peace:v2 → verify /api/health + real browser flow + loopback handoff
→ give owner actual URL and owner guide; keep service alive → stop safely on owner acceptance/request
```

All commands are planned and unregistered today; G0 verifies their exact flags/output. TTHW records per-step and total wall-clock time from the defined clean state; no V1 command is a fallback.

### Agent developer journey map

| Stage | OpenCode does | Evidence/friction | Plan disposition |
|---|---|---|---|
| Discover | Inspects task, GDD/master spec, repository and current gate status | Root README describes V1; V2 docs/status are separate; no V2 runtime exists | Agent runbook points to canonical V2 requirements and states V1 boundary before any command |
| Install | Checks Node, installs workspaces and creates V2-only environment | `engines.node >=22`; `.env.example` targets V1; no V2 bootstrap implemented | Agent runbook and doctor automate safe prerequisites; owner performs none |
| Hello World | Creates/verifies V2 DB, migrates, starts integrated app and runs browser checks | V1 `dev:client`/`db:*` are unsafe for V2; V2 commands not implemented | Runbook/doctor use V2-only commands and identity checks; OpenCode provides a verified URL |
| Real usage | Assigns, observes delivery/build and reloads in browser | G2 persistent world and D9 phone pairing are planned, not shipped | Agent proves the full `V2-PAIR-01`/`V2-PV-01` flow and reports evidence |
| Debug | Diagnoses failed setup, migration, API or browser verification | current V1 errors do not define V2 recovery | Agent consumes stable errors/runbook and retries only safe operations; owner is not asked to debug infrastructure |
| Upgrade | Applies V2 schema/content changes | V2 runbook is planned, not written | Agent follows V2-only backup/restore and identity preflight; never touches V1 |

### Player/Owner journey map

| Stage | Owner does | Promise | Owner is not asked to do |
|---|---|---|---|
| Ready | Receives a URL from OpenCode after live verification | URL opens the running V2 game on a computer or phone | Start a process, find ports or inspect logs |
| Pair | Opens the world; if using a phone, copies the one-time code from the loopback-only handoff on the computer and explicitly connects | World remains visible read-only; safe recovery is shown; no change occurs before pairing; handoff cannot be read over LAN | Run a command, configure network/DB or retrieve the code from a terminal/chat log |
| Play | Assigns reachable work, watches delivery and builds | Server-owned state and real V2 persistence | Use fixtures or admin tools |
| Return | Reloads and provides feedback/final acceptance | Same saved world is visible; OpenCode owns technical diagnosis and repair | Run tests, migrations or a terminal recovery command |

### First-time OpenCode roleplay

Static roleplay from user-stated persona; this is not a live runtime test.

| Time | Agent attempt | Current evidence | Likely result | Planned remedy |
|---|---|---|---|---|
| T+0:00 | Reads task/spec and workspace state | V1 quick start is the only implemented README path; V2 gate is IN_PROGRESS | Must identify and preserve V1 boundary before setup | Agent runbook describes autonomous inspection and V2-only boundaries |
| T+0:30 | Resolves prerequisites | Node ≥22/npm documented; no V2 environment or database yet | Agent must set up, owner must not be prompted to do it | V2 doctor, environment example and isolated DB scripts |
| T+1:00 | Installs and migrates | root config/defaults target V1 `avanpost`; V2 guard and migration path are planned | Unsafe if the agent reuses root config | Verify DB identity before connection/migration; separate V2 config/volume |
| T+2:00 | Starts, tests and opens browser | integrated V2 command and E2E paths are not implemented | No URL or player session can be truthfully offered yet | Agent runs V2 tests and browser verification before handing off URL |
| T+3:00 | Pairs phone and plays through reload | D-DES-7/8/9 define visible read-only world, safe errors and transient code field; D-DX-16 selects a loopback-only owner handoff | Owner can play without terminal; implementation must prove the handoff is unavailable over LAN and absent from logs | OpenCode owns services and handoff; owner copies the code from the local browser page to the phone |

### First-time owner roleplay

OpenCode has already verified the URL and, when phone pairing is needed, opened the loopback-only code handoff on the computer that launched V2. The owner opens the game in a browser, copies the code from that local view to the phone, pairs, assigns reachable work, observes delivery, builds, reloads and reports feedback. The owner never opens a terminal; this is a target flow, not current shipped behavior.

### Error path matrix (agent-ready-v1)

Static source/plan review only; V2 runtime paths do not exist yet. Existing V1 behavior is evidence of the current risk, not a claim about V2.

| Path / class | Current evidence | Required V2 what/fix/recovery/code/context/trace/redaction/channel |
|---|---|---|
| G2 V2 client/API/database startup / environment or unexpected | existing `npm run dev:client` starts V1; new `apps/client-v2`, `apps/server-v2` and `dev:peace:v2` are planned | OpenCode agent gets stable setup code, expected Node/database prerequisites, actual URL and safe repair; preserve nonzero/stderr and protected local trace; reject V1 identity before connection/migration. Owner sees only ready state or a short blocker message, never a terminal/DB instruction |
| G0 V2 doctor/database target / validation or dependency | existing V1 loader reads root `.env` and defaults to `avanpost` (`apps/server/src/config.ts:4-22,35-40`); `.env.example:3-4` names V1 databases | Agent runs `doctor:peace:v2`, reads requested database and safe V2 fix; reject before connecting if target is not allowed; exit nonzero/stderr or structured `--json`; no V1 connection/migration side effects. Owner is never asked to change env or DB |
| G2 loopback owner-code handoff / local dependency or access failure | D-DX-16 approved a loopback-only, memory-only owner view; not implemented | Agent checks the actual socket peer/local listener, ignores forwarded-IP spoofing, returns stable failure code/protected trace, and repairs/restarts safely; fail closed if a LAN client can fetch it. Owner sees a concise browser recovery status, no code/command/stack trace. Include handoff path in `ERROR_REGISTRY.md` and V2-PAIR-01. |
| G3 command validation/stale version / validation or conflict | V1 `AppError` has status/code/message (`apps/server/src/errors.ts:1-9`); V1 handler returns `{error:{code,message}}` (`apps/server/src/app.ts:134-152`) | V2 API returns status + RFC 9457 body with stable code/doc anchor, operation, safe supplied/current values and side-effect state. Owner UI gives a concise next action; OpenCode uses correlation/trace to repair. Validation rejection has no mutation |
| G3 mutation timeout or interrupted persistence / partial or unknown | plan requires `request_id` idempotency and exact stored duplicate response; retry/reconciliation bound is not yet explicit | include `request_id` and caller-safe correlation ID; on unknown result, perform one status reconciliation by the same ID, never mint a new one; if still unknown stop and escalate. Read-only requests may retry once; writes are never blindly retried. Record exact side-effect state. |
| G3+ unexpected server exception / unexpected | V1 emits generic `INTERNAL` and logs the exception, but response has no correlation ID (`apps/server/src/app.ts:148-151`) | V2 returns generic caller-safe RFC 9457 response with correlation ID, logs the internal trace under that ID, redacts secrets/URLs/stack details, and tells the caller whether the operation is known to have committed or must be reconciled |

Permission model: no client authors economy state; V2 server/database commands require explicit V2 identity and never fall back to V1. Every G1 registry row carries an authorized safe fix or the exact human input needed; no interactive terminal confirmation is introduced.

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

Autoplan applied its six decision principles; these are plan decisions, not user interview answers. Taste decisions remain visible for the final approval gate.

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| D-DX-1 | DX Step 0 | Primary developer product type is API/Service with a Phaser client and workspace/docs surfaces | Mechanical | Explicit over clever | Plan and README specify Fastify `/api`, server snapshots and TypeScript client; classify the primary integration surface, do not call this a published SDK | Label the repo only as a game and skip API/service review |
| D-DX-2 | DX Step 0 | Persona is a full-stack TypeScript gameplay contributor; AI agent is a secondary user lens | Superseded by D-DX-15 | DRY | This was the prior human-first lens; it is retained only as the technical work OpenCode performs, while the owner is a player rather than a developer | Ask the owner to build, configure or debug the product |
| D-DX-3 | DX Step 0 | Agent TTHW target is under five minutes from a clean checkout to OpenCode's browser-verified full persisted flow and owner URL handoff; owner play time is separate | Superseded in endpoint by D3/D-DX-15; numeric target retained | Choose completeness | The previous fixture-only endpoint is replaced by the user-specified assign→delivery→build→reload flow; `<5 min` remains unmeasured and must be tested on that agent path | Count an API ping or one isolated interaction as hello world |
| D-DX-4 | DX Step 0 | Initial choice: deliver the V2 fixture through `npm run dev:client` | Superseded by D-DX-4R | Previous code assumption | This script targets V1 `apps/client`; exact source contradicted the isolation requirement | Keep this command as the V2 entrypoint |
| D-DX-4R | Eng Scope Challenge | Use a separate `apps/client-v2`; first launcher was `dev:peace:v2:client` with fixture-only behavior | Superseded by Engineering D3 | Explicit over clever | V1 `apps/client` remains untouched; D3 now requires the main G2 entrypoint to start the isolated V2 API/client and persistence through `dev:peace:v2` | Modify V1 entrypoint or proxy to host V2 |
| D-DX-5 | DX Step 0 | Use DX POLISH mode | Mechanical | Explicit over clever | The phase driver fixes the mode and the work is an existing product enhancement | Expand DX scope or use critical-only triage |
| D-DX-6 | DX Step 0 | Keep benchmark findings estimated/in-distribution because Aside and WebSearch are unavailable | Mechanical | Explicit over clever | No external measurements are available; preserve the unknown instead of inventing peer results | Present estimates as researched measurements |
| D-DES-1 | Design | Portrait expanded inspector ≤35%, visible world ≥55%, and normal/placement world ≥60%; placement collapses the sheet | Mechanical | Choose completeness | Reconciles the old 45% conflict and keeps selected target/confirm controls visible | Allow 45% inspector/world during active placement |
| D-DES-2 | Design | Catalog selection and placement are separate; confirm/cancel are distinct and ghost has text+icon reason | Mechanical | Explicit over clever | Avoid accidental placement and color-only feedback | Place immediately on selecting catalog item |
| D-DES-3 | Design | Later work statuses identify entity, progress, blocker and recovery action | Mechanical | Choose completeness | Gives each listed haul/research/order state a recovery path without adding features | Show a status badge with no action |
| D-DES-4 | Design | G2 demo has completion and resume/restart cues without saving | Superseded by Engineering D3 | Explicit over clever | Historical fixture boundary is replaced by saved-action confirmation and resume/restart for the persistent PV | Imply persistence for an unconfirmed action or force a tutorial modal |
| D-DES-5 | Design | Landscape/desktop use right inspectors; resize preserves safe selection/camera state | Mechanical | Pragmatic | Specifies the accepted cross-device behavior without changing the game scope | Apply portrait sheet by simply stacking all panels |
| D-DES-6 | Design | G3 announces authoritative save state and clears demo-only intent | Superseded by Engineering D3 | Explicit over clever | G2 now loads the authoritative snapshot and announces save/sync state; unconfirmed ghost still never submits | Silently carry an unconfirmed ghost into the server world |
| D-DES-7 | Design re-review | The unpaired phone sees the live world read-only with a focused pairing sheet; portrait replaces the mode bar, landscape/desktop uses the inspector region, and pairing success restores normal controls | User-selected | Preserve the world as the first visual anchor | User chose 1A; receipt `71d8e1ec-d1a1-46e7-989e-cc218269bab5`; no mutation is available before the owner session | Hide the game behind a pairing-first screen |
| D-DES-8 | Design re-review | Pairing errors offer safe reason-specific next steps for invalid, expired/reused and rate-limited codes; never echo the code, remaining-attempt count or internal validation | User-selected | Make recovery clear without exposing secrets | User chose 2A; receipt `5c0e2220-8c43-455f-a383-905a72f1914f`; all world mutations remain disabled until pairing succeeds | Use one generic failure and force a blind restart |
| D-DES-9 | Design re-review | One labelled full-code field supports paste/manual entry, show/hide, explicit **Подключить** submit, no auto-submit, and transient memory only | User-selected | Make long mobile entry recoverable and keep the secret private | User chose 3A; receipt `5243d7ae-2a80-4b3b-8326-7e191ebb8802`; code is never logged/stored persistently, and user controls visibility | Use segmented fields tied to a fixed grouping or auto-submit partial input |
| D-ENG-1 | Eng Scope Challenge | G2 is the persistent playable vertical slice required by the master spec; move only the minimum required authoritative paths from later gates into G2 | User-selected (D3) | Preserve the source contract | User chose the master-spec-aligned option: V2 API/PostgreSQL, physical worker/logistics/building/cave path, touch and reload persistence; V1 remains untouched | Keep the fixture-only G2 as an explicit spec deviation |
| D-ENG-2 | Eng Scope Challenge | Root `npm run build` must compile every touched workspace while retaining existing V1 workspace build scripts | Mechanical | Preserve the source contract | Master spec §3.3 requires root build/typecheck to compile all changed workspaces; current root build invokes only V1 server/client | Let G0 report a green build that never compiles V2 |
| D-ENG-3 | Eng Architecture | G2 requires a protected single-owner LAN session before persistent world mutations; full account/session lifecycle remains G3 | User-selected (D4) | Make failure recoverable | User chose short-lived, single-use pairing to preserve the master-spec phone flow while preventing unpaired LAN devices from writing the world | Allow LAN mutations before the G2 owner boundary exists |
| D-ENG-4 | Eng Code Quality | Prefer responsibility-based method boundaries and testability; no hard five-branch cap | User-selected (D5) | Reduce fragility | User chose cohesion, transaction/error boundaries and regression tests over an unsupported numeric method limit | Force helper extraction solely to stay under five branches |
| D-ENG-5 | Eng Architecture | Validate V2 DB name and local/compose host before connect, then verify actual connected identity before mutation | Mechanical (native N1) | Fail closed | Exact V1-safety contract; prevents aliases/alternate hosts from bypassing the name guard | Trust arbitrary URLs or check only after migration starts |
| D-ENG-6 | Eng Architecture | Bind pairing to one launcher/world with high entropy, short expiry, rate limit and private-interface restriction | Mechanical refinement of D4 (native N2) | Make failure recoverable | Limits replay/brute force while preserving the approved local phone flow | Treat pairing as public production authentication |
| D-ENG-7 | Eng Architecture | Scope idempotency to `(player_id, request_id)`, reject payload mismatch and atomically store effect/result; retain while world is active | Mechanical (native N3) | Preserve exact contract | Master spec requires exact duplicate response and no repeated effect | Expire replay data while the world remains active |
| D-ENG-8 | Eng Architecture | Serialize world commands and ticks with a revision lock and canonical sequence | Mechanical (native N4) | Preserve determinism | Prevents overlapping commands/ticks from producing order-dependent state | Allow unsequenced tick and mutation writes |
| D-ENG-9 | Eng Architecture | Persist single-worker catch-up progress and block mutations until sync completes | Mechanical (native N5) | Preserve determinism | Makes `202 syncing` resumable after restart and safe across clients | Start duplicate catch-up or accept writes mid-sync |
| D-ENG-10 | Eng Architecture | Enforce occupied-cell uniqueness in the database with atomic footprint/material reservation | Mechanical (native N6) | Fail closed | Application checks alone can race on concurrent builds | Rely on client ghost checks only |
| D-ENG-11 | Eng Architecture | Give item stacks stable IDs and a single authoritative quantity/location with atomic split/merge/haul transitions | Mechanical (native N7) | Preserve conservation | Formalizes the approved physical item ledger and interruption recovery | Maintain inconsistent quantity/location copies |
| D-ENG-12 | Eng Architecture | Persist seed and generator/simulation/catalog/schema versions per world | Mechanical (native N8) | Preserve determinism | Needed for canonical hashes and restart/version compatibility | Rebuild existing worlds under new catalogs silently |
| D-ENG-13 | Eng Architecture | Distinguish client disconnect from server outage; keep client read-only and catch up on server reconnect | Mechanical (native N9) | Explicit over clever | Preserves the server-authoritative offline contract | Queue local economic commands while disconnected |
| D-ENG-14 | Eng Architecture | Add stable `REQ-####` source IDs and a mechanical matrix completeness check | Mechanical (native N10) | Choose completeness | Allows missing in-scope requirements to be detected before G1 passes | Treat grouped headings as full traceability |
| D-ENG-15 | Eng Architecture | Use cumulative G2 checkpoints without treating partial work as PASS or cutting accepted scope | Mechanical (native N11) | Bias toward action | Makes the broad persistent slice diagnosable without returning to a demo | Mark a partial G2 checkpoint complete |
| D-ENG-16 | Eng Architecture | Commit redacted, compressed evidence with size metadata; set a measured artifact cap before G11 | Mechanical (native N12) | Preserve evidence | Bounds repository growth while retaining required traces and hashes | Keep raw dumps/videos or silently discard proof |
| D-ENG-17 | Eng Architecture | Keep `build:peace:v2` compile-only while root build compiles all touched workspaces | Mechanical (native N13) | Preserve both contracts | Satisfies master-spec build coverage without V2 runtime/config coupling | Exclude V2 from root build or require a DB to compile |
| D-DX-7 | DX Pass 3/6 | Add V2-only env example and master-spec `*:peace:v2` doctor/database commands; never reuse root V1 `.env` loader | Mechanical | Choose completeness | `apps/server/src/config.ts` auto-loads root `.env` and defaults to `avanpost`; user requires V1 untouched | Reuse `npm run db:*` and trust contributors to inspect the target |
| D-DX-8 | DX Pass 3 | V2 API failures use RFC 9457, stable code, operation/context, correlation, redaction and native HTTP channel | Mechanical | Explicit over clever | Native review found caller-safe context/trace gaps; V1 currently returns only code/message | Keep generic errors or return HTTP 200 with nested failure |
| D-DX-9 | DX Pass 3/4 | Add per-path error registry and schema-checked API examples | Mechanical | Choose completeness | Every API/doctor/client-start path needs safe fix, recovery, side effects and evidence | Leave repair/retry behavior to source inspection |
| D-DX-10 | DX Pass 5 | Add V2-only upgrade/backup/restore runbook | Mechanical | Bias toward action | Versioned V2 schema/content already in scope; this protects local world state without V1 conversion | Defer upgrade guidance until after a breaking migration |
| D-DX-11 | DX Pass 2 | Tune versioned `content/peace-v2` files in the worktree; validate on load; no runtime override API | Mechanical | DRY | Uses the planned catalog source and provides an edit/restart path without a new runtime surface | Add environment-driven override APIs |
| D-DX-12 | DX Pass 8 | Measure clean-clone agent TTHW once at G2 to the browser-verified full flow/URL handoff, and record one owner first-play friction note; no telemetry or recurring analytics | Mechanical | Pragmatic | Verifies the selected target and separates OpenCode execution time from owner play; no product analytics or recurring process | Infer success from a warm server or add product analytics |
| D-DX-13 | DX Step 0 | Skip a separate `/office-hours` prerequisite; keep the existing GDD, master spec and CEO scope as product evidence | Mechanical | DRY | The product direction and scope already have approved source artifacts; reopening them would repeat completed work | Re-run product discovery during DX polish |
| D-DX-15 | DX re-review | OpenCode is the autonomous developer and owns setup/tests/recovery/browser verification; the project owner only opens the verified URL, pairs, plays, gives feedback and accepts. Keep Agent Developer Experience separate from Player/Owner Experience. | User-selected | Decide for me, let me override | User explicitly prohibited assigning code, terminal, env, DB, migrations or infrastructure debugging to the owner; provide separate `AGENT_RUNBOOK.md` and terminal-free `PLAY_NOW.md`. Receipt `54e26a17-e34e-45c9-8f3b-8099975a179c`. | Require the owner to run project commands or manage V2 infrastructure |
| D-DX-16 | DX Hello World | OpenCode hands the pairing code to the owner through a loopback-only browser view on the computer that launched V2; it is memory-only, absent from stdout/tool output, chat, URLs, logs, evidence and persistent client storage, and inaccessible to LAN clients. | User-selected | Fail closed | User chose B to keep code out of chat while preserving owner phone pairing and no-terminal setup. Receipt `5ec4b7b9-5ffc-4062-a823-131ad9535a0f`. | Put the code in an assistant transcript, URL, application log or LAN-readable page |
| D-DX-14 | DX Pass 7 | Do not add a public community/support product in this plan | Taste | Bias toward action | The repo is a game project, not a public SDK/SaaS; a forum or community ops would add scope without evidence of need | Add a community channel or ecosystem program |

## Historical DX Phase 2 Scorecard and findings (human contributor / fixture-only G2)

### Primary eight-pass assessment

Scores describe plan quality and verified repository/documentation evidence. They do not claim the future G2 route, doctor, API errors or migration docs have shipped. Baseline is the checked-in V1 onboarding/current DX plan before accepted DX fixes; the following scores assessed the amended fixture-only V2 plan before Engineering D3.

| Pass | Before → after | Evidence and disposition |
|---|---:|---|
| 1. Getting started | 4/10 → 8/10 (historical) | Replaced V1 quick-start with a fixture-only route; Engineering D3/D4 change G2 to persistent full-stack launch and phone pairing, so this score is not current until the new run path is reviewed and measured |
| 2. API/CLI ergonomics | 5/10 → 8/10 | Consistent `v2:*` commands, typed contracts, `request_id` semantics, API examples and documented catalog defaults/overrides |
| 3. Errors/debugging | 4/10 → 8/10 | G1 error registry covers API, doctor, client bootstrap, trace/correlation, safe repair, side effects, retry/reconcile, redaction and native channels |
| 4. Documentation/learning | 4/10 → 8/10 | Adds `PLAY_NOW.md`, `API.md`, `ERROR_REGISTRY.md`, `UPGRADE.md` and root README navigation; examples must be checked against schemas/commands |
| 5. Upgrade/migration | 5/10 → 8/10 | V2-only preflight, backup/restore and schema/content upgrade path; no V1 world migration |
| 6. Environment/tooling | 5/10 → 8/10 (historical) | Node ≥22, npm clean install, isolated `.env.v2.example` and V2 command family; the client-only assumption is superseded and the persistent/pairing G2 setup needs re-review |
| 7. Community/ecosystem | 7/10 → 8/10 | Public SDK/community features do not fit this game repository or selected DX POLISH scope; GitHub-based repo artifacts remain the support surface |
| 8. DX measurement | 4/10 → 8/10 | One-time clean-clone TTHW evidence and first-use friction record; no analytics, telemetry or recurring measurement policy |
| **Overall DX** | **4/10 → 8/10 (historical)** | Plan-level average for the fixture-only launch, rounded down; current full-stack TTHW remains unmeasured and needs DX re-review |

| Metric | Assessment |
|---|---|
| TTHW current | ~10–15 min estimate for README V1 setup (five setup commands + Docker); not measured |
| TTHW target | <5 min, Competitive tier, fresh clone with Node.js ≥22/npm and isolated local PostgreSQL available to first persisted V2 interaction; not measured and re-opened for DX review |
| Magical moment | Planned via `npm run dev:peace:v2` and `/peace-v2`: observe physical delivery, build from delivered stock, reload and see saved state; not implemented |
| Product type | API/Service primary; Phaser client, npm workspace and developer docs secondary |
| Mode | DX POLISH |
| Outside review | N/A: Codex CLI not installed; Plan subagent type and TaskStop unavailable; no replacement reviewer used |

### Historical Phase 2 DX principle coverage

| Principle | Coverage | Plan evidence |
|---|---|---|
| Zero friction | Reopened by Engineering D3; pending DX re-review and runtime proof | full-stack `PLAY_NOW.md` path, isolated DB startup and <5 min fresh-clone target |
| Learn by doing | Reopened by Engineering D3; pending DX re-review | first V2 interaction is a visible resident assignment, physical delivery and persisted build |
| Fight uncertainty | Covered | doctor, exact error fixes/recovery and database identity guard |
| Opinionated defaults + escape hatches | Covered | one default run path; versioned catalog files are editable and validated |
| Code in context | Covered | `API.md` examples paired with schemas/tests; no raw HTTP escape assumed |
| Magical moments | Reopened by Engineering D3; pending DX re-review | `/peace-v2` persistent game interaction, not an API ping or fixture-only demo |
| Agents are users | Covered | non-interactive doctor, `--json`, stable codes, correlation and redaction |

### Historical Phase 2 native DX reviewer findings and dispositions

Native in-host review of the DX checkpoint found no Critical issues. The returned report scored overall 8/10, with getting started 8, API/CLI 7, errors 6, docs 8, and escape hatches 6. It identified five concerns; exact severity label for the fifth was not fully present in the recovered tool text, so no unsupported severity is attributed here.

The reviewer input `ad1505378922e422b67ab8ec5d8f29f0b0199bb3d72715267e668a46d0425283` described the V2 first run through the then-selected `npm run dev:client`. Eng source inspection proved that script starts V1 and its proxy targets port 8787; D-DX-4 was superseded by D-DX-4R and the DX phase was reclosed with a separate V2 client. Engineering D3 now supersedes the client-only first-run contract with the full persistent `npm run dev:peace:v2` path. The prior DX score does not review this changed onboarding; no new DX reviewer run has occurred.

1. **High `CAP6:G3+ command/API failures:context`:** V2 API failures need operation and caller-safe submitted/current values. Accepted into RFC 9457 contract and G1 registry.
2. **High `CAP6:G3+ unexpected failures:trace`:** every introduced unexpected V2 command/persistence/simulation/sync failure needs correlation ID and protected local trace. Accepted.
3. **High `CAP6:G3+ operation failures:fix`:** each G1 path needs a safe authorized fix or exact human input. Accepted in `ERROR_REGISTRY.md` and tests.
4. **High `CAP6:G3+ operation failures:recovery`:** unknown mutation outcomes need explicit reconciliation by `request_id`, bounded retries and side-effect status. Accepted.
5. **Escape hatches/defaults:** contributors need a documented catalog/config source, defaults, validation and invariants. Accepted as file-based `content/peace-v2` tuning; no runtime override API.

Additional primary pass decisions: the V1 `.env` loader/default requires a separate V2 env/entrypoint and fail-closed DB guard; G2 start errors need a visible safe recovery; upgrade examples and first-run time need evidence. These do not authorize new public product scope.

Engineering Scope Challenge originally read `apps/client/index.html:150`, `apps/client/vite.config.ts:15-20`, and `apps/client/src/phaser/main.ts:1-30`: `npm run dev:client` starts V1 and its `/api` proxy targets port 8787. D-DX-4R corrected that path to a separate `apps/client-v2`; Engineering D3 then superseded the client-only `dev:peace:v2:client` launcher with the full-stack `npm run dev:peace:v2` G2 entrypoint. The historical DX close had no second reviewer; the updated full-stack onboarding has not yet been re-reviewed.

### Historical Phase 2 DX dual-voice table

| Dimension | In-host reviewer | Codex | Consensus |
|---|---|---|---|
| Getting started | 8/10 | N/A | N/A (outside missing) |
| API/CLI naming | 7/10 | N/A | N/A |
| Error messages | 6/10 | N/A | N/A |
| Documentation | 8/10 | N/A | N/A |
| Upgrade path | N/A (not separately scored) | N/A | N/A |
| Developer environment | N/A (not separately scored) | N/A | N/A |

Codex reviews are enabled, but `codex` is not installed; the available tools expose neither a Plan subagent type nor TaskStop, so the bounded native fallback is unavailable. No outside result or cross-model agreement is claimed. Competitor research through Aside/WebSearch was also unavailable; comparison times remain estimates.

### Historical Phase 2 required outputs and scope

- **NOT in scope:** public SDK/package release, hosted playground or service, new public API, user/community forum, analytics/telemetry, V1 migration, and production release policy.
- **What already exists:** root `README.md`; npm workspaces and lockfile; V1 scripts `dev:client`, `build`, `typecheck`, `test`, `e2e`; V1 `AppError` and `ErrorCode`; `docs/adr/0001-stack-and-repo-layout.md`, `docs/adr/0007-phaser-authoritative-client.md`; V2 `SOURCE_MAP.md` and `TEST_MATRIX.md`. V1 config loads root `.env`, defaults to `avanpost`, and Vite proxies `/api` to port 8787; preserve these paths and create V2-specific entrypoints.
- **TODOS.md:** no separate out-of-scope TODO. In-scope docs, doctor, error-contract and TTHW tasks below belong to G0/G1/G2/G3; no public community candidate is added.
- **Research:** Aside absent, WebSearch not exposed. Vite/Phaser and current V1 setup times are in-distribution estimates, not externally researched or observed. Product/persona/recent-decision/competitive-intel brain digests were all missing because the brain was unreachable; the persona therefore remains an inference from README/workspace evidence. Cross-project learning was not enabled; one project-scoped operational learning was loaded.

### Historical Phase 2 implementation checklist

| Checklist item | Plan disposition |
|---|---|
| TTHW <5 min from defined clean-checkout state | Target and one-time G2 evidence are required; not measured yet |
| Installation is one command | `npm ci`, then the client dev script; documented as one short path |
| First run produces meaningful output | Resident/route/ghost interaction, not just an API health response |
| Magical moment delivered | Planned at `/peace-v2`; fixture only until G3 |
| Every introduced failure meets agent-ready error contract | G1 `ERROR_REGISTRY.md` and tests; not implemented yet |
| API/CLI naming is guessable | `*:peace:v2` scripts, stable error codes and `API.md` |
| Defaults are sensible | one full-stack G2 path with isolated V2 DB; versioned catalog defaults |
| Docs have copy-paste examples that work | `PLAY_NOW.md` and `API.md`; verify against browser/schema tests |
| Examples show real use cases | first-use game flow plus API request/response; no fake persistence |
| Upgrade path and migration guide | `UPGRADE.md`, V2-only backup/migrate/restore; no V1 migration |
| Breaking-change warnings/codemods | N/A for private V2 app packages; schema/content migration notes required instead |
| TypeScript types included | existing shared TypeScript workspace; V2 contract types are G0/G1 work |
| Works in CI/CD without special configuration | engineering gate must define isolated test DB setup; not yet verified |
| Free tier/no credit card | N/A, local game repository, no hosted service or paid API |
| Changelog maintained | no public package release in scope; gate/release history stays in execution log until G11 |
| Search works in documentation | no docs search product in scope; keep README-linked, shallow V2 docs hierarchy |
| Community channel exists and is monitored | N/A for this repo's solo contributor persona; do not add a forum or support service |

### Historical Phase 2 implementation tasks (fixture/human-persona scope)

- [ ] **DX1 (P1, human: ~1 day / CC+gstack: ~2h)** — G2 safe onboarding — add `PLAY_NOW.md`, README link, `npm ci`/Node/database prerequisite checks, `npm run dev:peace:v2`, actual URL, first persisted interaction and recovery. Verify a clean clone without root `.env` and no calls to V1 client/API ports or database.
- [ ] **DX2 (P1, human: ~2 days / CC+gstack: ~1 day)** — G0 isolated V2 setup — add `.env.v2.example` and master-spec `*:peace:v2` scripts; doctor rejects `avanpost` before connecting and prints no secrets. Use separate V2 app/config/migration paths.
- [ ] **DX3 (P1, human: ~2 days / CC+gstack: ~1 day)** — G1 API/error docs — add `API.md` and `ERROR_REGISTRY.md`, stable codes, RFC 9457 bodies and tested examples for every required error/rescue path.
- [ ] **DX4 (P1, human: ~2 days / CC+gstack: ~1 day)** — G3 command recovery — expose correlation IDs, reconcile unknown outcomes by the same `request_id`, return stored result and bound retries; verify timeout/replay cases.
- [ ] **DX5 (P2, human: ~1 day / CC+gstack: ~2h)** — G0/G3 `UPGRADE.md` — document V2-only schema/catalog upgrade, preflight, backup, restore and V1 exclusion; verify against migration scripts.
- [ ] **DX6 (P2, human: ~4h / CC+gstack: ~30min)** — G2/G3 catalog tuning — document versioned `content/peace-v2` defaults, validation and fixed invariants; verify invalid catalog errors and restart behavior.
- [ ] **DX7 (P2, human: ~2h / CC+gstack: ~15min)** — G2 TTHW evidence — run a clean-clone first-use measurement and save start state, command, elapsed time, interaction result and blockers under `docs/v2/evidence/G2/`; no analytics.

## DX Re-review Summary

### Current re-review: OpenCode agent and nontechnical owner

Scores assess the reviewed plan, not shipped behavior. Step 0 incorporated the user’s persona correction; the prior human-contributor DX score is retained below as history and is not directly comparable.

| Pass | Before → after | Evidence and disposition |
|---|---:|---|
| 1. Getting started | 5/10 → 8/10 | Separates autonomous OpenCode setup/verification from owner browser play; `<5 min` agent TTHW remains unmeasured |
| 2. API/CLI ergonomics | 6/10 → 8/10 | Namespaced V2 commands and one integrated launch; exact flags/output still require G0 registry verification |
| 3. Errors/debugging | 6/10 → 8/10 | Agent-ready repair and owner-safe UI paths separated; local handoff errors and no-secret output specified for tests |
| 4. Documentation/learning | 5/10 → 8/10 | `AGENT_RUNBOOK.md` and terminal-free Russian `PLAY_NOW.md` have distinct audiences; neither has shipped |
| 5. Upgrade/migration | 8/10 → 8/10 | V2-only backup/migrate/restore remains agent-owned; no owner commands or V1 migration |
| 6. Developer environment/tooling | 5/10 → 8/10 | OpenCode owns dependencies, V2 env/DB/migrations/tests/recovery and service lifecycle; no V1 fallback |
| 7. Community/ecosystem | 8/10 → 8/10 | Private game repo; D-DX-14 keeps public forum/SDK scope out |
| 8. DX measurement | 6/10 → 8/10 | Agent TTHW and owner first-play friction are separate; one G2 measurement, no analytics |
| **Overall DX** | **6/10 → 8/10** | Plan-level mean rounded down; evidence is static, not a live DX run |

| Metric | Current assessment |
|---|---|
| Prior DX trend | 4/10 → 8/10 for human full-stack contributor / fixture G2; not comparable to the user-specified OpenCode-agent persona |
| Agent TTHW current | Not measured; previous 10–15 minute V1 README estimate is a different workflow |
| Agent TTHW target | `<5 min` from clean checkout to OpenCode’s verified full persistent flow and actual URL; approved, unmeasured, remeasure at G2 |
| Owner time-to-play | No technical setup; owner opens verified URL, uses local code handoff when pairing a phone, then plays; play time unmeasured |
| Magical moment | OpenCode completes safe setup, tests and browser verification, then gives the owner a live URL; owner sees real delivery/build/reload, not a demo |
| Product type | API/Service primary for the agent; Phaser game is the owner-facing product |
| Persona | OpenCode autonomous coding agent; nontechnical project owner/player |
| Mode | DX POLISH |
| Outside review | Codex unavailable; CLI missing, and Plan/TaskStop fallback unavailable; no replacement reviewer |

### DX principle coverage

| Principle | Coverage | Plan evidence |
|---|---|---|
| Zero friction | Covered in plan; runtime unknown | OpenCode owns setup; owner receives a verified URL and no commands |
| Learn by doing | Covered | Full persisted owner flow: pair, assign, observe delivery, build, reload |
| Fight uncertainty | Covered in plan | Agent doctor/runbook and owner-safe pairing/recovery states |
| Opinionated defaults + escape hatches | Covered | One V2 launch path, versioned content files; no owner environment overrides |
| Code in context | Covered in plan | `API.md` examples and real V2 API tests are planned |
| Magical moments | Covered in plan | Agent verifies the game before handoff; owner sees physical logistics and saved state |
| Agents are users | Covered | Non-interactive setup, structured doctor output, stable errors and safe recovery |

### Current DX required outputs

- **NOT in scope:** owner CLI/terminal/database operations; public SDK/package release, hosted playground/service, new public API, user forum, analytics/telemetry, V1 migration and production-release policy.
- **What already exists:** V1 README/workspaces/scripts and server errors; V2 `PLAN.md`, `STATUS.md`, `NEXT_ACTION.md`, `SOURCE_MAP.md`, `TEST_MATRIX.md`, and the saved QA Test Plan. No V2 app, command, database, `API.md`, Agent Runbook or owner Play Now guide exists yet; those are planned deliverables. Preserve V1 README commands and add separate agent-runbook/owner-guide links.
- **TODOS.md:** no new out-of-scope DX work; current tasks belong to G0/G1/G2/G3.
- **Research:** Aside and WebSearch unavailable; category times remain explicitly estimated. The V1 10–15 minute estimate is not an observation of OpenCode’s autonomous V2 flow.

### Current DX implementation checklist

| Checklist item | Plan disposition |
|---|---|
| OpenCode owns install/env/V2 DB/migrations/tests/recovery | `AGENT_RUNBOOK.md`; V2-only doctor/commands; no owner technical tasks |
| Owner can play without terminal | `PLAY_NOW.md` contains the verified URL, pairing handoff, controls and feedback only |
| First run gives meaningful output | OpenCode browser-verifies URL, pairing and persisted full loop before handoff |
| Loopback handoff remains private | D-DX-16 and `V2-PAIR-01`; no code in stdout/chat/URLs/logs/storage or LAN response |
| Every failure has an agent fix and owner-safe message | G1 `ERROR_REGISTRY.md`, doctor and owner state/recovery tests; not implemented |
| Agent TTHW <5 minutes to full persisted flow | One clean-checkout G2 measurement required; not measured |
| Owner experience and TTHW remain separate | Owner setup is zero terminal steps; first-play friction is recorded once, no analytics |

## DX Review Scorecard

### Current re-review: OpenCode agent and nontechnical owner

Scores assess plan quality and the source evidence, not shipped behavior. The old DX score measured a human full-stack contributor using fixture G2; it is retained above as history and is not directly comparable to this user-specified agent/owner split.

| Pass | Before → after | Evidence and disposition |
|---|---:|---|
| 1. Getting started | 5/10 → 8/10 | OpenCode owns setup/test/launch; owner opens a verified URL with no technical steps; the <5 min full-flow target remains unmeasured |
| 2. API/CLI ergonomics | 6/10 → 8/10 | V2 commands are namespaced and isolated; current V1 registry confirms V2 scripts are still unimplemented, so G0 must verify flags/output |
| 3. Errors/debugging | 6/10 → 8/10 | Agent receives safe repair/trace; owner sees concise recovery; local handoff and owner message split is explicit |
| 4. Documentation/learning | 5/10 → 8/10 | Agent Runbook and owner Play Now have separate audiences; exact outputs and examples remain G0/G1 work |
| 5. Upgrade/migration | 8/10 → 8/10 | V2-only backup/upgrade/restore remains agent-owned; no owner technical actions or V1 migration |
| 6. Developer environment/tooling | 5/10 → 8/10 | Agent owns dependency/env/DB/migration/test/service lifecycle; loopback handoff is checked separately from LAN access |
| 7. Community/ecosystem | 8/10 → 8/10 | Private game repo; prior decision D-DX-14 keeps public forum/SDK scope out |
| 8. DX measurement | 6/10 → 8/10 | One agent TTHW/full-flow measurement plus owner first-play friction note; no recurring analytics |
| **Overall DX** | **6/10 → 8/10** | Mean of eight dimensions, rounded down; TTHW/runtime remains unmeasured |

| Metric | Current assessment |
|---|---|
| Prior DX result | 4/10 → 8/10 for human full-stack contributor/fixture G2; not comparable to this agent-primary flow |
| Agent TTHW current | No V2 measurement; prior 10–15 min V1 README estimate is a different path |
| Agent TTHW target | `<5 min` from clean checkout to OpenCode’s browser-verified full persisted flow and actual owner URL; approved, unmeasured, remeasure at G2 |
| Owner time-to-play | No technical setup; owner opens verified URL and plays; time is separate/unmeasured |
| Product type | API/Service primary for OpenCode; Phaser game for the owner |
| Persona | OpenCode autonomous coding agent; nontechnical project owner/player |
| Mode | DX POLISH |
| Competitive tier | Competitive (`2–5 min` target band) |
| Magical moment | Agent verifies and hands off a live game URL; owner pairs, sees physical work/build and reloads the saved world |
| Outside voice | Codex unavailable; no Plan/TaskStop fallback, no replacement reviewer |

Decisions made this re-review: D-DX-15 and D-DX-16 (both user-selected and logged). Prior API/service type, competitive target, POLISH mode, no-office-hours choice and no-community choice remain in force. DX unresolved decisions: 0.

### DX principle coverage

| Principle | Coverage | Plan evidence |
|---|---|---|
| Zero friction | Covered in plan; runtime unknown | OpenCode owns the technical setup; owner receives a tested URL and no commands |
| Learn by doing | Covered | Owner plays a real persistent flow, not a fixture or API ping |
| Fight uncertainty | Covered in plan | Doctor/error registry and owner-safe pairing/recovery states; not implemented |
| Opinionated defaults + escape hatches | Covered | One integrated launch path; versioned catalogs, no owner env overrides |
| Code in context | Covered in plan | `API.md` examples are paired with V2 schemas/tests |
| Magical moments | Covered in plan | OpenCode proves the full flow before handing the URL to the owner |
| Agents are users | Covered | Non-interactive setup, structured doctor output, stable codes, safe recovery and redaction |

### Current DX required outputs and scope

- **NOT in scope:** asking the owner to run terminal/database/migration/debug commands; public SDK/package, hosted playground/service, public API, forum, analytics/telemetry, V1 migration or production release policy.
- **What already exists:** README and V1 npm workspace/scripts; V1 server errors and database defaults; `docs/v2/PLAN.md`, `STATUS.md`, `NEXT_ACTION.md`, `SOURCE_MAP.md`, `TEST_MATRIX.md` and the saved QA Test Plan. No V2 app, V2 command, V2 database, Agent Runbook or owner Play Now guide exists yet.
- **TODOS.md:** none exists; no new out-of-scope DX item was proposed.
- **Research:** Aside and WebSearch unavailable; category times are in-distribution estimates, not externally researched or observed. The prior DX review is retained as history but its human persona and fixture route are superseded by D-DX-15/16 and Engineering D3.

### Current DX implementation tasks

- [ ] **DXR-01 (P1, human: ~2 days / CC+gstack: ~4h, estimated)** — G0 Agent Runbook — document OpenCode’s exact inspect/install/V2-env/DB-guard/migrate/build/test/launch/browser-verify/stop sequence, expected outputs, safe retries and continuation; root README links to it without changing V1 commands.
- [ ] **DXR-02 (P1, human: ~1 day / CC+gstack: ~2h, estimated)** — G2 owner Play Now — create a Russian browser-only guide for the verified URL, local code handoff, pairing, controls, play, feedback and final acceptance; include no terminal, env, DB or migration steps.
- [ ] **DXR-03 (P1, human: ~1–2 days / CC+gstack: ~4–8h, estimated)** — G2 loopback owner handoff — show the code only in the in-memory loopback browser view; never emit/store it in stdout, chat, URLs, logs, evidence or persistent client storage; verify LAN clients cannot read it and the owner can copy it to the phone.
- [ ] **DXR-04 (P2, human: ~2h / CC+gstack: ~30min, estimated)** — G2 agent TTHW evidence — time one clean-clone full flow and record per-step/total time, result and owner first-play friction under `docs/v2/evidence/G2/`; no product analytics.

### Unresolved Decisions

None. D-DX-15/16 are individually user-approved; D-DX-1/3/4R/5/12/13/14 and D2–D5 remain preserved. Outside review is unavailable, not a pending user decision.

## Engineering review record

Review target and report file: `docs/v2/PLAN.md` (the original plan remains intact above this record).

### Scope Challenge: completed selectors

- Prior learning applied: `[v1-root-env-target]` (confidence 9, observed 2026-10-23): V1 config searches upward for root `.env` and defaults to database `avanpost` on port 5433. Do not start V2 server/migrations before V2-only configuration and pre-connect database identity guard are verified.
- Prerequisite: user selected `B) Skip and proceed` for D1. Existing CEO plan, GDD, master spec, and completed Design review supply product framing; no `/office-hours` document was added.
- Complexity estimate: four proposed V2 workspaces (`apps/client-v2`, `apps/server-v2`, `packages/peace-v2-shared`, `packages/peace-v2-sim`) and approximately thirteen server-side service areas. Complexity gate applies. Counts are estimates based on `PLAN.md:15-19`.
- Feature scope selector: no new feature cuts proposed. Preserve the previously approved complete peaceful Stage I scope; excluded Stage II/PvP/market/payment/V1 migration remain as already accepted.
- Structure selector `plan-eng-review-structure`, D2: user selected `A) Original arrangement (recommended)`; durable decision log `6f5ee4cf-fbad-4bd5-9e1d-521f2e50c4b3`. Keep four separate V2 workspaces; preserve the same features, contracts, safety requirements, and pending Engineering findings. No remedy was decided by this structure choice.
- Scope result: `scope accepted as-is`; no feature scope was reduced. F1 is approved by user answer D3 and F2 is aligned to the explicit master-spec contract. No Scope Challenge remedy remains pending; the four Engineering sections remain to be reviewed.

### F1: G2 fixture-only scope conflicts with the required playable vertical slice

Severity/confidence/reviewer: `[P1] (confidence: 10/10) plan and master spec — plan-eng-review`.

Plan baseline: before D3, the G2 row at then-current `PLAN.md:41` described a fixture-only client with “No V1 API, database, server, authoritative dig, economy or save”; then-current `PLAN.md:57` put the API-backed source in G3. The CEO plan also recorded the fixture demo (`.gstack/projects/avanpost/ceo-plans/2026-10-23-avanpost-v2-peace.md:37`). That proposal was superseded by the user's D3 selection; the baseline is retained here as review history, not as the current plan.

Runtime/source evidence: no G2 implementation exists yet (`STATUS.md:10-17`). Master spec §1.1 states at `AVANPOST_V2_MASTER_SPEC.md:36` that workers deliver to real warehouses and progress persists in V2 PostgreSQL after reload; §1.2 requires one-command launch at line 45. Master spec §12 G2 at lines 440-451 separately allows a local demo seed and defers authoritative persistence to G3, creating an internal scope conflict. User answer D3 resolves it in favor of the persistent playable vertical slice; G2 acceptance now follows §1.1 plus that explicit answer, while fixtures remain test-only. The plan names the master spec as its execution contract at `PLAN.md:145`.

Comparison grid:

| Choice | G2 world source and persistence | G2 capability timing | Approval / disposition |
|---|---|---|---|
| Current proposal | Client-only fixture; no authoritative V2 API/database/save | Persistence, physical logistics, construction and real underground gameplay deferred across G3–G6 | Existing CEO plan says fixture demo, but no direct user approval of the master-spec deviation is recorded |
| A) Align to the master spec | Isolated V2 server and PostgreSQL; authoritative state survives reload; V1 remains untouched | Move the minimum required persistent worker, logistics, building, underground and touch paths into G2; later gates extend rather than repeat them | Recommended; preserves full V2 PV contract |
| B) Keep fixture-only G2 | Keep current disposable fixture and no save/API/database | Defer real persistence and world actions to G3+ | Requires the user to approve this explicit deviation from the master spec |

Question D3:
D3 — Should G2 be the real persistent PV or a fixture demo?
Project/branch/task: Engineering FULL_REVIEW of `docs/v2/PLAN.md` on `feat/peace-v2-rebuild`.
ELI10: The plan’s G2 is a browser demo with temporary data, but the master spec defines the early playable product as a real settlement whose workers move goods and whose progress survives a reload. Choosing the demo is quicker, but it changes what the first playable milestone promises.
Stakes if we pick wrong: A fixture-only G2 cannot prove the persistent world the master spec asks the owner to play; moving persistence earlier will increase G2 work and shift responsibilities from later gates.
Recommendation: A because the master spec is the execution contract and explicitly requires real V2 persistence in the playable vertical slice.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Align G2 to the master spec (recommended)
  ✅ Deliver the requested playable vertical slice with a V2 database, real worker/logistics/building paths, and state that survives reload.
  ✅ Keep the same complete Peace Stage I scope while moving only the minimum required persistent paths earlier; leave V1 untouched.
  ❌ Requires more G2 implementation and a re-sequencing pass over G3–G6. (human: ~1–2 weeks / CC+gstack: ~2–4 days; estimated, refine after task breakdown)
B) Keep fixture-only G2 as an explicit spec deviation
  ✅ Retain the smaller client-only milestone so touch, camera, catalog and placement interactions can be exercised before server integration.
  ✅ Preserve V1 isolation and defer database/API setup until G3 rather than introducing it in the first playable gate.
  ❌ The first playable milestone will not meet the master spec’s persistent-world contract, so it needs an explicit owner-approved exception. (human: ~0 now / CC+gstack: ~0 now; the postponed persistent work remains required later)
Net: Choose whether G2 proves the real persistent game early or deliberately ships a smaller fixture milestone against the master spec.

Header: G2 persistence scope
Options:
A) Align G2 to the master spec (recommended)
Deliver an isolated V2 server and PostgreSQL-backed playable slice with real persistence and the minimum required worker/logistics/building/underground/touch paths. Keep V1 untouched and shift only necessary work earlier. Effort estimate: human ~1–2 weeks / CC+gstack ~2–4 days; refine after task breakdown.
B) Keep fixture-only G2 as an explicit spec deviation
Retain the client-only fixture at G2 and defer authoritative persistence/world actions to G3+. This explicitly deviates from `AVANPOST_V2_MASTER_SPEC.md:36`; proceed only with this user approval. Effort now: human ~0 / CC+gstack ~0; persistent work remains required later.

State: approved
Actual answer: A) Align G2 to the master spec (recommended), user selection D3; durable decision log `be1be150-0066-4de6-8a6f-4ae8e605affc`
Accepted scope: G2 is the persistent playable vertical slice using the isolated V2 API/PostgreSQL path, physical worker/logistics/building/access-to-cave actions, touch and reload persistence. Move only the minimum required authoritative paths from later gates into G2; later gates extend and harden them. Keep V1 untouched and do not introduce PvP, market, payment or Stage II scope.
History: before D3, the current plan and CEO review retained fixture-only G2. User selected the master-spec-aligned persistent slice; no implementation has begun.

### F2: Root build would pass without compiling the new V2 workspaces

Severity/confidence/reviewer: `[P1] (confidence: 10/10) package script and master spec — plan-eng-review`.

Plan baseline: the plan creates `apps/client-v2`, `apps/server-v2`, and two new V2 packages (`PLAN.md:15-19`) and requires a build/typecheck before each gate (`PLAN.md:68`). It preserves existing V1 workspace scripts and V1 runtime behavior.

Runtime/source evidence: the current root script at `package.json:17` is `"build": "npm run build -w @avanpost/server && npm run build -w @avanpost/client"`, so it builds only the V1 server and client. By contrast, `AVANPOST_V2_MASTER_SPEC.md:106` requires `npm run build` and `npm run typecheck` to compile all changed workspaces. `npm run typecheck` already targets workspaces (`package.json:20`); root build does not.

Disposition: accepted against the explicit master-spec requirement. G0 must make root `npm run build` compile all touched V1 and V2 workspaces while leaving the existing V1 workspace build scripts unchanged; the command and its actual workspace list must be verified before G0 passes. This is a plan correction, not evidence that V2 build code exists.

State: approved
Actual answer: direct user task/master-spec execution contract, `AVANPOST_V2_MASTER_SPEC.md:106`
Accepted scope: build all touched workspaces from root `npm run build`; preserve V1 workspace scripts and source behavior.
History: current root build covers V1 server/client only; no V2 workspace exists yet.

### F3: G2 LAN access and authentication are sequenced inconsistently

Severity/confidence/reviewer: `[P1] (confidence: 10/10) plan and master spec — plan-eng-review`.

Plan baseline: after D3, G2 starts a persistent V2 API and database (`PLAN.md:41`), while G3 is assigned “full auth/session” and the G2→G3 boundary says G3 expands auth/session (`PLAN.md:42,57`). The same plan allows LAN mode to print an address for the phone (`PLAN.md:399`).

Runtime/source evidence: no V2 server or session implementation exists (`STATUS.md:10-17`), so this was a proposed-path gap, not a reproduced exploit. Before D4, the master spec required an actual same-LAN phone URL (`AVANPOST_V2_MASTER_SPEC.md:42`) and said the API validates session and ownership (`AVANPOST_V2_MASTER_SPEC.md:331`), while the plan left G2's owner boundary unspecified. D4 resolves this by assigning a short-lived, single-use pairing flow and owner-scoped session to G2.

Comparison grid:

| Choice | G2 session and owner boundary | Phone/LAN availability | G3 scope |
|---|---|---|---|
| Current proposal | Persistent API exists, full auth/session deferred; G2 session behavior is unspecified | LAN mode is planned, so the playable world may be reachable without an assigned access boundary | Add full auth/session |
| A) Add minimal protected LAN session (recommended) | G2 creates a single-owner local session and pairs the phone before allowing world mutations; no account system | Keep the master-spec phone flow with scoped access | Expand and harden session/auth lifecycle and error coverage |
| B) Keep G2 host-only | No LAN session; bind the G2 app/API to localhost | Defer phone/LAN access until G3; use browser viewport emulation for G2 | Add session/auth and enable LAN mode |

Question D4:
D4 — Protect the persistent G2 world before LAN access?
Project/branch/task: Engineering Architecture review of `docs/v2/PLAN.md` on `feat/peace-v2-rebuild`.
ELI10: G2 now saves the game on a server, and the plan also lets a phone open that server over the local network. The plan postpones login/session checks until G3, so it has not said how G2 distinguishes the owner’s phone from another device on that network.
Stakes if we pick wrong: an unprotected LAN endpoint can let another device change the saved world; adding a small access step costs G2 work, while host-only access delays the phone flow.
Recommendation: A because it preserves the master-spec phone experience while requiring an explicit owner boundary before persistent mutations.
Completeness: A=10/10, B=8/10
Pros / cons:
A) Add a minimal protected LAN session (recommended)
  ✅ Require a single-owner local session/device pairing before G2 accepts persistent world commands, without adding accounts or multiplayer.
  ✅ Keep the master-spec phone/LAN flow and leave G3 to expand session lifecycle, ownership and broader API hardening.
  ❌ Move session setup and pairing UX into G2 and add its recovery tests earlier. (human: ~2–3 days / CC+gstack: ~4–8 hours; estimated)
B) Keep G2 host-only and defer LAN access
  ✅ Avoid exposing a persistent V2 command endpoint to other LAN devices before session/auth work exists.
  ✅ Keep G2 local to the developer’s machine and add the phone flow after G3 establishes session checks.
  ❌ G2 cannot be played from the phone on the same LAN; only emulated portrait browser coverage remains until G3. (human: ~0 now / CC+gstack: ~0 now; phone access is deferred)
Net: Choose between protected phone access in the first persistent gate and delaying LAN play until authentication arrives.

Header: G2 LAN session boundary
Options:
A) Add a minimal protected LAN session (recommended)
Require a single-owner local session/device pairing before G2 accepts persistent world commands. Keep the same-LAN phone flow; defer full account/session lifecycle hardening to G3. Effort estimate: human ~2–3 days / CC+gstack ~4–8 hours.
B) Keep G2 host-only and defer LAN access
Bind the G2 app/API to localhost and defer the phone/LAN flow until G3 session/auth work. This removes actual LAN-device E2E from G2; browser portrait emulation remains. Effort now: human ~0 / CC+gstack ~0; phone access is deferred.

State: approved
Actual answer: A) Add a minimal protected LAN session (recommended), user selection D4; durable decision log `18e0832e-cff8-4125-a9f4-35444ba6f8a1`
Accepted scope: G2 pairs the owner's phone with a high-entropy, rate-limited, short-lived, single-use local code before persistent world commands; the V2 API issues an owner-scoped session, and the code is not stored in persistent logs. No accounts or multiplayer are added. G3 expands account/session lifecycle and broader API hardening.
History: G2 was changed to a persistent API/PostgreSQL slice by user answer D3. Before D4, the plan deferred all auth/session work to G3 while allowing LAN access; D4 moved only the minimal owner boundary into G2.

### F4: Architecture notes named the V1 shared and simulation packages for V2

Severity/confidence/reviewer: `[P1] (confidence: 10/10) plan — plan-eng-review`.

Plan baseline: V2 package boundaries are `packages/peace-v2-shared` and `packages/peace-v2-sim` (`PLAN.md:15-19`), but the Architecture and Code Quality notes had referred to `packages/sim` and `packages/shared` as the V2 destinations. Those are existing V1 packages, which the plan explicitly says to leave unchanged.

Runtime/source evidence: root workspaces currently include both `packages/*` and `apps/*` (`package.json:6-9`); V1 `packages/sim/src/graph.ts` appears in the reuse inventory (`PLAN.md:178`). No V2 package exists yet (`STATUS.md:10-17`), so this was a plan-path ambiguity, not a changed-code defect.

Disposition: factual correction applied. Architecture and Code Quality now name `packages/peace-v2-sim` and `packages/peace-v2-shared`; V1 packages remain unchanged. No behavior choice or new abstraction was approved.

### F5: An arbitrary branch-count cap may fragment cohesive V2 methods

Severity/confidence/reviewer: `[P2] (confidence: 9/10) plan — plan-eng-review`.

Plan baseline: `PLAN.md:390` says “New V2 code should avoid >5 branch points in a method by separating validation, transition and persistence”. No source, measured defect or test threshold supports the number five; no V2 implementation exists yet.

Comparison grid:

| Choice | Method complexity guidance | Review consequence |
|---|---|---|
| Current proposal | Hard maximum of five branch points | Reviewers may require extraction even when one cohesive method preserves transaction invariants |
| A) Use cohesion and testability (recommended) | Split at meaningful responsibilities, error boundaries or transaction boundaries; use tests and review judgment rather than a fixed count | Avoid artificial helper boundaries while retaining readable, testable behavior |
| B) Keep the five-branch cap | Treat more than five branch points as a mandatory refactor trigger | Predictable threshold, but may produce extra abstractions and transaction fragmentation |

Question D5:
D5 — Keep the hard five-branch method cap?
Project/branch/task: Engineering Code Quality review of `docs/v2/PLAN.md` on `feat/peace-v2-rebuild`.
ELI10: The plan says every new method with more than five decision branches should be split. That can keep code readable, but a fixed number can also force extra helper functions around behavior that belongs together.
Stakes if we pick wrong: A hard cap can fragment correct transaction flows; removing it without a replacement can leave genuinely hard-to-test methods in place.
Recommendation: A because splitting at cohesive responsibilities and transaction/error boundaries is a better guide than an unsupported numeric limit.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Use cohesion and testability (recommended)
  ✅ Split methods where it creates a clear responsibility, error boundary or test seam rather than chasing a raw count.
  ✅ Preserve atomic persistence flows and rely on focused regression tests plus review to catch genuinely complex methods.
  ❌ Reviewers must use judgment and may disagree about whether a method has become hard to follow. (human: ~0 additional / CC+gstack: ~0 additional)
B) Keep the hard five-branch cap
  ✅ Give reviewers a uniform threshold that can flag large methods consistently across the V2 workspace.
  ✅ Keep the existing plan wording and require a refactor before a method grows beyond the stated bound.
  ❌ The limit has no measured basis and can create helper layers without reducing real complexity. (human: ~0 additional / CC+gstack: ~0 additional)
Net: Choose between a numeric review gate and responsibility-based complexity judgment.

Header: Method branch-count rule
Options:
A) Use cohesion and testability (recommended)
Split methods at meaningful responsibility, error or transaction boundaries; use tests and review judgment, not an unsupported numeric branch count. Effort: human ~0 additional / CC+gstack ~0 additional.
B) Keep the hard five-branch cap
Retain >5 branch points as a mandatory refactor trigger for new V2 methods. Effort: human ~0 additional / CC+gstack ~0 additional.

State: approved
Actual answer: A) Use cohesion and testability (recommended), user selection D5; durable decision log `915ca282-4416-4fad-902f-1f42cf40be1d`
Accepted scope: remove the hard five-branch cap; split methods at meaningful responsibility, error or transaction boundaries, and use focused tests/review for complexity. Keep the rule against abstractions without a concrete V2 caller.
History: user selected the recommendation after review of the unsupported numeric cap; no code implementation has begun.

### F6: Planned V2 E2E commands could reuse the V1 Playwright migration path

Severity/confidence/reviewer: `[P1] (confidence: 10/10) test configuration and master spec — plan-eng-review`.

Plan baseline: G0 names `test:peace:v2` and `e2e:peace:v2` but previously did not identify a V2-specific test configuration (`PLAN.md:129`).

Runtime/source evidence: the current `vitest.config.ts:5-9` includes `packages/**/test`, `apps/server/test` and `apps/client/test`, but omits `apps/server-v2/test` and `apps/client-v2/test`. The current `playwright.config.ts:21-33` starts `npm run db:migrate` and `npm run dev:server`, then builds/previews the V1 client. The master spec requires V2 E2E to use isolated `avanpost_v2_test` and the real V2 API (`AVANPOST_V2_MASTER_SPEC.md:104-106,545`). No V2 test harness exists yet.

Disposition: accepted against the master-spec and V1-safety contracts. G0 now requires dedicated V2 Vitest/Playwright configs; `test:peace:v2` and `e2e:peace:v2` must include V2 app/package tests, guard `avanpost_v2_test` before connection/reset, and never call root V1 migration/server/client scripts. The existing Vitest `packages/**` glob can still discover pure V2 package unit tests under root `npm test`; those tests must have no DB/network side effects, and V2 app/integration tests use the dedicated config. Existing V1 configs remain unchanged. This is a planned command/config correction; it is not evidence that V2 tests exist or ran.

### F7: The database guard must reject the V1 test database as well as the V1 game database

Severity/confidence/reviewer: `[P0] (confidence: 10/10) test setup and master spec — plan-eng-review`.

Plan baseline: the earlier G0 wording said the doctor refuses a V1 identity but named only database `avanpost`; the V2 test harness requires `TEST_DATABASE_URL` and destructive test setup.

Runtime/source evidence: V1 `apps/server/test/app.test.ts:13-15` defaults `TEST_DATABASE_URL` to the `avanpost_test` database on localhost port 5433, and `beforeEach` truncates V1 tables at lines 53-56. Root `.env.example:3-4` names both `avanpost` and `avanpost_test`. Master spec §3.2 (`AVANPOST_V2_MASTER_SPEC.md:96`) requires distinct V2 dev/test databases and identity checks before test `TRUNCATE`.

Disposition: direct V1-safety and master-spec correction applied. The V2 doctor, startup, migration, and test harness must reject both `avanpost` and `avanpost_test` before connecting or mutating; G0 now records both names. Required regression evidence checks both rejected identities without connecting to either database. No V1 test or database command was run during this review.

### Test Review — Section 3

**Framework detection:** `CLAUDE.md` has no `## Testing` section. Repository markers and scripts identify Node/TypeScript with Vitest unit/integration tests and Playwright browser E2E (`vitest.config.ts:1-14`, `playwright.config.ts:1-35`, `package.json:18,24`). Current root Playwright and DB tests are V1-only. Glob found eight current test files; no V2 implementation or test file exists. No tests were run during this plan review and no test framework/dependency is proposed.

**Current coverage evidence:** existing V1 tests exercise cookie sessions, snapshots, world commands, transactions, and a browser reload flow (`apps/server/test/app.test.ts:64-102,755-843`; `e2e/app.spec.ts:125-157`). They do not count as V2 coverage. All 30 GDD test rows and the three existing V2 supplemental regression rows in `TEST_MATRIX.md` remain `NOT_STARTED`.

```text
CODE PATHS                                                   USER FLOWS
[GAP] dev:peace:v2                                           [GAP] clean start → actual URL → one-time pairing code
  ├─ parse V2 env and both DB identities                        ├─ invalid/expired/reused code → deny + safe re-pair
  ├─ reject avanpost / avanpost_test before connect/reset       └─ valid pairing → owner-scoped session
  ├─ migrate only avanpost_v2_dev / avanpost_v2_test
  └─ V2 health + client /peace-v2                             [GAP] select worker → assign reachable task
                                                                ├─ path blocked → reason, no item mutation
[GAP] owner session → snapshot → Phaser/DOM render              └─ move → gather → haul → delivered material
  ├─ stale version → conflict + fresh snapshot
  ├─ duplicate request_id → stored result, one effect           [GAP] open catalog → preview ghost → cancel/confirm
  ├─ transaction failure → rollback, cargo remains located      ├─ pointercancel/pinch/resize → never submit
  └─ DB/API loss → read-only snapshot, no fixture fallback      └─ valid build → reload → same saved world

[V1 reference only] root vitest.config.ts                       [GAP] offline → last snapshot read-only → reconnect
  └─ packages/**, apps/server/test, apps/client/test             (never mutate economic state locally)
[V1 reference only] root playwright.config.ts
  └─ db:migrate + V1 server + V1 client preview                 [GAP] G3–G11 I-E2E-01..30 and recovery matrix
                                                                  (all matrix rows NOT_STARTED)
```

**Test value and additions:** no approved test decision remains pending. The saved QA Test Plan contains value cards for `V2-DBSAFE-01` (reject both V1 DB names before connect/reset), `V2-PAIR-01` (one-time owner pairing and all denial/recovery branches), and `V2-PV-01` (real V2 API/Postgres gather→haul→build→reload path). Add these supplemental rows to `TEST_MATRIX.md` during G1 without renumbering the 30 GDD scenarios. Keep pure V2 package unit tests DB/network-free; V2 app integration tests use the dedicated Vitest config and `avanpost_v2_test`; Playwright uses the dedicated V2 config and real V2 API. No existing tests are proposed for retirement.

Saved QA artifact: `/Users/labiozzza/.gstack/projects/avanpost/labiozzza-feat-peace-v2-rebuild-eng-review-test-plan-20261023-223929.md` (read-back complete). It describes planned coverage only; no V2 tests or browser pass exist yet.

### F8: Performance profiles and source targets were not testable as written

Severity/confidence/reviewer: `[P1] (confidence: 9/10) plan and master spec — plan-eng-review`.

Plan baseline: `PLAN.md:345` referred to 10×/100× scenarios without a measured base; `PLAN.md:394` named p50/p95 and generic stress profiles but omitted the master-spec scale definitions, FPS targets, scene-load time and command latency.

Runtime/source evidence: there is no V2 runtime or performance measurement yet (`STATUS.md:10-17`). Master spec §11.1 (`AVANPOST_V2_MASTER_SPEC.md:411`) specifies small, medium (multiple sectors/tens of workers) and stress (hundreds of entities/many thousands of cells) profiles; proposed targets are stable 60 FPS desktop and at least 30 FPS on a reasonable phone; screen load and command duration must be measured. Emulation is preliminary, not a physical-device result.

Disposition: accepted against the explicit master-spec measurement requirement. The performance plan now measures those profiles, frame rate, scene-load time, command latency p50/p95 and scene memory retention; retains 60/30 FPS only as provisional targets; and removes unbased 10×/100× claims. No performance test or optimization was run during this review.

### Independent in-host Engineering reviewer

Input: Eng snapshot `a17699f1fba86c9c697d245e1711ddd7dcd4e130d77ce9c2bbb485518ece7ea2`; report matched its input hash and recommended revision before G1. Codex was not installed, and the bounded outside/native fallback tools were unavailable; no outside consensus is claimed. These are plan findings only; no V2 runtime behavior was executed.

| Finding | Severity | Disposition in the plan |
|---|---|---|
| N1. Database identity aliases/hosts could bypass a database-name-only guard. | P0 | Accepted: allowlist V2 database names and local/V2-compose hosts before pool creation; verify actual connected identity before migration/reset; test malformed URLs, aliases, hosts and both V1 names. |
| N2. Pair code trust, entropy, attempts, process binding and interface scope were incomplete. | P1 | Accepted under D4: launcher/world-bound code, 128-bit entropy `[estimated security default]`, 5-minute expiry and 5-failure window `[estimated defaults]`, atomic one-use, strict Host/Origin and same-origin POST, private interfaces only, no URL/log leakage; document the trusted-LAN development boundary. |
| N3. Idempotency key scope, payload mismatch, atomic effect/result and retention were incomplete. | P1 | Accepted: `(player_id, request_id)` plus canonical payload hash; same payload replays exact result, changed payload conflicts; effect/result commit atomically; retain replay records for world lifetime and only compact while preserving replay. |
| N4. Commands and server ticks lacked a single per-world order. | P1 | Accepted: serialize mutation/tick transitions on the world revision lock and commit canonical sequence/revision with state; verify concurrent and restart ordering. |
| N5. Catch-up progress and completion after restart/competing clients were incomplete. | P1 | Accepted: persistent progress and one active world lease; block mutations while syncing; expose remaining ticks and poll authoritative snapshot; resume from the last committed tick after restart. |
| N6. Application-only placement checks could race across overlapping footprints. | P1 | Accepted: database uniqueness on `(world_id, cell_x, cell_y)` plus transaction/retry; conflicts return typed response and cannot debit materials partially. |
| N7. Haul/item identity, quantity, split/merge and interrupted-state reconciliation were incomplete. | P1 | Accepted: stable stack IDs, nonnegative integer quantities, one authoritative location, and atomic split/merge/haul ledger transitions with conservation tests. |
| N8. Seed and generator/catalog versions were not bound to each persistent world. | P1 | Accepted: persist seed plus generator, sim, catalog/content and schema versions/hashes; existing worlds do not silently adopt changed rules. |
| N9. Client disconnection, server outage and server-side catch-up were conflated. | P1 | Accepted: client stays read-only and never queues mutations; server-owned elapsed time is deterministically caught up on reconnect, with explicit syncing state. |
| N10. GDD requirement-to-evidence links lacked stable identifiers and a completeness check. | P1 | Accepted: stable `REQ-####` IDs with canonical source anchors, `check:peace:v2:source-map`, and explicit blocked/N/A review; retain all 30 `I-E2E` IDs. |
| N11. G2 was broad without intermediate implementation checkpoints. | P1 | Accepted without reducing scope: boot/pair/snapshot, reachable assignment/delivery, build, reload/touch checkpoints; none is a gate pass or fixture substitute. |
| N12. Evidence redaction, size and retention were not operationally defined. | P2 | Accepted: commit required metadata/traces/screenshots with sizes and hashes, redact codes/credentials, compress traces, omit raw DB dumps/network payloads/video, measure G0 size baseline and set a data-based cap before G11. |
| N13. Root build could couple V1 maintenance to V2 setup. | P2 | Accepted while preserving master spec §3.3: add compile-only `build:peace:v2`; root `npm run build` still compiles all touched workspaces, and V2 build requires no app environment or database. |

Durable gstack decision receipts for native Engineering resolutions: N1 `6c214ab5-ca5a-4c5c-825f-fdf9a8678a22`; N3 `87e42d07-e926-49a4-80b6-30f3a128de87`; N4/N5 `a6049042-f6ae-4761-89a3-560b2b743f24`; N6/N7 `9643e7dc-bb58-4ca4-902d-66c9771b3c2a`; N8/N9 `445f49c4-d74b-429b-9556-26e2a6891349`; N10 `07f8437b-573b-4458-8fb6-2b6432e8d16b`; N11 `4cc77b82-d776-47f7-ba46-81c8646a0cd9`; N12 `b08f34c2-3be5-45c2-9542-76651d180668`; N13 `d7f009e0-5568-4656-83bb-fcd305a1d292`.

### Final Engineering planning decisions

- `TODOS.md`: none exists and no out-of-scope Engineering item was accepted or deferred during this review.
- `Approval readiness: PASS` for Engineering remedies: user answers D3/D4/D5; structure answer D2; direct master-spec/user contracts for F2/F6/F7/F8; and the N1–N13 in-host review dispositions recorded above. No Engineering remedy is pending.
- Final Engineering FULL_REVIEW was rerun after the Design/DX re-reviews and D-DX-15/16. No new plan findings or unresolved Engineering decisions were found. The 14-row reality check passes with zero unverified premises; the absent V2 commands and loopback route remain explicit G0/G2 implementation requirements, not claims of completed runtime behavior.
- `G1 remains IN_PROGRESS`: no V2 implementation, tests, database or browser verification exists yet, and the CEO's independent post-fix spec re-verification remains unresolved. This Engineering review clears the plan for implementation work only; it does not pass G1 or claim a clean CEO re-review.

### Engineering reality and premise receipts

| Premise | Claim | Evidence receipt | Verdict |
|---|---|---|---|
| No V2 runtime exists | V2 API/client/database and V2 tests have not been implemented or executed. | `docs/v2/STATUS.md:10-17`; `docs/v2/PLAN.md:1152-1179` | verified |
| Root build scope | Current root `build` only compiles V1 server/client workspaces. | `package.json:13-24`; `AVANPOST_V2_MASTER_SPEC.md:100-109` | verified |
| V1 database hazard | V1 config defaults to `avanpost`; V1 tests default to `avanpost_test` and truncate tables. | `apps/server/src/config.ts:35-48`; `apps/server/test/app.test.ts:13-15,53-56`; `.env.example:3-4` | verified |
| Current test routes | Root Vitest/Playwright configs include V1 paths and root E2E starts V1 DB/server. | `vitest.config.ts:5-9`; `playwright.config.ts:21-33`; `docs/v2/PLAN.md:1134-1139` | verified |
| G2 scope | The user's D3 choice supersedes the earlier fixture-only G2 and makes G2 the persistent V2 playable slice. | `docs/v2/PLAN.md:985-1013`; `docs/v2/PLAN.md:146-156` | approved |
| LAN boundary | The user's D4 choice requires pairing and an owner-scoped session before LAN mutations. | `docs/v2/PLAN.md:1046-1074`; `docs/v2/PLAN.md:146-156` | approved |
| Agent/owner responsibilities | OpenCode owns all setup/test/recovery/browser verification; the owner only opens a verified URL, pairs, plays and accepts. | `docs/v2/PLAN.md:157-165`; `docs/v2/PLAN.md:962-983`; D-DX-15 receipt | approved |
| Pairing-code handoff | The code is available only in a loopback-only in-memory owner view, not to LAN clients or saved outputs. | `docs/v2/PLAN.md:43,160-162,941-943`; D-DX-16 receipt; `docs/v2/TEST_MATRIX.md:47` | approved |
| Performance claims | FPS and scale targets are proposals; no V2 benchmark has been run. | `AVANPOST_V2_MASTER_SPEC.md:409-415`; `docs/v2/PLAN.md:412,1185-1189` | verified |
| Tests | All 30 required GDD cases and supplemental V2 cases remain `NOT_STARTED`; no tests ran in this review. | `docs/v2/TEST_MATRIX.md:13-47`; `docs/v2/PLAN.md:1152-1179` | verified |
| Dependencies | No new external library, patch or vendored dependency is proposed. | `package.json:26-34`; `docs/adr/0001-stack-and-repo-layout.md:5-12` | verified |
| Deferred scope | No `TODOS.md` or independent deferred Engineering item exists; Stage II and V1 migration remain out of scope. | `docs/v2/PLAN.md:555,1215`; `docs/v2/PLAN.md:10,54` | verified |
| Main-branch already-done check | Fetched `origin/main`; no matching plan/workspace changes or matching V2/source-map commit subjects since 2026-10-23. | `origin/main` at review check; `git log origin/main --since=2026-10-23 -- <named paths>` and `--grep` returned no entries | verified |

### Engineering REALITY rows

```text
REALITY: premise-table pass All factual premises above have source receipts; no unverified premise is used docs/v2/PLAN.md:1493-1508
REALITY: already-done pass Fetched origin/main and found no matching work since 2026-10-23; no implementation task is already merged 87b463ae225f2c690d80f2cb29bba0f55eb4263a
REALITY: surface-check finding npm run confirms V2 commands and the new loopback handoff route are not implemented yet; G0/G2 must register and verify them before use package.json:13-24; AVANPOST_V2_MASTER_SPEC.md:100-109; docs/v2/PLAN.md:43,160-165
REALITY: binding-decisions pass D2-D5, D-DES-7/8/9, D-DX-15/16 and N1-N13 are preserved with user answers and exact scope docs/v2/PLAN.md:83-162,931-1013
REALITY: numbers pass Effort/security defaults are labeled estimated; the user-approved agent TTHW <5 min target is explicitly unmeasured; FPS targets are source proposals docs/v2/PLAN.md:158,173-185,588-593,856-867; AVANPOST_V2_MASTER_SPEC.md:409-415
REALITY: deferred-asks pass No linked issue request or independent deferred Engineering item was omitted; excluded scope is explicit docs/v2/PLAN.md:10,54,555,1215
REALITY: pr-count pass No .gstack/ship-policy.json exists; default is one PR per wave and the plan preserves the single G0-G11 dependency chain docs/v2/PLAN.md:54
REALITY: prior-art n/a No new, patched or vendored dependency is proposed; existing installed dependencies are reused package.json:26-34; docs/adr/0001-stack-and-repo-layout.md:5-12
REALITY: transaction-semantics n/a No driver, pool or protocol change is proposed; required transaction/crash behavior is specified and assigned tests AVANPOST_V2_MASTER_SPEC.md:327-359; docs/v2/PLAN.md:30-35,1197-1209
REALITY: contract-assumptions n/a No defaults or flags are imported from another repository; proposed commands and boundaries are anchored to the master spec docs/v2/PLAN.md:15-23,134; AVANPOST_V2_MASTER_SPEC.md:98-109
REALITY: units n/a No existing input units or precision are changed; V2 coordinates and quantities have explicit integer semantics docs/v2/PLAN.md:27-35; AVANPOST_V2_MASTER_SPEC.md:136-142
REALITY: perf-table pass The plan records machine, engine, data size, N, p50/p95, cache state, base/branch interleaving, steady/pathological profiles and reproduced-on-main status; measurements await G2/G11 docs/v2/PLAN.md:410; AVANPOST_V2_MASTER_SPEC.md:409-415
REALITY: dependency-fallback pass G0-G11 remains an explicit chain; G2 requires the persistent V2 path and cannot fall back to fixtures docs/v2/PLAN.md:37-60
REALITY: obligation-tiers pass G0/G1 safety and traceability precede persistent G2; tasks T1-T6 and DXR-01..04 carry priority and estimated effort docs/v2/PLAN.md:37-66,587-594,1222-1225
```

Reality check: 14/14 applicable rows emitted; 0 unverified premises. `surface-check` remains an implementation requirement: root scripts and the loopback handoff are not implemented; G0/G2 own their registration and safety verification. Performance protocol is ready for implementation, but measured results remain future G2/G11 evidence.

### Engineering required outputs

**NOT in scope**

- V1 application, database, migrations, saves, workspace scripts, and data changes; Stage II, PvP, marketplace, crystals, payments, merge, production deployment, and user-owned DB operations.
- New third-party dependencies or multiple PRs; no production security or authentication claim for private-LAN pairing.

**What already exists**

- Reuse the installed Phaser/Vite/Fastify/Kysely/PostgreSQL toolchain and selected renderer, clock, resident, craft and research patterns; the evidence and reuse/avoid decisions are in `docs/v2/PLAN.md:186-196`.
- Existing V1 transaction, session, snapshot, and Playwright tests are reference evidence only. They do not count as V2 implementation or V2 coverage.

**Failure modes**

| Failure | Planned handling | Verification | User-visible result |
|---|---|---|---|
| Invalid DB URL, alias, V1 name or unapproved host | Reject before pool creation; verify connected identity before migration/reset. | G0 doctor and DB guard regressions for malformed URL, aliases, both V1 DBs and hosts. | Safe typed refusal; no connection or mutation. |
| Expired, replayed or brute-forced pairing code | Atomic one-use, expiry/rate limit, strict Host/Origin, no code in URL/logs. | Pairing valid/expired/replay/rate-limit tests. | Clear re-pair action; no world mutation. |
| Concurrent retry, build or item transfer | Atomic result/effect, payload-hash conflict, occupancy uniqueness and conserved ledger. | Idempotency, overlap, rollback and item-conservation integration tests. | Typed conflict; no partial debit, duplicate item or lost cargo. |
| Server restart during catch-up | Persist one lease and progress; resume last committed tick and block mutations until complete. | Crash/restart and competing-client tests. | Explicit syncing state and remaining progress. |
| API/database outage or reload | Client remains read-only; no fixture fallback; reload reads authoritative V2 snapshot. | API-loss and persistent reload browser E2E. | Last confirmed view and retry/recovery action; no false saved-state claim. |

No newly diagrammed path has a known silent failure without both handling and a planned test; critical gaps flagged: 0. These are planned contracts, not runtime evidence.

**Implementation parallelization:** Sequential implementation, no parallelization opportunity. Shared schemas, database ownership and the G0→G11 gates make apparently separate client/server tasks contract-dependent.

### Engineering Completion Summary

```text
Scope Challenge: scope accepted as-is; no feature scope reduced.
Reality rows: 14/14 applicable; 0 unverified premises.
Architecture Review: initial review findings F1-F4 dispositioned; final rerun found 0 new plan issues.
Code Quality Review: initial finding F5 dispositioned; final rerun found 0 new plan issues.
Test Review: diagram produced; 3 supplemental regressions identified (V2-DBSAFE-01, V2-PAIR-01, V2-PV-01); all implementation coverage remains NOT_STARTED; final rerun found 0 new plan issues.
Performance Review: initial finding F8 dispositioned; final rerun found 0 new plan issues; no benchmark run.
Independent in-host review: 13 findings (N1-N13), dispositions recorded; outside Codex unavailable.
NOT in scope: written. What already exists: written.
TODOS.md updates: 0. Critical gaps flagged: 0. Unresolved decisions in this review: 0.
Outside voice: Codex unavailable; no external consensus claimed.
Parallelization: sequential implementation, no parallelization opportunity.
Lake Score: 2/2 = D3 and D4 selected 10/10 coverage options; D5 options differed in kind.
Final review: 0 new Engineering findings; existing findings and accepted remedies remain documented above.
Tests/builds/browser/performance: not run; no V2 runtime exists.
```

Engineering task JSONL: `/Users/labiozzza/.gstack/projects/avanpost/tasks-eng-review-20261024-015336.jsonl` (5 tasks; saved for Autoplan aggregation).

Review snapshot note: the Engineering completion/report below records the state observed when final FULL_REVIEW ran, before G0 implementation. Current gates and evidence are tracked in `docs/v2/STATUS.md` and `docs/v2/NEXT_ACTION.md`.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---:|---|---|
| CEO Review | `/plan-ceo-review` via `/autoplan` | Scope & strategy | 1 | DONE_WITH_CONCERNS | 6 native findings dispositioned; independent post-fix spec verification unavailable after 3-launch cap |
| Outside Review | Codex plan review / Autoplan outside voice | Independent second opinion | 6 attempts | unavailable | Codex CLI absent; bounded Plan/TaskStop fallback unavailable across CEO, Design, DX and final Eng review |
| Eng Review | `/plan-eng-review` via `/autoplan` | Architecture, quality, tests and performance | 2 | CLEAR | Initial findings F1-F8 and N1-N13 dispositioned; final rerun found 0 new plan issues; reality check 14/14; 0 unresolved Eng decisions and 0 critical gaps |
| Design Review | `/plan-design-review` via `/autoplan` | UI/UX gaps | 2 | CLEAR | Current scope review 7/10 → 8/10; all 7 passes completed; D-DES-7/8/9 resolved; 0 unresolved; mockups unavailable |
| DX Review | `/plan-devex-review` via `/autoplan` | Developer experience | 2 | CLEAR | Current agent/owner re-review 6/10 → 8/10; 8 passes; D-DX-15/16 resolved; 0 unresolved; <5 min Agent TTHW remains unmeasured |

**OUTSIDE COVERAGE:** Codex reviews unavailable for CEO, Design, DX and Eng; CLI is not installed and this host exposes no bounded Plan/TaskStop fallback. Aside and WebSearch are unavailable; no external review or cross-model agreement is claimed.

**VERDICT:** ENG CLEARED for implementation planning; G0/G1 stay `IN_PROGRESS`. This is not a G1 pass: implementation, V2 tests, database isolation and browser verification remain future gates. CEO post-fix independent spec verification remains unresolved; no external review or runtime acceptance is claimed.

**UNRESOLVED DECISIONS:**
- 1 unresolved from prior reviews: CEO spec post-fix independent re-verification was unavailable after its three-launch limit; do not claim independent re-verification or G1 PASS.
