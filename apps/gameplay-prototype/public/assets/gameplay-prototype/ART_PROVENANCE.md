# Gameplay prototype asset provenance

- `sawmill.svg` is a new, hand-authored vector illustration for the prototype's
  two-cell sawmill. It uses transparent background, warm timber, an open work
  bay, a log intake, and a visible stack of finished boards. It does not copy or
  modify any Peace V2 source asset.

- `sawmill-construction.png` and `sawmill-operating.png` are generated
  candidates from `assetgen-work/candidates/`, using the owner's authorized
  `codex-imagegen-mcp` route and `apps/client/public/assets/avanpost/sawmill.png`
  as the style reference. They are loaded only by the gameplay prototype. The
  construction image appears on a sawmill site; the operating image appears on
  a completed sawmill. Its gear spokes and sawdust flecks animate in Phaser.
  Both candidates retain transparent backgrounds. The generator left colored
  flecks in open areas around the saw, so manual art review is still required.

- `female-worker-atlas.png` is prepared from the text-only candidate
  `assetgen-work/candidates/female_worker_atlas_20261127.png`, generated with
  Codex image generation without uploading the male atlas. Its 15 poses were
  cropped from a 4×4 grid, fit with preserved proportions into 192×224 cells,
  aligned to the shared feet line at frame row 214, and saved with cell 15
  transparent. It uses separate idle, gathering, walking, carrying, and
  building animations. Residents named Мария, Агата, Лада, and Ярина use it;
  explicit saved gender takes priority and older saves infer it from the name.
  A light red/green fringe remains around some edges, so the art is integrated
  for playtesting but is not marked approved.
