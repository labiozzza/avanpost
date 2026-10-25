# V2-ASSET-SCHEMA-01 evidence

- Command: `npm run test:peace:v2`
- Exit code: 0; full V2 unit suite 43/43. `packages/peace-v2-shared/test/catalog.test.ts` passed 5/5 tests, including asset metadata validation.
- Assertions: accepts a Stage I manifest entry with license/source/hash/pivot/frames; rejects path traversal, out-of-bounds pivot, Stage II entries and duplicate asset IDs.
- Test data is an inline schema fixture, not a real licensed image. No asset file existence, on-disk checksum match, atlas extraction, visual review or physical-device result is claimed.
- Commit anchor: `87b463a`; current source SHA-256:
  - `packages/peace-v2-shared/src/catalog.ts`: `f30717146c74a50e941beb487da0193a52022dd39553c4721e067e1a6d073ec3`
  - `packages/peace-v2-shared/test/catalog.test.ts`: `3e6dbd6f79547d6483ca1b3178e6cc852ff00bb4ca60b03dcd7c4202625d53a9`
- Status: `V2-ASSET-SCHEMA-01` PASS for metadata-schema behavior only; `V2-ASSET-01` remains NOT_STARTED.
