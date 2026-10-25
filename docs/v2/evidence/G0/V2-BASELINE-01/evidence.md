# V2-BASELINE-01 evidence

- Command: `npm run e2e:peace:v2`
- Exit code: 0
- Tests: 2 passed across `peace-v2-desktop` (1440×900) and `peace-v2-mobile` (Pixel 7 emulation)
- Source section: G0 safe launcher / UI baseline (`PLAN.md` G0 and `TEST_MATRIX.md` V2-BASELINE-01).
- Data target: `127.0.0.1:5434/avanpost_v2_test`; Playwright startup ran the V2-only doctor and test migration before launching API/client.
- API assertion: proxied `GET /api/health` returned HTTP 200, `status=ok`, `api=peace-v2`, `database=avanpost_v2_test`.
- UI assertion: baseline shell truthfully states the side-view game arrives in G2; health button displays only environment status.
- Rejected wrong result: V1 database/API identity or a UI claim that this G0 shell is gameplay. `no_claim`: no game world, owner session, LAN reachability or gameplay mutation is proven.
- Browser screenshots and per-project source hashes: `peace-v2-desktop.png/.json`, `peace-v2-mobile.png/.json`.
- Owned-process stop: started `npm run dev:peace:v2`, fetched API health successfully, then `npm run dev:peace:v2:stop` returned `{"status":"stopped","process":"peace-v2-api"}`; `lsof -nP -iTCP:8788 -iTCP:4174 -sTCP:LISTEN` returned no listeners.
- Fixture/seed/clock: none; this check has no world fixture and performs no mutation.
- Commit anchor: `87b463a`; source SHA-256 values are recorded per browser run in the JSON artifacts because implementation files are uncommitted/untracked at this point.
- No game world, owner session, gameplay mutation, V1 API or V1 database was used. This is a G0 launcher smoke test, not playable-game acceptance.
