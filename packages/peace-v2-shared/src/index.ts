import { z } from 'zod';
export {
  AssetManifestValidationError,
  AssetManifestEntrySchema,
  BuildingDefinitionSchema,
  BuildingLevelSchema,
  CatalogEntrySchema,
  CatalogValidationError,
  CatalogVersionSchema,
  ItemDefinitionSchema,
  LocalCellSchema,
  PeaceCatalogSchema,
  PeaceAssetManifestSchema,
  ProfessionDefinitionSchema,
  RecipeDefinitionSchema,
  ResearchDefinitionSchema,
  parsePeaceAssetManifest,
  parsePeaceCatalog
} from './catalog.js';
export type {
  AssetManifestEntry,
  BuildingDefinition,
  CatalogEntry,
  CatalogVersion,
  ItemDefinition,
  PeaceCatalog,
  PeaceAssetManifest,
  ProfessionDefinition,
  RecipeDefinition,
  ResearchDefinition
} from './catalog.js';

export const GlobalCoordinateSchema = z.object({
  x: z.number().int().safe(),
  y: z.number().int().safe()
}).strict();
export type GlobalCoordinate = z.infer<typeof GlobalCoordinateSchema>;

export const CommandEnvelopeSchema = z.object({
  requestId: z.string().min(8).max(128),
  expectedWorldVersion: z.number().int().safe().nonnegative(),
  expectedGeometryVersion: z.number().int().safe().nonnegative()
}).strict();
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

export const ProblemDetailsSchema = z.object({
  type: z.string().url(),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string().min(1),
  instance: z.string().optional(),
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  requestId: z.string().min(8).max(128).optional()
}).strict();
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export const WorldRevisionSchema = z.object({
  worldVersion: z.number().int().safe().nonnegative(),
  geometryVersion: z.number().int().safe().nonnegative(),
  serverTick: z.number().int().safe().nonnegative()
}).strict();
export type WorldRevision = z.infer<typeof WorldRevisionSchema>;

const EntityIdSchema = z.string().min(1).max(128);
export const PeaceResidentIdSchema = EntityIdSchema;

export const PairingRequestSchema = z.object({
  code: z.string().min(1).max(128)
}).strict();
export type PairingRequest = z.infer<typeof PairingRequestSchema>;

export const BuildIntentSchema = CommandEnvelopeSchema.extend({
  kind: z.literal('build'),
  buildingId: EntityIdSchema,
  anchor: GlobalCoordinateSchema
}).strict();
export type BuildIntent = z.infer<typeof BuildIntentSchema>;

export const AssignWorkIntentSchema = CommandEnvelopeSchema.extend({
  kind: z.literal('assign-work'),
  residentId: EntityIdSchema,
  workKind: z.enum(['gather', 'haul', 'build', 'clear', 'dig', 'craft', 'research']),
  targetId: EntityIdSchema
}).strict();
export type AssignWorkIntent = z.infer<typeof AssignWorkIntentSchema>;

const PreviewCellSchema = z.object({
  coordinate: GlobalCoordinateSchema,
  fillType: z.enum(['air', 'solid']),
  materialId: EntityIdSchema.optional()
}).strict();

const PreviewBuildingSchema = z.object({
  visualKey: EntityIdSchema,
  buildingId: EntityIdSchema,
  anchor: GlobalCoordinateSchema,
  state: z.enum(['planned', 'waiting_materials', 'foundation', 'scaffold', 'complete', 'idle', 'operating', 'blocked'])
}).strict();

export const PeaceTreeNodeSchema = z.object({
  id: EntityIdSchema,
  name: z.string().min(1),
  position: GlobalCoordinateSchema,
  sourceKind: z.enum(['finite', 'renewable_plot']),
  remaining: z.number().int().safe().nonnegative(),
  maxRemaining: z.number().int().safe().positive(),
  state: z.enum(['standing', 'stump', 'uprooted']),
  regrowthProgressTicks: z.number().int().safe().nonnegative(),
  regrowthEveryTicks: z.number().int().safe().positive().nullable()
}).strict();
export type PeaceTreeNode = z.infer<typeof PeaceTreeNodeSchema>;

const PreviewResourceNodeSchema = z.object({
  visualKey: EntityIdSchema,
  name: z.string().min(1),
  position: GlobalCoordinateSchema,
  sourceKind: z.enum(['finite', 'renewable_plot']),
  remaining: z.number().int().safe().nonnegative(),
  maxRemaining: z.number().int().safe().positive(),
  state: z.enum(['standing', 'stump', 'uprooted']),
  regrowthProgressTicks: z.number().int().safe().nonnegative(),
  regrowthEveryTicks: z.number().int().safe().positive().nullable()
}).strict();

const PreviewActorSchema = z.object({
  visualKey: EntityIdSchema,
  appearanceKey: EntityIdSchema.optional(),
  position: GlobalCoordinateSchema,
  visualState: z.enum([
    'idle', 'walking_to_source', 'gathering', 'loading', 'carrying_to_storage', 'unloading',
    'walking_to_build', 'building', 'waiting_path', 'waiting_resource', 'waiting_materials',
    'waiting_storage', 'blocked', 'dig', 'climb', 'study'
  ]),
  cargo: z.number().int().safe().nonnegative().optional()
}).strict();

export const ReadOnlyWorldPreviewSchema = z.object({
  revision: WorldRevisionSchema,
  cells: z.array(PreviewCellSchema),
  buildings: z.array(PreviewBuildingSchema),
  resourceNodes: z.array(PreviewResourceNodeSchema),
  actors: z.array(PreviewActorSchema),
  resourceTotals: z.array(z.object({ itemId: EntityIdSchema, quantity: z.number().int().safe().nonnegative() }).strict())
}).strict();
export type ReadOnlyWorldPreview = z.infer<typeof ReadOnlyWorldPreviewSchema>;

const WorkerTaskBaseSchema = z.object({
  id: EntityIdSchema,
  path: z.array(GlobalCoordinateSchema),
  pathIndex: z.number().int().safe().nonnegative(),
  progressTicks: z.number().int().safe().nonnegative(),
  requiredTicks: z.number().int().safe().positive(),
  blockedReason: z.string().nullable()
}).strict();

export const GatherWoodTaskSchema = WorkerTaskBaseSchema.extend({
  kind: z.literal('gather-wood'),
  phase: z.enum([
    'walking_to_source', 'gathering', 'loading', 'carrying_to_storage', 'unloading', 'waiting_path',
    'waiting_resource', 'waiting_storage', 'blocked'
  ]),
  sourceId: EntityIdSchema.nullable(),
  destinationId: EntityIdSchema,
  continuous: z.boolean(),
  cancelAfterDelivery: z.boolean()
}).strict();

export const BuildCabinTaskSchema = WorkerTaskBaseSchema.extend({
  kind: z.literal('build-cabin'),
  phase: z.enum(['walking_to_build', 'building', 'waiting_path', 'waiting_materials', 'blocked']),
  buildingId: EntityIdSchema
}).strict();

export const PeaceWorkerTaskSchema = z.discriminatedUnion('kind', [GatherWoodTaskSchema, BuildCabinTaskSchema]);
export type PeaceWorkerTask = z.infer<typeof PeaceWorkerTaskSchema>;

export const PeaceResidentSchema = z.object({
  id: PeaceResidentIdSchema,
  name: z.string().min(1),
  appearanceKey: EntityIdSchema,
  position: GlobalCoordinateSchema,
  facing: z.enum(['left', 'right']),
  state: z.enum(['idle', 'working', 'waiting', 'blocked']),
  visualState: z.enum([
    'idle', 'walking_to_source', 'gathering', 'loading', 'carrying_to_storage', 'unloading',
    'walking_to_build', 'building', 'waiting_path', 'waiting_resource', 'waiting_materials', 'waiting_storage', 'blocked'
  ]),
  cargo: z.number().int().safe().nonnegative(),
  blockedReason: z.string().nullable(),
  task: PeaceWorkerTaskSchema.nullable()
}).strict();
export type PeaceResident = z.infer<typeof PeaceResidentSchema>;
const PeaceResidentListSchema = z.array(PeaceResidentSchema).min(2).superRefine((residents, context) => {
  const seen = new Set<string>();
  residents.forEach((resident, index) => {
    if (seen.has(resident.id)) {
      context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Resident IDs must be unique.' });
    }
    seen.add(resident.id);
  });
});

export const CabinPlacementRequestSchema = z.object({
  residentId: PeaceResidentIdSchema,
  anchor: GlobalCoordinateSchema
}).strict();

export const PeaceCommandSchema = z.discriminatedUnion('kind', [
  CommandEnvelopeSchema.extend({
    kind: z.literal('collect-wood'), residentId: PeaceResidentIdSchema, sourceId: EntityIdSchema.optional()
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('cancel-woodcutting'), residentId: PeaceResidentIdSchema
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('uproot-stump'), residentId: PeaceResidentIdSchema, treeId: EntityIdSchema
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('build-cabin'), residentId: PeaceResidentIdSchema, anchor: GlobalCoordinateSchema
  }).strict()
]);
export type PeaceCommand = z.infer<typeof PeaceCommandSchema>;

export const PeaceWorldSnapshotSchema = z.object({
  revision: WorldRevisionSchema,
  resources: z.object({ wood: z.number().int().safe().nonnegative() }).strict(),
  storage: z.object({
    id: EntityIdSchema,
    anchor: GlobalCoordinateSchema,
    footprint: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
    woodCapacity: z.number().int().safe().positive()
  }).strict(),
  trees: z.array(PeaceTreeNodeSchema).min(1),
  residents: PeaceResidentListSchema,
  buildings: z.array(z.object({
    id: z.string().min(1),
    kind: z.literal('cabin'),
    anchor: GlobalCoordinateSchema,
    footprint: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
    state: z.enum(['planned', 'waiting_materials', 'foundation', 'scaffold', 'complete', 'blocked']),
    progressTicks: z.number().int().safe().nonnegative(),
    progressRequired: z.number().int().safe().positive(),
    reservedWood: z.number().int().safe().nonnegative()
  }).strict())
}).strict();
export type PeaceWorldSnapshot = z.infer<typeof PeaceWorldSnapshotSchema>;
