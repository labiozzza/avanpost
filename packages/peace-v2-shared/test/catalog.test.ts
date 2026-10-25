import { describe, expect, it } from 'vitest';
import {
  AssetManifestEntrySchema,
  AssetManifestValidationError,
  CatalogValidationError,
  PeaceAssetManifestSchema,
  PeaceCatalogSchema,
  parsePeaceCatalog,
  parsePeaceAssetManifest,
  type PeaceCatalog
} from '../src/index.js';

const catalog: PeaceCatalog = {
  catalogVersion: { version: '1.0.0', sha256: 'a'.repeat(64) },
  items: [
    {
      id: 'wood',
      stage: 'I',
      name: 'Wood',
      unit: 'piece',
      volumePerUnit: 1,
      compatibleStorage: ['timber'],
      provenance: 'proposed',
      sourceSection: 'GDD §3.2',
      rationale: 'Catalog fixture for schema validation only.'
    }
  ],
  buildings: [
    {
      id: 'carpentry',
      stage: 'I',
      name: 'Carpentry',
      category: 'craft',
      footprint: [{ x: 0, y: 0 }],
      supportMask: [{ x: 0, y: 0 }],
      walkThroughMask: [],
      entrances: [{ x: 0, y: 0 }],
      workPoints: [{ x: 0, y: 0 }],
      allowedOperations: ['craft'],
      levels: [{
        level: 1,
        materials: [{ itemId: 'wood', quantity: 1 }],
        buildSeconds: 1,
        maxWorkers: 1,
        inputBufferVolume: 1,
        outputBufferVolume: 1,
        throughputBonus: 0,
        technologyId: null,
        visualStateKeys: ['complete']
      }],
      demolitionYield: [],
      provenance: 'proposed',
      sourceSection: 'GDD §4.2',
      rationale: 'Catalog fixture for schema validation only.'
    },
    {
      id: 'academy',
      stage: 'I',
      name: 'Academy',
      category: 'science',
      footprint: [{ x: 0, y: 0 }],
      supportMask: [{ x: 0, y: 0 }],
      walkThroughMask: [],
      entrances: [{ x: 0, y: 0 }],
      workPoints: [{ x: 0, y: 0 }],
      allowedOperations: ['research'],
      levels: [{
        level: 1,
        materials: [],
        buildSeconds: 1,
        maxWorkers: 1,
        inputBufferVolume: 0,
        outputBufferVolume: 0,
        throughputBonus: 0,
        technologyId: null,
        visualStateKeys: ['complete']
      }],
      demolitionYield: [],
      provenance: 'proposed',
      sourceSection: 'GDD §4.2',
      rationale: 'Catalog fixture for schema validation only.'
    }
  ],
  recipes: [{
    id: 'boards',
    stage: 'I',
    inputs: [{ itemId: 'wood', quantity: 1 }],
    fuelInputs: [],
    outputs: [{ itemId: 'wood', quantity: 1 }],
    workSeconds: 1,
    requiredProfessionId: null,
    buildingId: 'carpentry',
    buildingLevel: 1,
    requiredTechnologyId: null,
    provenance: 'proposed',
    sourceSection: 'GDD §3.3',
    rationale: 'Catalog fixture for schema validation only.'
  }],
  professions: [{
    id: 'researcher',
    stage: 'I',
    name: 'Researcher',
    schools: ['science'],
    allowedOperations: ['research'],
    visualStateKeys: ['study'],
    provenance: 'proposed',
    sourceSection: 'GDD §5.2',
    rationale: 'Catalog fixture for schema validation only.'
  }],
  research: [{
    id: 'basic_tech',
    stage: 'I',
    name: 'Basic technology',
    prerequisites: [],
    requiredProfessionId: 'researcher',
    buildingId: 'academy',
    unlocks: ['basic_building'],
    provenance: 'proposed',
    sourceSection: 'GDD §6.1',
    rationale: 'Catalog fixture for schema validation only.'
  }]
};

describe('versioned peaceful content schema', () => {
  it('accepts a complete linked catalog without assigning default gameplay balances', () => {
    expect(PeaceCatalogSchema.safeParse(catalog).success).toBe(true);
    expect(parsePeaceCatalog(catalog).catalogVersion.version).toBe('1.0.0');
  });

  it('rejects missing provenance, duplicate IDs, unknown recipe items and repeated schools', () => {
    const missingProvenance = structuredClone(catalog);
    delete (missingProvenance.items[0] as Partial<PeaceCatalog['items'][number]>).provenance;
    expect(PeaceCatalogSchema.safeParse(missingProvenance).success).toBe(false);

    const duplicateItems = structuredClone(catalog);
    duplicateItems.items.push({ ...duplicateItems.items[0]! });
    expect(PeaceCatalogSchema.safeParse(duplicateItems).success).toBe(false);

    const missingRecipeItem = structuredClone(catalog);
    missingRecipeItem.recipes[0]!.inputs[0]!.itemId = 'missing_item';
    expect(PeaceCatalogSchema.safeParse(missingRecipeItem).success).toBe(false);

    const missingTechnology = structuredClone(catalog);
    missingTechnology.buildings[0]!.levels[0]!.technologyId = 'missing_technology';
    expect(PeaceCatalogSchema.safeParse(missingTechnology).success).toBe(false);
    expect(() => parsePeaceCatalog(missingTechnology)).toThrowError(
      expect.objectContaining({ code: 'CATALOG_INVALID' })
    );

    const repeatedSchool = structuredClone(catalog);
    repeatedSchool.professions[0]!.schools = ['science', 'science'];
    expect(PeaceCatalogSchema.safeParse(repeatedSchool).success).toBe(false);
  });

  it('rejects technology prerequisite cycles', () => {
    const cyclic = structuredClone(catalog);
    cyclic.research = [
      { ...cyclic.research[0]!, id: 'tech_a', prerequisites: ['tech_b'] },
      { ...cyclic.research[0]!, id: 'tech_b', prerequisites: ['tech_a'] }
    ];
    expect(PeaceCatalogSchema.safeParse(cyclic).success).toBe(false);
  });

  it('rejects Stage II catalog rows from the peaceful Stage I content contract', () => {
    const stageTwo = {
      ...catalog,
      items: [{ ...catalog.items[0], stage: 'II' }]
    };
    expect(PeaceCatalogSchema.safeParse(stageTwo).success).toBe(false);
  });

  it('validates licensed Stage I asset metadata and rejects traversal/stage-II pivots', () => {
    const asset = {
      id: 'worker_idle',
      stage: 'I',
      group: 'civilian',
      role: 'worker_idle',
      source: 'Kenney',
      license: 'CC0',
      relativePath: 'apps/client-v2/public/assets/peace-v2/worker_idle.png',
      width: 64,
      height: 96,
      scale: 1,
      pivot: { x: 32, y: 88 },
      atlasPath: null,
      frameCount: 1,
      fps: null,
      animationStates: ['idle'],
      sha256: 'b'.repeat(64),
      quality: 'placeholder'
    };
    expect(AssetManifestEntrySchema.safeParse(asset).success).toBe(true);
    expect(parsePeaceAssetManifest({ version: '1.0.0', entries: [asset] }).entries).toHaveLength(1);
    expect(AssetManifestEntrySchema.safeParse({ ...asset, relativePath: '../V1/actor.png' }).success).toBe(false);
    expect(AssetManifestEntrySchema.safeParse({ ...asset, pivot: { x: 65, y: 88 } }).success).toBe(false);
    expect(AssetManifestEntrySchema.safeParse({ ...asset, stage: 'II' }).success).toBe(false);
    expect(PeaceAssetManifestSchema.safeParse({ version: '1.0.0', entries: [asset, asset] }).success).toBe(false);
    expect(() => parsePeaceAssetManifest({ version: '1.0.0', entries: [{ ...asset, relativePath: '../V1.png' }] }))
      .toThrowError(AssetManifestValidationError);
  });
});
