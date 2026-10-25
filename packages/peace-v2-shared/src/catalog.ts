import { z } from 'zod';

export const CatalogEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  stage: z.literal('I'),
  provenance: z.enum(['approved', 'proposed', 'estimated']),
  sourceSection: z.string().min(1),
  rationale: z.string().min(1)
}).strict();
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export const CatalogVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export type CatalogVersion = z.infer<typeof CatalogVersionSchema>;

export const ItemDefinitionSchema = CatalogEntrySchema.extend({
  name: z.string().min(1),
  unit: z.string().min(1),
  volumePerUnit: z.number().int().safe().positive(),
  compatibleStorage: z.array(z.string().min(1))
}).strict();
export type ItemDefinition = z.infer<typeof ItemDefinitionSchema>;

export const LocalCellSchema = z.object({
  x: z.number().int().safe().nonnegative(),
  y: z.number().int().safe().nonnegative()
}).strict();

const QuantitySchema = z.object({
  itemId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  quantity: z.number().int().safe().positive()
}).strict();

export const BuildingLevelSchema = z.object({
  level: z.number().int().safe().positive(),
  materials: z.array(QuantitySchema),
  buildSeconds: z.number().int().safe().positive(),
  maxWorkers: z.number().int().safe().nonnegative(),
  inputBufferVolume: z.number().int().safe().nonnegative(),
  outputBufferVolume: z.number().int().safe().nonnegative(),
  throughputBonus: z.number().safe().nonnegative(),
  technologyId: z.string().regex(/^[a-z][a-z0-9_]*$/).nullable(),
  visualStateKeys: z.array(z.string().min(1)).min(1)
}).strict();

export const BuildingDefinitionSchema = CatalogEntrySchema.extend({
  name: z.string().min(1),
  category: z.string().min(1),
  footprint: z.array(LocalCellSchema).min(1),
  supportMask: z.array(LocalCellSchema),
  walkThroughMask: z.array(LocalCellSchema),
  entrances: z.array(LocalCellSchema),
  workPoints: z.array(LocalCellSchema),
  allowedOperations: z.array(z.string().min(1)),
  levels: z.array(BuildingLevelSchema).min(1),
  demolitionYield: z.array(QuantitySchema)
}).strict();
export type BuildingDefinition = z.infer<typeof BuildingDefinitionSchema>;

export const RecipeDefinitionSchema = CatalogEntrySchema.extend({
  inputs: z.array(QuantitySchema).min(1),
  fuelInputs: z.array(QuantitySchema),
  outputs: z.array(QuantitySchema).min(1),
  workSeconds: z.number().int().safe().positive(),
  requiredProfessionId: z.string().regex(/^[a-z][a-z0-9_]*$/).nullable(),
  buildingId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  buildingLevel: z.number().int().safe().positive(),
  requiredTechnologyId: z.string().regex(/^[a-z][a-z0-9_]*$/).nullable()
}).strict();
export type RecipeDefinition = z.infer<typeof RecipeDefinitionSchema>;

export const ProfessionDefinitionSchema = CatalogEntrySchema.extend({
  name: z.string().min(1),
  schools: z.array(z.enum(['mining', 'craft', 'logistics', 'science'])).min(1).max(3),
  allowedOperations: z.array(z.string().min(1)).min(1),
  visualStateKeys: z.array(z.string().min(1)).min(1)
}).strict().superRefine((profession, context) => {
  if (new Set(profession.schools).size !== profession.schools.length) {
    context.addIssue({ code: 'custom', path: ['schools'], message: 'Training recipe cannot repeat a school.' });
  }
});
export type ProfessionDefinition = z.infer<typeof ProfessionDefinitionSchema>;

export const ResearchDefinitionSchema = CatalogEntrySchema.extend({
  name: z.string().min(1),
  prerequisites: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)),
  requiredProfessionId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  buildingId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  unlocks: z.array(z.string().min(1))
}).strict();
export type ResearchDefinition = z.infer<typeof ResearchDefinitionSchema>;

export const PeaceCatalogSchema = z.object({
  catalogVersion: CatalogVersionSchema,
  items: z.array(ItemDefinitionSchema),
  buildings: z.array(BuildingDefinitionSchema),
  recipes: z.array(RecipeDefinitionSchema),
  professions: z.array(ProfessionDefinitionSchema),
  research: z.array(ResearchDefinitionSchema)
}).strict().superRefine((catalog, context) => {
  const collections = [
    ['items', catalog.items],
    ['buildings', catalog.buildings],
    ['recipes', catalog.recipes],
    ['professions', catalog.professions],
    ['research', catalog.research]
  ] as const;
  for (const [name, entries] of collections) {
    const ids = new Set<string>();
    entries.forEach((entry, index) => {
      if (ids.has(entry.id)) {
        context.addIssue({ code: 'custom', path: [name, index, 'id'], message: `Duplicate ${name} catalog id.` });
      }
      ids.add(entry.id);
    });
  }

  const itemIds = new Set(catalog.items.map((item) => item.id));
  const buildingIds = new Set(catalog.buildings.map((building) => building.id));
  const professionIds = new Set(catalog.professions.map((profession) => profession.id));
  const researchIds = new Set(catalog.research.map((research) => research.id));
  const checkQuantities = (entries: Array<{ itemId: string }>, path: Array<string | number>) => {
    entries.forEach((entry, index) => {
      if (!itemIds.has(entry.itemId)) {
        context.addIssue({ code: 'custom', path: [...path, index, 'itemId'], message: 'Unknown catalog item.' });
      }
    });
  };

  catalog.buildings.forEach((building, index) => {
    const occupied = new Set<string>();
    building.footprint.forEach((cell, cellIndex) => {
      const key = `${cell.x},${cell.y}`;
      if (occupied.has(key)) {
        context.addIssue({ code: 'custom', path: ['buildings', index, 'footprint', cellIndex], message: 'Duplicate footprint cell.' });
      }
      occupied.add(key);
    });
    building.levels.forEach((level, levelIndex) => {
      checkQuantities(level.materials, ['buildings', index, 'levels', levelIndex, 'materials']);
      if (level.technologyId && !researchIds.has(level.technologyId)) {
        context.addIssue({
          code: 'custom',
          path: ['buildings', index, 'levels', levelIndex, 'technologyId'],
          message: 'Unknown building technology gate.'
        });
      }
    });
    if (new Set(building.levels.map((level) => level.level)).size !== building.levels.length) {
      context.addIssue({ code: 'custom', path: ['buildings', index, 'levels'], message: 'Building levels must have unique numbers.' });
    }
    checkQuantities(building.demolitionYield, ['buildings', index, 'demolitionYield']);
  });

  catalog.recipes.forEach((recipe, index) => {
    if (!buildingIds.has(recipe.buildingId)) {
      context.addIssue({ code: 'custom', path: ['recipes', index, 'buildingId'], message: 'Unknown recipe building.' });
    }
    if (recipe.requiredProfessionId && !professionIds.has(recipe.requiredProfessionId)) {
      context.addIssue({ code: 'custom', path: ['recipes', index, 'requiredProfessionId'], message: 'Unknown recipe profession.' });
    }
    if (recipe.requiredTechnologyId && !researchIds.has(recipe.requiredTechnologyId)) {
      context.addIssue({ code: 'custom', path: ['recipes', index, 'requiredTechnologyId'], message: 'Unknown recipe technology.' });
    }
    checkQuantities(recipe.inputs, ['recipes', index, 'inputs']);
    checkQuantities(recipe.fuelInputs, ['recipes', index, 'fuelInputs']);
    checkQuantities(recipe.outputs, ['recipes', index, 'outputs']);
  });

  catalog.research.forEach((research, index) => {
    if (!buildingIds.has(research.buildingId)) {
      context.addIssue({ code: 'custom', path: ['research', index, 'buildingId'], message: 'Unknown research building.' });
    }
    if (!professionIds.has(research.requiredProfessionId)) {
      context.addIssue({ code: 'custom', path: ['research', index, 'requiredProfessionId'], message: 'Unknown research profession.' });
    }
    research.prerequisites.forEach((prerequisite, prerequisiteIndex) => {
      if (!researchIds.has(prerequisite)) {
        context.addIssue({ code: 'custom', path: ['research', index, 'prerequisites', prerequisiteIndex], message: 'Unknown research prerequisite.' });
      }
    });
  });

  const researchById = new Map(catalog.research.map((research) => [research.id, research]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    const node = researchById.get(id);
    for (const prerequisite of node?.prerequisites ?? []) {
      if (researchById.has(prerequisite) && !visit(prerequisite)) return false;
    }
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  for (const research of catalog.research) {
    if (!visit(research.id)) {
      context.addIssue({ code: 'custom', path: ['research'], message: 'Research prerequisites must form a directed acyclic graph.' });
      break;
    }
  }
});
export type PeaceCatalog = z.infer<typeof PeaceCatalogSchema>;

const RelativeAssetPathSchema = z.string().min(1).refine(
  (value) => !value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..'),
  'Asset path must be a normalized project-relative path.'
);

export const AssetManifestEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  stage: z.literal('I'),
  group: z.string().min(1),
  role: z.string().min(1),
  source: z.string().min(1),
  license: z.string().min(1),
  relativePath: RelativeAssetPathSchema,
  width: z.number().int().safe().positive(),
  height: z.number().int().safe().positive(),
  scale: z.number().finite().positive(),
  pivot: z.object({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() }).strict(),
  atlasPath: RelativeAssetPathSchema.nullable(),
  frameCount: z.number().int().safe().positive(),
  fps: z.number().finite().positive().nullable(),
  animationStates: z.array(z.string().min(1)).min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  quality: z.enum(['placeholder', 'final', 'art_blocker'])
}).strict().superRefine((asset, context) => {
  if (asset.pivot.x > asset.width || asset.pivot.y > asset.height) {
    context.addIssue({ code: 'custom', path: ['pivot'], message: 'Asset pivot must lie inside its source dimensions.' });
  }
});
export type AssetManifestEntry = z.infer<typeof AssetManifestEntrySchema>;

export const PeaceAssetManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  entries: z.array(AssetManifestEntrySchema)
}).strict().superRefine((manifest, context) => {
  const ids = new Set<string>();
  manifest.entries.forEach((asset, index) => {
    if (ids.has(asset.id)) {
      context.addIssue({ code: 'custom', path: ['entries', index, 'id'], message: 'Duplicate asset manifest ID.' });
    }
    ids.add(asset.id);
  });
});
export type PeaceAssetManifest = z.infer<typeof PeaceAssetManifestSchema>;

export class AssetManifestValidationError extends Error {
  readonly code = 'ASSET_MANIFEST_INVALID';

  constructor(readonly issues: Array<{ path: string; code: string }>) {
    super('Peace V2 asset manifest failed schema validation.');
    this.name = 'AssetManifestValidationError';
  }
}

export function parsePeaceAssetManifest(value: unknown): PeaceAssetManifest {
  const result = PeaceAssetManifestSchema.safeParse(value);
  if (!result.success) {
    throw new AssetManifestValidationError(result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code
    })));
  }
  return result.data;
}

export class CatalogValidationError extends Error {
  readonly code = 'CATALOG_INVALID';

  constructor(readonly issues: Array<{ path: string; code: string }>) {
    super('Peace V2 catalog failed schema/reference validation.');
    this.name = 'CatalogValidationError';
  }
}

export function parsePeaceCatalog(value: unknown): PeaceCatalog {
  const result = PeaceCatalogSchema.safeParse(value);
  if (!result.success) {
    throw new CatalogValidationError(result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code
    })));
  }
  return result.data;
}
