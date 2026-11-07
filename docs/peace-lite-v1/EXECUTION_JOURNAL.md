# Peace Lite V1 execution journal

## 2026-11-07 — L1 baseline and work start

- Read the full Peace Lite V1 specification (§1–17), task instructions, README, and the bundled historical GDD. The Lite document explicitly preserves the staged peaceful-first / later-PvP product direction while defining its own V1 scope.
- Confirmed the isolated worktree is on `feat/peace-lite-v1`, clean at `c51eb4fad5e2401ecea750e677dd1d1ec865fb3e`; the parent is the pinned Peace V2 commit.
- Static code inspection found the L1 blockers recorded in `IMPLEMENTATION_STATUS.md`: singleton world identifier, pairing-only sessions with no account binding, no membership model, globally scoped command idempotency, and a singleton simulation loop.
- Added `0016_lite_multiplayer_identity.sql` with additive account, world, membership, hashed-session, email identity/link, invite, per-world command-idempotency, and tick-lease tables. It leaves all existing V2 tables and rows unchanged.
- Added `createInitialPeaceWorld(worldSeed)` as a deterministic, validated world factory so future account provisioning does not clone a player's live `peace-home` state. Added a unit test for validation and distinct seeds.
- Added a migration schema contract test. It is a static contract test only; it does not substitute for executing the migration against PostgreSQL.
- Added `lite-identity.ts`: guest/account/world/owner membership/world-state/session creation is one transaction, session tokens are stored only as SHA-256 hashes, session resolution is membership-scoped, and the initial world is not copied from the legacy singleton.
- Added `/api/auth/guest` and `/api/me`; existing V2 world reads and commands resolve the guest's world from its cookie. Lite command idempotency is keyed by `(world_id, request_id)` and records the acting account. Viewer memberships are denied command mutations.
- The simulation tick path can address a world ID and the periodic worker includes active Lite worlds. Territory ownership now follows `worldSeed`, preventing new worlds from inheriting the legacy `peace-home` owner identifier.
- Session resolution updates `last_seen_at`; the timer only polls worlds with a live session seen within the last 10 seconds and caps each query at 100 worlds. Database row locks still serialize state updates; the new tick-lease table is not yet used.
- Updated the V2 client to create a guest session automatically and hide the old pairing-code panel from the user flow.
- Added a fake-database HTTP test proving two guest logins return distinct account/world IDs and load distinct world seeds. This is a unit/API test double, not a PostgreSQL or browser acceptance run.
- First test invocation used root `npm test -- --run ...`; that root config excludes `apps/server-v2` and returned “No test files found”. Corrected by using the V2 Vitest config: targeted tests passed (2 files, 3 tests).
- Checks after L1 changes: `npm run test:peace:v2` passed (27 files, 261 passed, 1 skipped); `npm run typecheck` passed; `npm run build:peace:v2` passed with the existing Vite large-chunk advisory; `git diff --check` passed.
- Browser/real-PostgreSQL validation is still pending. `TEST_DATABASE_URL` and `DATABASE_URL` are unset in this worktree; no local PostgreSQL server is listening on port 5434. No existing or disposable database has been accessed.
- gstack engineering-plan review and QA were authorized. QA scope must remain limited to disposable local environments and never touch existing V2 acceptance/manual/development databases.
