# Avanpost V2 owner acceptance

This file records owner-reported acceptance. Technical evidence and remaining gate status stay separate in `STATUS.md`, `TEST_MATRIX.md` and `EXECUTION_LOG.md`.

## G4.1 — distributed warehouses and physical hauling

- **Status:** `ACCEPTED`
- **Accepted by:** project owner, 2026-10-30
- **Rollback tag:** `peace-v2-g4.1-accepted`
- **Scope accepted:** two physical warehouses with separate inventories; woodcutter, stone miner, hauler and builder flow; physical cargo movement and construction delivery; saved state across reload; context menus remain open during world synchronization.
- **Balance note:** fixture capacity 16 is test-only, not an approved balance. Migration 0010 is in the versioned code and is not applied to `avanpost_v2_dev`.

G4.1 acceptance does not accept G4.2 or close the broader G4 gate.

## G4.2 — smart settlement logistics

- **Status:** `ACCEPTED`
- **Accepted by:** project owner, 2026-10-30
- **Rollback tag:** `peace-v2-g4.2-accepted`
- **Owner report:** manually playtested G4.2 and found no blocking issues. No per-case manual result matrix was provided.
- **Scope accepted:** centralized server-owned logistics queue, priority dispatch, multiple haulers with split capacity reservations, blocked/waiting reasons, loaded-cargo recovery, and Phaser logistics/status cards.
- **Technical verification:** root typecheck; Peace V2 tests 140/140; Peace V2 build; source-map/contracts/status checks; targeted G4.2 scenario E2E (desktop passed; mobile skipped); localhost pairing regression E2E passed.
- **Isolation:** migrations 0011/0012 applied to test/manual only; `avanpost_v2_dev` remains schema 7 and was not queried, migrated, or reset.

G4.2 acceptance does not accept G5.1 or close the broader G4 gate.
