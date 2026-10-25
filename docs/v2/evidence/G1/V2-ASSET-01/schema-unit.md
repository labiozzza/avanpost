# V2-ASSET-01 partial evidence

- Command: `npm run test:peace:v2`
- Exit code: 0; the full V2 unit suite reported 42/42, including 4 catalog-contract tests in `packages/peace-v2-shared/test/catalog.test.ts`.
- Validated metadata: Stage I role/group, source/license, relative path, dimensions, pivot, frame count, animation states and SHA-256 shape.
- Negative checks: path traversal, out-of-bounds pivot, Stage II entry and duplicate manifest IDs are rejected.
- Commit anchor: `87b463a`; test/schema files are uncommitted, so implementation and test source are referenced by their current paths.
- No asset file existence/checksum comparison, visual review, licensed asset pack, atlas extraction or physical-device verification is claimed. `V2-ASSET-01` remains `IN_PROGRESS`.
