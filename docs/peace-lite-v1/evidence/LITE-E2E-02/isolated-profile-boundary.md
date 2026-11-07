# LITE-E2E-02 isolated-context evidence

- Environment: disposable PostgreSQL `avanpost_v2_lite_test_20261107` (migrations through `0019`) and the real Chromium browser.
- Browser contexts: `peace-lite-profile-a` and `peace-lite-profile-b`, created as distinct isolated contexts, not merely different tabs/cookie hosts.
- Independent auto-provisioning:
  - Profile A account `4c7e90b9-11e1-40c9-b983-671faf8e9002`, world `f4da882b-f078-491d-a7bb-b68440cd4489`, owner, world version 1.
  - Profile B account `3ce6ad29-e311-421f-afb7-ed9ba464baec`, world `94b6bcc2-a24d-420f-8ae9-391e0955b770`, owner, world version 1.
  - Each `/api/worlds` response contained only that profile's own world; database rows show each world owned by its respective account and only that active owner membership.
- Foreign reads: `/api/world?worldId=<other-world>` returned HTTP 200 but returned the caller's own world snapshot, never the foreign world. `/api/worlds/<foreign-world>/members` and `/select` each returned 403.
- Foreign writes: both contexts submitted a valid `set-work-role` command while supplying the other world ID as a forged query parameter. Responses were HTTP 200 and identified only the caller's own world. Database ledger rows:
  - `isolated-profile-foreign-write-1-20261107` exists once under Profile A's own world.
  - `isolated-profile-foreign-write-2-20261107` exists once under Profile B's own world.
  - No row for either request exists under the other profile's world.
- Conclusion: independent Chromium-context isolation and server-side world scoping are proven. This is not a physical-device or production deployment test.
