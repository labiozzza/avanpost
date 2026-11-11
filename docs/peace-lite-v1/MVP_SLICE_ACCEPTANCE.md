# Peace Lite V1 — MVP-SLICE acceptance matrix

`PASS` requires evidence on the tested SHA: ordinary UI interactions where required, server/API assertions, database/ledger assertions for persisted economic effects, and retained traces/screenshots where specified. Historical Lite E2E results do not establish these rows. Fixtures may support migration/boundary tests but may not be presented as a fresh-world player run.

**Baseline SHA:** `4353ae5c7ba22f89c0c9f2ea1a684467cb72fb13`
**Current result:** all 16 criteria `NOT_VERIFIED` at baseline.
**Disposable DB:** not yet provisioned; do not run destructive E2E against `avanpost_v2_test`, dev/manual, V1, or historical acceptance databases.

| ID | Scenario / required result | Status | Evidence / next verification |
|---|---|---|---|
| MVP-01 | New guest gets own persistent world; reload restores same world and residents; another guest is isolated. | NOT_VERIFIED | Existing historical LITE-01/02 evidence is prior SHA. Add current-SHA desktop browser + DB identity assertions. |
| MVP-02 | Real wood and stone source work → physical carry → storage/construction; no duplicates; building completes. | NOT_VERIFIED | Legacy V2 tests cover portions, not complete Lite fresh-world path. Verify in browser and ledger DB. |
| MVP-03 | Seven-SKU migration from legacy wood/stone preserves resources, buildings, residents, cargo, tasks, and reservations. | NOT_VERIFIED | Ledger contract tests are not persistence migration proof. Add old-snapshot fixtures and disposable-DB migration/restart assertions. |
| MVP-04 | Build/operate reachable vegetable chain; produce, physically deliver, and store vegetables. | NOT_VERIFIED | No active production path found. Fresh-world UI, server tick, and storage evidence required. |
| MVP-05 | Stop food supply → deterministic shortage/visible consequence → restore supply and recover. | NOT_VERIFIED | No active Lite food-consumption path found. Test cause, effect, and recovery without resident death/soft-lock. |
| MVP-06 | Geological source → metalworks; physically consume wood fuel; produce and haul metal; no hidden SKU. | NOT_VERIFIED | No active metal chain found. Assert every input/output and location transition in ledger. |
| MVP-07 | Unqualified specialized action is denied by server/API; ordinary UI training grants the canonical capability. | NOT_VERIFIED | Historical school tests are not enforcement evidence. Test direct API denial and then UI training/allowed operation. |
| MVP-08 | Researcher receives materials, completes canonical technology over time, effect is measurable server-side and survives reload. | NOT_VERIFIED | Existing legacy research is unrelated. Respect prerequisites for any technology unlocking metalworks. |
| MVP-09 | Accept an achievable order; physically deliver required goods; complete and receive one coin reward. | NOT_VERIFIED | No active royal-order path found. Assert royal-point transfer and wallet transaction. |
| MVP-10 | Retry/concurrent completion cannot duplicate delivered goods or coin reward. | NOT_VERIFIED | Historical LITE-04 covers duplicate build command only. Test order idempotency/retry with two clients and DB. |
| MVP-11 | Full storage, missing worker, or blocked route yields visible concrete reason; removing blocker resumes work. | NOT_VERIFIED | Unit contracts are insufficient. Exercise each blocker and recovery via client + API. |
| MVP-12 | Reload and actual API restart during haul/production/research/order retain exact progress and perform no operation twice. | NOT_VERIFIED | Existing narrower restart tests do not cover the MVP chain. Capture before/after snapshots and DB ledger. |
| MVP-13 | After first order, player receives another achievable goal/order and can continue production. | NOT_VERIFIED | No repeatable order loop found. Verify a second full order, not merely a generated card. |
| MVP-14 | Desktop Chromium plus mobile viewport support all key actions; no blocking UI/console errors. | NOT_VERIFIED | Prior browser checks are not a full MVP route. Record trace/screenshots on the tested SHA. |
| MVP-15 | Guest/world isolation, viewer denial, revoked editor denial, two-editor concurrency/idempotency remain intact. | NOT_VERIFIED | Historical LITE-02/04/05 are earlier SHA. Repeat applicable security flows after gameplay changes. |
| MVP-16 | Ordinary new player completes the entire loop to first reward through UI only; no DevTools/API/SQL/fixture/accelerated ticks. | NOT_VERIFIED | No qualifying end-to-end playthrough exists. Require fresh disposable world, recorded UI trace, DB assertions, time and SHA. |

## Evidence template for each row

Record tested commit SHA; fixture/source snapshot (if any); disposable database name and verified identity; exact command and exit code; ordinary browser actions; server/API assertions; before/after item ledger and idempotency assertions; reload/restart outcome where relevant; screenshot/trace path; reviewer; and status with limitations. For MVP-16, direct API/SQL interaction is forbidden during the player route. Report automated QA separately from owner acceptance.
