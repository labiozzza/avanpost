# Avanpost Peace V2 agent runbook

Audience: OpenCode. The project owner is a player and must not receive terminal, environment, database, migration, or infrastructure-debugging steps.

## Current G0 baseline sequence

1. Read `docs/v2/STATUS.md`, `NEXT_ACTION.md`, `PLAN.md`, and `.env.v2.example`. Do not source or print root `.env`.
2. Check Node.js ≥22 and npm, inspect the current branch/status, and preserve all existing worktree files.
3. Copy `.env.v2.example` to the ignored `.env.v2` only if it does not already exist. Keep its two exact database URLs separate; never substitute root/V1 values.
4. Run `npm run check:peace:v2:source-map`, `npm run check:peace:v2:contracts`, `npm run test:peace:v2`, `npm run typecheck`, and `npm run build:peace:v2`. These structure/contract/unit/type/build checks are DB-free.
5. Start only the V2 database with `npm run db:peace:v2:up`. This names `docker-compose.v2.yml`, project `avanpost-peace-v2`, port 5434 and volume `peace_v2_pgdata`; it does not run V1 compose or remove any volume.
6. Run `npm run doctor:peace:v2`. It checks Node.js ≥22, V2 API/client bind ports, loopback handoff port 8789 and local disk, validates both operation-specific URLs before connecting, then verifies dev/test database name, server address/port and socket peer. On any mismatch, stop before migration or reset and report only the stable error code and safe next step.
7. Run `npm run db:peace:v2:migrate` only after the doctor passes. The V2 migrator reads only `db/peace-v2/migrations`, verifies connected identity first, and applies each unapplied checksum-locked migration in its own transaction.
8. For browser E2E, run `npm run e2e:peace:v2`; its dedicated webServer starts V2 Postgres, verifies both DB identities, migrates only `avanpost_v2_test`, and launches the V2 API with the test DB. It never uses root V1 test routes.
9. Run `npm run dev:peace:v2` only after G0 preflight passes. Default binding is loopback; explicit LAN play requires OpenCode to set `AVANPOST_V2_ENABLE_LAN=true` and `AVANPOST_V2_BIND_HOST` to this computer's assigned private IPv4. It starts the LAN Vite client on 4174 plus a second client on `127.0.0.1` at 4175. The LAN client calls the API directly; the localhost client proxies only `/api` to the API's private bind so its HttpOnly cookie stays first-party. Never use a wildcard bind. The separate code-handoff port remains loopback-only. The launcher strips DB credentials from the client process and prints URLs only after readiness; verify the actual target device before owner handoff.
10. Stop only the V2 API/client with `npm run dev:peace:v2:stop`. Stop the isolated V2 database separately with `npm run db:peace:v2:stop` when the active task is finished; this preserves the named volume.

## Forbidden commands/targets

- Do not run V1 `npm run dev`, `dev:client`, `db:up`, `db:down`, `db:migrate`, V1 root E2E, or any reset/truncate against an unknown target.
- Never connect V2 code or tests to databases `avanpost` or `avanpost_test`; never import V1 configuration or migrations.
- Never use `docker compose down -v`, delete a volume, or stop a process unless its V2 ownership is verified.
- The checked local G2 slice is not a complete owner handoff. Do not give the project owner a URL until a live browser check succeeds on the intended device/network; do not call G2 complete until all required flows and security checks pass.
- The G0 client shell exists only to prove the isolated API/UI launcher and safe health route; it does not offer world commands, state mutation, or gameplay.

## Safe recovery and reporting

- DB URL/identity refusal: do not connect/migrate; show stable code, operation and expected DB name, never credentials or raw URL.
- Existing PID belongs to another command: leave it running and preserve the PID file; do not kill by port alone.
- Migration checksum mismatch or transaction error: stop, preserve the DB volume, report migration name and stable error; never edit an applied migration in place.
- Record actual command, exit code, V2 database name only, SHA, tests and evidence in `STATUS.md`/`EXECUTION_LOG.md`. Unknown or absent evidence stays `NOT_STARTED` or `BLOCKED`.

## G2 owner handoff (live personal playtest; physical-phone acceptance pending)

The local slice and explicit private-IPv4 binding path are running at the addresses recorded in `STATUS.md`. The separate loopback handoff remains on the launching computer; the owner can now open the computer and phone URLs, pair manually and play. The browser-emulated private-LAN flow passed, but a physical-phone check is pending and G2 is not accepted. Keep only script-owned services running during play. The owner receives browser-only steps and no terminal instructions.
