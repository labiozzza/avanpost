# V2-CATALOG-01 evidence

- Command: `npm run test:peace:v2`
- Exit code: 0; full V2 unit suite reported 43/43; `packages/peace-v2-shared/test/catalog.test.ts` passed 5/5.
- Assertions: a linked versioned sample parses; missing provenance, Stage II rows, duplicate IDs, unknown recipe item/technology references, duplicate profession schools and research prerequisite cycles are rejected.
- Fixture/seed/clock/database: none; pure Zod schema validation.
- No claim: real catalog YAML files, balance completeness, runtime loading, production or world-save migration are not implemented.
- Commit anchor `87b463a`; source SHA-256: `packages/peace-v2-shared/src/catalog.ts` `f30717146c74a50e941beb487da0193a52022dd39553c4721e067e1a6d073ec3`; `packages/peace-v2-shared/test/catalog.test.ts` `3e6dbd6f79547d6483ca1b3178e6cc852ff00bb4ca60b03dcd7c4202625d53a9`.
