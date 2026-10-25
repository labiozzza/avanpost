# Peace V2 requirement-to-gate-to-evidence map

Status: G1 gate disposition `PASS` by user D7-A; row-level behavior/evidence states below remain independently tracked. This is a traceability contract, not proof that mapped behavior is implemented. `check:peace:v2:source-map` verifies row structure, canonical-source coverage, stable IDs, the 30 GDD scenario IDs, and required supplemental regressions. Later gates still require their actual evidence artifacts.

## Canonical inputs

| Source | Version | SHA-256 | Use |
|---|---|---|---|
| `AVANPOST_V2_MASTER_SPEC.md` | 1.0, 2026-10-23 | `74e6207249ebbc0c45117f484525ac731a4f9a330f71536b9b56474525ced052` | V2 execution, safety, gate and evidence contract |
| `Avanpost_GDD_v0.9.md` | v0.9 | `61bd13f8212409cfa8a253da6f56ed542ded0efef3b08289638619498678e671` | Peace Stage I product requirements |
| `docs/reference/peace-sideview-migration_ARCHIVE.md` | archived plan | `e617e83118b40a6bffadee5fe61d59bd700be04c0aa400e8f920dec6171bd732` | Historical risk register only; V1 world conversion is excluded |

## Requirement rows

| REQ-ID | Canonical source anchors | V2 contract | Gate | Owner | Observable assertion | Failure / recovery | Evidence path | Status |
|---|---|---|---|---|---|---|---|---|
| REQ-0001 | Master §0.1–0.7; GDD §0.1–0.5 | `DECISIONS.md`, `PLAN.md` | G0/G1 | OpenCode | Build only approved peaceful Stage I; every proposed number has provenance | Scope conflict blocks the row; preserve user decisions and revise the contract before implementation | `docs/v2/evidence/G1/REQ-0001/` | IN_PROGRESS |
| REQ-0002 | Master §1.1–1.3 | `PLAN.md`, `UI.md`, `TEST_MATRIX.md` | G2/G11 | OpenCode | Browser offers real side-view play and persistent progress, not a fixture masquerading as a save | Missing API/database blocks play; report NO owner URL and restore the last safe V2 state | `docs/v2/evidence/G2/REQ-0002/` | IN_PROGRESS |
| REQ-0003 | Master §3.1–3.4; GDD §20.1–20.2 | `BASELINE.md`, `SECURITY.md`, V2 compose/config | G0 | OpenCode | V2 uses separate workspaces, project, volume, port and databases; V1 remains untouched | Any V1 identity or root V1 command is a hard stop; preserve both databases and report the stable refusal | `docs/v2/evidence/G0/REQ-0003/` | PASS |
| REQ-0004 | Master §3.3; master §12 G0; GDD §23 | `AGENT_RUNBOOK.md`, `package.json`, doctor | G0 | OpenCode | Named V2 scripts report real health and never inherit V1 setup | Missing prereq, port or URL returns a safe code and next action; no blind retry | `docs/v2/evidence/G0/REQ-0004/` | PASS |
| REQ-0005 | GDD §1.1; master §4.1–4.2 | `SIMULATION.md`, `SCHEMA.md`, `packages/peace-v2-sim` | G1/G2/G6 | OpenCode | Signed X/Y sector round-trip holds at negative, zero, positive coordinates; renderer preserves 1:1 world scale | Invalid/out-of-range coordinates are rejected before mutation; preserve authoritative state | `docs/v2/evidence/G1/REQ-0005/` | IN_PROGRESS |
| REQ-0006 | GDD §1.2; GDD §3.2; master §6.2 | `ECONOMY.md`, `CONTENT.md` | G1/G4/G6 | OpenCode | Finite nodes stop at zero; low-rate baseline sources prevent deadlock | Negative or exhausted extraction is rejected; show a typed empty-source reason | `docs/v2/evidence/G4/REQ-0006/` | NOT_STARTED |
| REQ-0007 | GDD §1.3; master §4.3 | `SIMULATION.md`, `API.md` | G1/G2/G4/G6 | OpenCode | Worker/cart routes respect support, clearance and transport masks | Blocked path leaves actor and cargo in place with `NO_PATH`; recalculate after topology change | `docs/v2/evidence/G2/REQ-0007/` | NOT_STARTED |
| REQ-0008 | Master §4.4, §4.6; GDD §1.1 | `SIMULATION.md`, `TEST_MATRIX.md` | G1/G2/G6 | OpenCode | Adjacent sectors generated in either order produce identical seams and unique nodes | Generator mismatch blocks sector commit; retain last valid world revision | `docs/v2/evidence/G6/REQ-0008/` | NOT_STARTED |
| REQ-0009 | GDD §2.1; master §5.1 | `SCHEMA.md`, `API.md` | G1/G7 | OpenCode | A resident ID maps to one durable person and one rendered actor after reload | Duplicate identity/assignment returns conflict with no partial assignment | `docs/v2/evidence/G7/REQ-0009/` | NOT_STARTED |
| REQ-0010 | GDD §2.2; master §5.1 | `SCHEMA.md`, `ECONOMY.md` | G1/G7 | OpenCode | New residents arrive only while valid housing capacity exists | Full housing blocks migration without creating a resident row or sprite | `docs/v2/evidence/G7/REQ-0010/` | NOT_STARTED |
| REQ-0011 | GDD §2.3; master §5.2–5.4 | `CONTENT.md`, `API.md`, `UI.md` | G1/G7 | OpenCode | School ordering produces the catalogued 4 singles, 6 pairs and 12 ordered triples | Invalid/repeated schools or unqualified work return a safe localized denial | `docs/v2/evidence/G7/REQ-0011/` | NOT_STARTED |
| REQ-0012 | GDD §3.1; master §6.1 | `ECONOMY.md`, `SCHEMA.md` | G1/G4 | OpenCode | Every item has one stable identity and a concrete source, buffer, store or cargo location | Missing/duplicate location blocks commit and emits an invariant failure trace | `docs/v2/evidence/G4/REQ-0012/` | NOT_STARTED |
| REQ-0013 | GDD §3.2; master §6.2–6.3 | `CONTENT.md`, `ECONOMY.md`, `PeaceCatalogSchema` | G1/G4/G8 | OpenCode | Resource, capacity and recipe values are versioned with provenance | Invalid catalog reference blocks load; keep the prior valid catalog/world version | `docs/v2/evidence/G1/REQ-0013/` | IN_PROGRESS |
| REQ-0014 | GDD §3.3; master §8.1–8.3 | `ECONOMY.md`, `CONTENT.md`, `RecipeDefinitionSchema` | G1/G8 | OpenCode | Multi-stage recipe output requires real inputs, fuel, specialist and buffer capacity | Missing condition pauses work without emitting an item; show the exact idle reason | `docs/v2/evidence/G8/REQ-0014/` | IN_PROGRESS |
| REQ-0015 | GDD §3.4; master §6.4 | `ECONOMY.md`, `API.md` | G1/G4/G5 | OpenCode | Haul phases persist source, quantity, destination, reservation and cargo | Crash/replay resumes one real phase; never duplicate, destroy or teleport cargo | `docs/v2/evidence/G4/REQ-0015/` | NOT_STARTED |
| REQ-0016 | GDD §3.5; master §9.3 | `SIMULATION.md`, `SCHEMA.md` | G1/G8/G11 | OpenCode | Equal seed and ordered commands yield equal online/offline canonical state | Catch-up cap persists remaining ticks and keeps writes disabled until sync completes | `docs/v2/evidence/G8/REQ-0016/` | NOT_STARTED |
| REQ-0017 | GDD §4.1–4.2; Master §4.5, §7.1 | `BUILDINGS.md`, `CONTENT.md`, `BuildingDefinitionSchema` | G1/G5/G6 | OpenCode | Catalogued footprint, support, entrance and work points match ghost and saved cells | Invalid/overlapping placement returns typed reason with no item debit or occupancy | `docs/v2/evidence/G5/REQ-0017/` | IN_PROGRESS |
| REQ-0018 | Master §7.2–7.4; GDD §4.1 | `BUILDINGS.md`, `ECONOMY.md` | G1/G5 | OpenCode | Construction waits for physically delivered materials and resident work | Interrupted build retains materials/progress; bad restart does not duplicate completion | `docs/v2/evidence/G5/REQ-0018/` | NOT_STARTED |
| REQ-0019 | GDD §5.1–5.5; master §5.2–5.4 | `CONTENT.md`, `SCHEMA.md`, `UI.md`, `ProfessionDefinitionSchema` | G1/G7 | OpenCode | All peaceful school recipes and role permissions are data-driven and visible | Unknown recipe or unauthorized role is rejected before work/progress | `docs/v2/evidence/G7/REQ-0019/` | IN_PROGRESS |
| REQ-0020 | GDD §6.1–6.2; master §8.2–8.3 | `CONTENT.md`, `ECONOMY.md`, `ResearchDefinitionSchema` | G1/G8 | OpenCode | Research pauses without a reachable assigned scientist; equal craft inputs give equal quality | No specialist or incompatible technology pauses/rejects work with no hidden progress | `docs/v2/evidence/G8/REQ-0020/` | IN_PROGRESS |
| REQ-0021 | GDD §13.3; master §8.4 | `API.md`, `ECONOMY.md` | G1/G9 | OpenCode | Royal order consumes existing eligible stock and pays exactly once | Missing/reserved/expired/duplicate stock returns typed refusal with no reward | `docs/v2/evidence/G9/REQ-0021/` | NOT_STARTED |
| REQ-0022 | GDD §15.1–15.2; master §10.1–10.3 | `UI.md`, `PLAY_NOW.md` | G1/G2/G9 | OpenCode | HUD and panels leave the world readable and expose real state/actions | Empty/error states show recoverable guidance without pretending the world saved | `docs/v2/evidence/G2/REQ-0022/` | NOT_STARTED |
| REQ-0023 | GDD §15.4–15.5; master §10.3–10.4 | `UI.md`, `PLAY_NOW.md` | G1/G2/G10 | OpenCode | Action-first onboarding and touch controls work without terminal instructions | `pointercancel`, pinch, safe-area or resize never submits a build unexpectedly | `docs/v2/evidence/G10/REQ-0023/` | NOT_STARTED |
| REQ-0024 | GDD §16.1–16.3; master §10.5 | `CONTENT.md`, `AssetManifestEntrySchema` | G1/G2/G10 | OpenCode | Each V2 asset states style role, scale, pivot and layer behavior | Missing/incorrect projection is reported as `ART_BLOCKER`; do not substitute it as final art | `docs/v2/evidence/G10/REQ-0024/` | IN_PROGRESS |
| REQ-0025 | GDD §17.1–17.3; master §10.5 | `CONTENT.md`, `AssetManifestEntrySchema` | G1/G2/G10 | OpenCode | Landscape, buildings and civilian workers use licensed compatible side-view art | Missing license/file/frame/pivot fails manifest validation and stays visibly blocked | `docs/v2/evidence/G10/REQ-0025/` | IN_PROGRESS |
| REQ-0026 | GDD §19.1–19.3; master §10.5 | `CONTENT.md`, `PeaceAssetManifestSchema` | G1/G10/G11 | OpenCode | Manifest/checker validates source, license, file, dimensions, pivot, frames and animation | Any required invalid asset blocks final-art PASS; retain a playable honest placeholder state | `docs/v2/evidence/G10/REQ-0026/` | IN_PROGRESS |
| REQ-0027 | GDD §20.1–20.4; master §9.1–9.4 | `API.md`, `SCHEMA.md`, `SECURITY.md`, `CommandEnvelopeSchema` | G1/G3/G11 | OpenCode | Server authorizes owner, validates revisions and atomically stores effect plus request result | Stale/replayed/mismatched commands return safe typed outcome and reconcile by same request ID | `docs/v2/evidence/G3/REQ-0027/` | IN_PROGRESS |
| REQ-0028 | GDD §20.5; master §4.3, §9.4, §10.4 | `SECURITY.md`, `ERROR_REGISTRY.md`, `PairingRequestSchema`, `ReadOnlyWorldPreviewSchema` | G0/G1/G2/G11 | OpenCode | Separate loopback handoff and explicit private-bind pairing gate private reads and commands | Mobile browser emulation passes; physical phone, forged-Host/forwarded-header and broader authorization regression evidence remains required | `docs/v2/evidence/G2/REQ-0028/` | IN_PROGRESS |
| REQ-0029 | GDD §20.6; master §9.5, §10.6 | `UI.md`, PWA contract | G1/G10/G11 | OpenCode | Offline view is explicitly read-only and resumes from a versioned server snapshot | Offline commands never alter local economy; incompatible asset updates keep last good version | `docs/v2/evidence/G10/REQ-0029/` | NOT_STARTED |
| REQ-0030 | Master §11.1–11.3; GDD §19.1–19.3 | `PLAN.md`, evidence protocol | G1/G2/G11 | OpenCode | Reports include measured device/profile, N, cache, p50/p95 and artifact SHA where applicable | Unmeasured targets remain proposed; emulation is not reported as a physical-device pass | `docs/v2/evidence/G11/REQ-0030/` | NOT_STARTED |
| REQ-0031 | Master §12 G0–G11; GDD §21.1 | `PLAN.md`, `STATUS.md`, `NEXT_ACTION.md` | G0–G11 | OpenCode | Every sequential gate has named deliverable, evidence and explicit acceptance state | Missing required artifact leaves the gate `IN_PROGRESS`/`BLOCKED`, never PASS | `docs/v2/evidence/G0/REQ-0031/` | IN_PROGRESS |
| REQ-0032 | GDD §21.2; master §13.1 | `TEST_MATRIX.md` | G1/G11 | OpenCode | All 30 `I-E2E-01..30` meanings and stable IDs remain present | Missing/renumbered scenario fails the source-map check and blocks G1 | `docs/v2/evidence/G1/REQ-0032/` | IN_PROGRESS |
| REQ-0033 | GDD §21.3; master §1.2, §12 G11 | `STATUS.md`, release checklist | G1/G11 | OpenCode | Full Stage I release requires complete technical evidence and separate owner acceptance | Missing/P0/P1 evidence blocks auto-QA PASS; owner acceptance remains pending until played | `docs/v2/evidence/G11/REQ-0033/` | NOT_STARTED |
| REQ-0034 | Master §13.1–13.3; GDD §23 | `SECURITY.md`, `AGENT_RUNBOOK.md`, evidence protocol | G0/G1/G11 | OpenCode | Test logs identify V2 database name only; artifacts redact secrets and preserve evidence hashes | V1 DB or secret appears in a test/evidence path: stop and quarantine the artifact before commit | `docs/v2/evidence/G0/REQ-0034/` | IN_PROGRESS |
| REQ-0035 | Master §14–15; GDD §24.1–24.4 | `DECISIONS.md`, `PLAN.md`, `GSTACK_RUNS.md` | G0–G11 | OpenCode | Changes preserve approved scope and record unresolved estimates/decisions with provenance | Conflicting source or missing owner answer is recorded and blocked; never silently expand Stage II | `docs/v2/evidence/G1/REQ-0035/` | IN_PROGRESS |
| REQ-0036 | Master §16–18; GDD §21.3, §23–24 | `STATUS.md`, `NEXT_ACTION.md`, release evidence | G0–G11 | OpenCode | Status gives real SHA, commands, health, safety, player capability and next action | Absent test/URL/device evidence remains NOT_STARTED/BLOCKED, not reported as success | `docs/v2/evidence/G0/REQ-0036/` | IN_PROGRESS |
| REQ-0037 | Master §2.1–2.4; GDD §23 | `AGENT_RUNBOOK.md`, `NEXT_ACTION.md`, `EXECUTION_LOG.md` | G0–G11 | OpenCode | Agent resumes from persisted gate/status and reports commands/evidence without owner terminal work | Interruption leaves a precise safe next action; never claim an unattended/background process continues | `docs/v2/evidence/G0/REQ-0037/` | IN_PROGRESS |

## Requirement-to-test links

| REQ-ID | Test IDs (planned/executable) |
|---|---|
| REQ-0001 | `I-E2E-30` |
| REQ-0002 | `I-E2E-01`, `I-E2E-03`, `I-E2E-23`, `I-E2E-26`, `I-E2E-27`, `V2-PV-01`, `V2-G21-LIVE-01` |
| REQ-0003 | `V2-DBSAFE-01` |
| REQ-0004 | `V2-BASELINE-01`, `V2-RUNBOOK-01` |
| REQ-0005 | `V2-GEOM-01`, `I-E2E-26` |
| REQ-0006 | `I-E2E-10`, `I-E2E-11` |
| REQ-0007 | `I-E2E-04`, `I-E2E-12`, `I-E2E-23`, `V2-GEOM-01`, `V2-G21-LIVE-01` |
| REQ-0008 | `V2-GEOM-01` |
| REQ-0009 | `I-E2E-14`, `I-E2E-23` |
| REQ-0010 | `I-E2E-15` |
| REQ-0011 | `I-E2E-16`, `I-E2E-17`, `I-E2E-18` |
| REQ-0012 | `I-E2E-03`, `I-E2E-06`, `I-E2E-23` |
| REQ-0013 | `V2-CATALOG-01`, `I-E2E-10`, `I-E2E-11` |
| REQ-0014 | `V2-CATALOG-01`, `I-E2E-05`, `I-E2E-06`, `I-E2E-19`, `I-E2E-20`, `I-E2E-21` |
| REQ-0015 | `I-E2E-03`, `I-E2E-04`, `I-E2E-07`, `I-E2E-08`, `I-E2E-09`, `I-E2E-23`, `V2-G21-LIVE-01` |
| REQ-0016 | `I-E2E-22`, `V2-G21-LIVE-01` |
| REQ-0017 | `V2-CATALOG-01`, `I-E2E-12`, `I-E2E-13`, `I-E2E-26`, `V2-REG-02`, `V2-G21-LIVE-01` |
| REQ-0018 | `I-E2E-02`, `I-E2E-03`, `I-E2E-13`, `I-E2E-23`, `V2-REG-03`, `V2-G21-LIVE-01` |
| REQ-0019 | `V2-CATALOG-01`, `I-E2E-16`, `I-E2E-17`, `I-E2E-18` |
| REQ-0020 | `V2-CATALOG-01`, `I-E2E-19`, `I-E2E-20`, `I-E2E-21` |
| REQ-0021 | `I-E2E-24`, `I-E2E-25` |
| REQ-0022 | `I-E2E-26`, `V2-BASELINE-01`, `V2-G21-LIVE-01` |
| REQ-0023 | `I-E2E-26`, `V2-PAIR-01`, `V2-G21-LIVE-01` |
| REQ-0024 | `I-E2E-28`, `V2-ASSET-SCHEMA-01`, `V2-ASSET-01` |
| REQ-0025 | `I-E2E-28`, `V2-ASSET-SCHEMA-01`, `V2-ASSET-01` |
| REQ-0026 | `I-E2E-28`, `I-E2E-29`, `V2-ASSET-SCHEMA-01`, `V2-ASSET-01` |
| REQ-0027 | `I-E2E-25`, `V2-REG-01`, `V2-G21-LIVE-01` |
| REQ-0028 | `V2-PAIR-01`, `V2-REG-01` |
| REQ-0029 | `I-E2E-27`, `I-E2E-29` |
| REQ-0030 | `V2-PERF-01` |
| REQ-0031 | `V2-STATUS-01` |
| REQ-0032 | `I-E2E-01`–`I-E2E-30` |
| REQ-0033 | `I-E2E-30`, `V2-STATUS-01` |
| REQ-0034 | `V2-DBSAFE-01`, `V2-BASELINE-01` |
| REQ-0035 | `V2-STATUS-01` |
| REQ-0036 | `V2-STATUS-01` |
| REQ-0037 | `V2-RUNBOOK-01` |

## Status rationale

Every status below is gate-local. A `PASS` requires the named evidence artifact; a smoke or structural check does not pass gameplay requirements.

| REQ-ID | Current status rationale |
|---|---|
| REQ-0001 | Approved scope and provenance rules are recorded; runtime implementation and all mapped assertions remain pending. |
| REQ-0002 | G2.1 now has a real V2 world, live task loop and persistent build tested in a browser; full G2 owner and physical-phone acceptance remain pending. |
| REQ-0003 | PASS: Separate V2 dev/test DBs are live and verified; prior checksum-verified V1 scratch-restore evidence is linked from G0 and was not repeated here. |
| REQ-0004 | PASS: evidence in `docs/v2/evidence/G0/REQ-0004/` verifies named V2 doctor/start/stop/build/test commands and loopback API/client health against V2 only; G2 gameplay remains separate. |
| REQ-0005 | Signed sector/global transforms have unit tests; renderer 1:1 behavior and world integration remain unimplemented. |
| REQ-0006 | Resource/source and balance contracts are documented; extraction/renewal behavior and evidence are not implemented. |
| REQ-0007 | G2.1 routes the single worker deterministically across the surface and persists its carry route; the general obstacle/support/transport graph remains future work. |
| REQ-0008 | Deterministic generation contract is mapped; generator and seam evidence are not implemented. |
| REQ-0009 | Resident identity schema is specified; persistence and reload behavior are not implemented. |
| REQ-0010 | Housing-capacity contract is mapped; resident arrival/migration behavior is not implemented. |
| REQ-0011 | School recipe counts and ordering are documented; profession catalog and server permissions are not implemented. |
| REQ-0012 | Physical item locations are specified; item/ledger tables and transfer logic are not implemented. |
| REQ-0013 | Versioned catalog schemas validate provenance, unique IDs and references; no full content payload or gameplay consumer exists yet. |
| REQ-0014 | Recipe schema validates inputs, fuel, output, specialist, building and technology references; production chains are not implemented. |
| REQ-0015 | The G2.1 single-log task persists load/carry/unload and was replay/restart checked; multi-item ledger and warehouse reservations remain future work. |
| REQ-0016 | G2.1 advances deterministic 500 ms server ticks and resumes a persisted task after API restart; large-world catch-up budgeting and online/offline equivalence remain open. |
| REQ-0017 | G2.1 authoritatively validates and reserves the exact 2×1 cabin anchor; the full catalog/support/entrance/occupancy system remains open. |
| REQ-0018 | The G2.1 cabin reserves stock and persists worker arrival plus foundation/scaffold/complete progress; material haul to varied building buffers remains open. |
| REQ-0019 | Profession schema validates the school set and operations; the full 23-recipe catalog and runtime qualification checks are not implemented. |
| REQ-0020 | Research schema validates references and rejects prerequisite cycles; server-side researcher gating and deterministic quality are not implemented. |
| REQ-0021 | Royal-order invariants are documented; stock reservation and one-time submission are not implemented. |
| REQ-0022 | G2.1 HUD, scene inspector, build catalog and real task states work in browser; broader resident/service panels remain open. |
| REQ-0023 | Mouse pan/wheel, touch pan/pinch and resize were exercised in desktop/mobile emulation; physical-device and full onboarding remain pending. |
| REQ-0024 | Asset metadata schema exists; actual V2 manifest/side-view roles and art are not complete. |
| REQ-0025 | Civilian asset schema is tested; licensed building/worker files and visual evidence are not complete. |
| REQ-0026 | Manifest metadata schema is tested; file/checksum/atlas validator and final-art evidence are not implemented. |
| REQ-0027 | Authenticated task/build commands, stale revisions, idempotent duplicate replay and persistent effects are exercised; broader command coverage remains open. |
| REQ-0028 | Pairing/read-only-preview schemas and security rules exist; pairing/session routes and adversarial runtime tests are not implemented. |
| REQ-0029 | Read-only offline/PWA behavior is specified; service worker and versioned-cache behavior are not implemented. |
| REQ-0030 | Performance evidence protocol is documented; no V2 measurement or physical-device benchmark exists. |
| REQ-0031 | G0 is PASS, G1 is PASS by user D7-A, G2 is IN_PROGRESS; G2.1 browser evidence exists but owner/physical-phone acceptance remains pending. |
| REQ-0032 | All 30 scenario IDs are present and checked; executable gameplay tests and their evidence are not run. |
| REQ-0033 | Release/owner-acceptance boundary is recorded; no full Stage I release evidence exists. |
| REQ-0034 | V2 DB preflight, live identity and bootstrap evidence exist; full gate artifact redaction/retention verification remains open. |
| REQ-0035 | Current decisions and scope boundaries are recorded; unresolved CEO independent post-fix verification remains open. |
| REQ-0036 | Status and resume records now describe the G2.1 slice; full G2/Stage I acceptance and physical-device evidence remain open. |
| REQ-0037 | Agent/owner runbook and next-action records exist; interruption/resume acceptance has not been exercised. |

## Explicit exclusions

- GDD §§7–12 and 18: military/PvP, combat, injuries, military schools and Stage II art.
- GDD §§13.1–13.2 and 13.4–13.11: player marketplace/trade post; only royal procurement §13.3 is included.
- GDD §14: monetization, crystals, payment and paid accelerations.
- V1 world conversion/mass migration; archive-only side-view migration risks do not become implementation requirements.

## Gate ownership and evidence convention

OpenCode owns implementation and verification. Every closed gate records command, exit code, test count, database name only, assertion/result, source and commit SHA, and required trace/log/screenshot under `docs/v2/evidence/<gate>/<test-id>/`. An absent artifact means `NOT_STARTED`/`BLOCKED`, never PASS.
