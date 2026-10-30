# Avanpost V2 owner acceptance

This file records owner-reported acceptance. Technical evidence and remaining gate status stay separate in `STATUS.md`, `TEST_MATRIX.md` and `EXECUTION_LOG.md`.

## G4.1 — distributed warehouses and physical hauling

- **Status:** `ACCEPTED`
- **Accepted by:** project owner, 2026-10-30
- **Rollback tag:** `peace-v2-g4.1-accepted`
- **Scope accepted:** two physical warehouses with separate inventories; woodcutter, stone miner, hauler and builder flow; physical cargo movement and construction delivery; saved state across reload; context menus remain open during world synchronization.
- **Balance note:** fixture capacity 16 is test-only, not an approved balance. Migration 0010 is in the versioned code and is not applied to `avanpost_v2_dev`.

G4.1 acceptance does not accept G4.2 or close the broader G4 gate.
