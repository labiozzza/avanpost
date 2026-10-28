# Peace V2 placeholder art provenance

The G2.1 sprites and G2.2 distant panorama are temporary project art. The walk, loaded-walk and construction sprite strips were generated for Avanpost with the authenticated `gpt_imagegen` workflow on 2026-10-25; the prompts used the V2 woodcutter reference to preserve the character identity. The panorama contains only distant low-contrast skyline/hills and has no gameplay interaction or collectible resources. They contain no third-party pack or traced source. Their source sheets and normalized atlas are checked by `manifest.json` SHA-256 values.

The idle/chop poses and house, storehouse, tree and stump are existing project-specific `gpt_imagegen` outputs copied into the V2 asset directory. Their source records are in `assetgen-work/manifest.json` and `assetgen-work/requests/`. G3.3 adds `stone-outcrop.png` and `workshop.png`, generated on 2026-10-27 against the existing house reference to match the warm side-view art style. They are temporary G3.3 placeholders and are registered by checksum in `manifest.json`. No V1 runtime, configuration or world data is imported; the copied files in the V1 directory were not changed.

License note: these are AI-generated project placeholders, not Kenney assets and not represented as CC0 or as a third-party licensed pack. Their use follows the image-generation provider terms in effect when generated. Replace them with reviewed final-art assets before G10/G11; this temporary atlas does not satisfy final-art acceptance.

Regenerate the shared-pivot Phaser atlas after replacing source poses with:

```sh
python3 scripts/build-peace-v2-worker-atlas.py
```

That optional authoring script requires Pillow. The browser build uses the committed `worker-atlas.png` and does not require Python or Pillow.
