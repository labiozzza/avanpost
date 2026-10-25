# REQ-0005 partial evidence

- Linked regression: `V2-GEOM-01`, `docs/v2/evidence/G1/V2-GEOM-01/coordinates-unit.md`.
- Verified assertion: signed global/sector coordinate round-trip and rejection of unsafe/local-range values pass in pure unit tests.
- Remaining contract: prove the renderer's 1:1 world/screen transform and integrate transforms with deterministic sector generation before marking this requirement PASS.
- Current status: `IN_PROGRESS`; evidence is partial by design.
