# V2-GEOM-01 partial evidence

- Command: `npm run test:peace:v2`
- Exit code: 0; the V2 suite reported 38/38, including 8 passing assertions in `packages/peace-v2-sim/test/coordinates.test.ts`.
- Contract evidence: signed global coordinates round-trip through 128-cell sectors for negative, zero and positive values; negative boundary ownership uses floor division; unsafe integers, invalid sector size and out-of-sector local coordinates are rejected.
- Database/fixture/clock: none; pure unit tests only.
- No claim: sector terrain generation, deterministic cross-sector seams, support, pathfinding or 1:1 renderer transforms are not implemented or verified. Requirement remains `IN_PROGRESS`.
- Commit anchor: `87b463a`; current source SHA-256 values are listed below because these V2 files are uncommitted.
  - `packages/peace-v2-sim/src/coordinates.ts`: `29238ec74f768ff31abb22bf0c46f283962705a63a3f8a8860b6a2d9c353af93`
  - `packages/peace-v2-sim/test/coordinates.test.ts`: `1616c42330bec9ce3ce837c7ba47fd23e5e90a58acae5da82086ffab66e1175f`
