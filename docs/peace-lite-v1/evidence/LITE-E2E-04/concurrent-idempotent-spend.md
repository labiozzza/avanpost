# LITE-E2E-04 concurrent command evidence

- Environment: isolated disposable PostgreSQL `avanpost_v2_lite_test_20261107`; migrations through `0019`; real Chromium tabs at separate cookie hosts.
- Actors: two distinct account sessions, both `editor`, both members of the same world.
- Before action: shared world had 30 wood and no cabin at `(10, -1)`; placement validation returned `READY`.
- Action: both sessions submitted the same valid `build-cabin` payload concurrently with the same world-scoped `requestId` and expected versions.
- Responses: both HTTP 200 with the identical committed world/geometry version and 27 wood.
- Database/state: exactly one `peace_v2_lite_world_commands` row for that request ID; exactly one cabin at `(10, -1)`. The following simulation tick produced one additional wood, so the subsequent DB snapshot contained 28 wood. Browser reload showed two completed cabins in the shared world.
- Console: no browser errors during the reload evidence run.
- Artifacts: `two-editors-single-cabin.jpeg`, `two-editors-shared-world-reload-trace.json.gz`.

This validates duplicate concurrent delivery/idempotent replay across two editor accounts and confirms only one cabin's material cost was charged. It does not prove correctness for two distinct, different request IDs racing on stale versions; that remains additional concurrency coverage rather than a claim in this case.
