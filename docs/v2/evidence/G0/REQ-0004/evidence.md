# REQ-0004 evidence: V2 commands and runtime health

- `npm run doctor:peace:v2` verified Node.js ≥22, free loopback ports 8788/4174, local storage, and connected identity for `avanpost_v2_dev` and `avanpost_v2_test`.
- `npm run dev:peace:v2` started Fastify and the Vite shell on loopback; actual `/api/health` returned `{"status":"ok","api":"peace-v2","database":"avanpost_v2_dev"}`. Playwright verified the shell through port 4174 with API health from `avanpost_v2_test`.
- `npm run dev:peace:v2:stop` returned `status=stopped`; three repeated cycles ended without listeners on 8788/4174. Database stop is separate and preserves the V2 volume.
- Targeted `npm run test:peace:v2`, root `npm run typecheck`, `npm run build`, `npm run e2e:peace:v2`, `npm run check:peace:v2:source-map`, `npm run check:peace:v2:contracts`, and `npm run check:peace:v2:status` passed; see companion records for counts/screenshots.
- V1 `npm run dev`, root `db:*`, and V1 database targets were not used. The G0 Vite shell states that gameplay is not yet available; no gameplay or owner URL is claimed.
- Commit anchor: `87b463a`. Status: PASS for the G0 command/health surface only; G0/G1 gate closure is tracked separately.
