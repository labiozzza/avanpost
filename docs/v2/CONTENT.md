# Peace V2 versioned content contract

Status: catalog format in progress; item/balance/catalog data not yet complete.

All items, buildings, recipes, professions, schools, research nodes, world balance and art are versioned data validated by `CatalogVersionSchema`, `PeaceCatalogSchema`, `AssetManifestEntrySchema`, `PeaceAssetManifestSchema`, `parsePeaceCatalog` and `parsePeaceAssetManifest` in `packages/peace-v2-shared`. Invalid catalog/manifest data returns `CATALOG_INVALID`/`ASSET_MANIFEST_INVALID` with safe issue paths, never values/secrets. Every non-GDD numerical choice carries `provenance` (`approved`, `proposed`, or `estimated`), source section, rationale and a balancing test. Content and simulation versions/hashes are stored with each world; an update cannot silently change a saved world's rules.

Planned files include `content/peace-v2/items.yaml`, `buildings.yaml`, `recipes.yaml`, `professions.yaml`, `research.yaml`, `world_balance.yaml`, and `assets/manifest.json`. The validator rejects duplicate IDs, invalid references, missing visual-state keys, impossible recipe graphs, negative quantities and unsupported provenance.

The peaceful catalog contains only Stage I items/buildings/professions/technologies and GDD §13.3 royal orders. PvP, market, military classes and crystals remain absent. Art rows record source, license/provenance, relative path, dimensions, pivot/atlas/frames/animation and checksum. G2.1/G2.2 use temporary project-specific AI-generated art recorded in `apps/client-v2/public/assets/peace-v2/manifest.json`, including a distant noninteractive panorama; it is not a third-party pack or final-art pass. All harvestable trees still come from authoritative server resource nodes. Final art remains a G10/G11 requirement.
