# REQ-0003 evidence: V1/V2 data boundary

- V2 resources created by `npm run db:peace:v2:up`: Compose project/network `avanpost-peace-v2`, service `peace-v2-postgres`, loopback-only host port 5434, named volume `avanpost-peace-v2_peace_v2_pgdata`.
- `npm run doctor:peace:v2` connected to and verified exactly `avanpost_v2_dev` and `avanpost_v2_test`; bootstrap migrations ran only through the V2 migrator against these targets.
- `V2-DBSAFE-01` unit regressions reject `avanpost`, `avanpost_test`, remote aliases/hosts, wrong/missing ports, URL host overrides and connected-identity/socket mismatches. No connection attempt to either V1 database occurred in this task.
- Prior V1 safety evidence: `docs/reports/stage-1-backup-restore-20261023.md` records a checksum-verified restore into `avanpost_restore_check_20261023_1400` and parity for 22 tables at the same source commit; it was reused, not rerun.
- V1 application/config/migration files and V1 Compose/volume were not changed or used. Root build only compiled V1 workspaces; no V1 migration, test, server or database command was run.
- Result: PASS for V1/V2 isolation at G0. This does not claim G1 acceptance or playable gameplay.
