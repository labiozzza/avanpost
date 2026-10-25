# V2-RUNBOOK-01 evidence

- Runbook commands exercised: `npm run db:peace:v2:up`, `npm run doctor:peace:v2`, `npm run db:peace:v2:test:migrate`, `npm run dev:peace:v2`, `npm run dev:peace:v2:stop`, and `npm run db:peace:v2:migrate`.
- Doctor output confirmed `avanpost_v2_dev` and `avanpost_v2_test`, approved local mode, Node.js/ports and available local storage.
- `npm run e2e:peace:v2` passed 2/2 on desktop and mobile emulation using `avanpost_v2_test`; the client was loopback-only and reported a non-gameplay G0 shell.
- Three consecutive direct start/stop cycles returned API health HTTP 200, then `{"status":"stopped","process":"peace-v2-api"}`; each ended with no listeners on ports 8788 or 4174. The DB container remains running and its volume is preserved.
- One earlier redirected start attempt did not produce a client URL within 15 seconds; its logs were suppressed, so its direct cause was not captured. It preceded the stop-budget correction. The corrected launcher then passed three consecutive visible start/stop cycles plus the Playwright runbook path with no leftover processes or listeners.
- Result: PASS for the scripted G0 environment/database/API/client startup and owned-process recovery sequence on the isolated V2 database. The repo source files are uncommitted/untracked; this does not claim a clean Git clone install test.
- No V1 command, V1 database connection, production target, or owner terminal action was used.
