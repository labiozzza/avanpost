import { z } from 'zod';
export const PEACE_WORLD_SCHEMA_VERSION = 12;
export {
  AssetManifestValidationError,
  AssetManifestEntrySchema,
  BuildingDefinitionSchema,
  BuildingLevelSchema,
  CatalogEntrySchema,
  CatalogValidationError,
  CatalogVersionSchema,
  G33StoneBalanceSchema,
  ItemDefinitionSchema,
  LocalCellSchema,
  PeaceCatalogSchema,
  PeaceTerritoryCatalogSchema,
  PeaceAssetManifestSchema,
  ProfessionDefinitionSchema,
  RecipeDefinitionSchema,
  ResearchDefinitionSchema,
  parsePeaceAssetManifest,
  parsePeaceCatalog,
  parsePeaceTerritoryCatalog
} from './catalog.js';
export type {
  AssetManifestEntry,
  BuildingDefinition,
  CatalogEntry,
  CatalogVersion,
  G33StoneBalance,
  ItemDefinition,
  PeaceCatalog,
  PeaceAssetManifest,
  ProfessionDefinition,
  RecipeDefinition,
  ResearchDefinition,
  PeaceTerritoryCatalog
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
export const PeaceWorkRoleSchema = z.enum(['none', 'woodcutter', 'builder', 'stone_miner', 'hauler']);
export type PeaceWorkRole = z.infer<typeof PeaceWorkRoleSchema>;
export const PeaceCargoItemSchema = z.enum(['wood', 'stone']);
export type PeaceCargoItem = z.infer<typeof PeaceCargoItemSchema>;

export const PeaceResourceQuantitiesSchema = z.object({
  wood: z.number().int().safe().nonnegative(),
  stone: z.number().int().safe().nonnegative()
}).strict();

export const PeaceBiomeSchema = z.enum(['meadow', 'woodland', 'scrub', 'rocky']);
export type PeaceBiome = z.infer<typeof PeaceBiomeSchema>;
export const PeaceSectorStateSchema = z.enum(['unknown', 'unlockable', 'unlocked', 'clearing', 'prepared', 'occupied']);
export type PeaceSectorState = z.infer<typeof PeaceSectorStateSchema>;
export const PeaceSectorObstacleSchema = z.object({
  id: EntityIdSchema,
  kind: z.enum(['tree', 'stone']),
  position: GlobalCoordinateSchema
}).strict();
export type PeaceSectorObstacle = z.infer<typeof PeaceSectorObstacleSchema>;

const PeaceSectorBaseSchema = z.object({
  id: EntityIdSchema,
  sectorX: z.number().int().safe(),
  sectorY: z.number().int().safe(),
  bounds: z.object({ minX: z.number().int().safe(), maxX: z.number().int().safe(), minY: z.number().int().safe(), maxY: z.number().int().safe() }).strict(),
  seed: z.string().min(1),
  generatorVersion: z.number().int().safe().positive(),
  biome: PeaceBiomeSchema.nullable(),
  state: PeaceSectorStateSchema,
  ownerId: EntityIdSchema.nullable(),
  explored: z.boolean(),
  unlockCost: PeaceResourceQuantitiesSchema,
  clearWorkTicks: z.object({ tree: z.number().int().positive(), stone: z.number().int().positive(), ground: z.number().int().positive() }).strict(),
  clearYield: PeaceResourceQuantitiesSchema,
  obstacles: z.array(PeaceSectorObstacleSchema).default([]),
  testOverride: z.boolean().default(false),
  preparationTargets: z.array(GlobalCoordinateSchema).default([])
}).strict();

export const PeaceSectorSchema = PeaceSectorBaseSchema.superRefine((sector, context) => {
  if (sector.bounds.maxX < sector.bounds.minX || sector.bounds.maxY < sector.bounds.minY) {
    context.addIssue({ code: 'custom', path: ['bounds'], message: 'Sector bounds must be ordered inclusive coordinates.' });
  }
  if (['unlocked', 'clearing', 'prepared', 'occupied'].includes(sector.state) && sector.ownerId === null) {
    context.addIssue({ code: 'custom', path: ['ownerId'], message: 'An owned sector state requires an owner ID.' });
  }
  if (['unknown', 'unlockable'].includes(sector.state) && sector.ownerId !== null) {
    context.addIssue({ code: 'custom', path: ['ownerId'], message: 'Unknown or unlockable sectors cannot be owned.' });
  }
});
export type PeaceSector = z.infer<typeof PeaceSectorSchema>;

export const PeaceStorageSchema = z.object({
  id: EntityIdSchema,
  sectorId: EntityIdSchema.optional(),
  name: z.string().min(1),
  kind: z.literal('warehouse'),
  anchor: GlobalCoordinateSchema,
  footprint: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  entrance: GlobalCoordinateSchema.optional(),
  workPoint: GlobalCoordinateSchema.optional(),
  entrances: z.array(GlobalCoordinateSchema).min(1).optional(),
  workPoints: z.array(GlobalCoordinateSchema).min(1).optional(),
  capacity: z.number().int().safe().positive(),
  contents: PeaceResourceQuantitiesSchema,
  reservedInbound: PeaceResourceQuantitiesSchema,
  reservedOutbound: PeaceResourceQuantitiesSchema,
  status: z.enum(['available', 'full', 'blocked']),
  blockedReason: z.string().nullable()
}).strict().superRefine((storage, context) => {
  const stored = storage.contents.wood + storage.contents.stone;
  const inbound = storage.reservedInbound.wood + storage.reservedInbound.stone;
  if (stored + inbound > storage.capacity) {
    context.addIssue({ code: 'custom', path: ['reservedInbound'], message: 'Stored and inbound volume cannot exceed this warehouse capacity.' });
  }
  if (storage.reservedOutbound.wood > storage.contents.wood || storage.reservedOutbound.stone > storage.contents.stone) {
    context.addIssue({ code: 'custom', path: ['reservedOutbound'], message: 'Outbound reservations cannot exceed this warehouse contents.' });
  }
});
export type PeaceStorage = z.infer<typeof PeaceStorageSchema>;

export const PeaceSurfaceCellSchema = z.object({
  position: GlobalCoordinateSchema,
  supportsBuilding: z.boolean(),
  walkable: z.boolean(),
  visualFeature: z.enum(['narrow-passage', 'unstable-ground']).optional(),
  sectorId: EntityIdSchema.optional(),
  prepared: z.boolean().optional(),
  terrainType: PeaceBiomeSchema.optional(),
  obstacleId: EntityIdSchema.nullable().optional()
}).strict();
export type PeaceSurfaceCell = z.infer<typeof PeaceSurfaceCellSchema>;

export const UndergroundGeologySchema = z.enum(['humus', 'clay', 'stone', 'bedrock']);
export const UndergroundCellSchema = z.object({
  position: GlobalCoordinateSchema,
  sectorId: EntityIdSchema,
  geology: UndergroundGeologySchema,
  revealed: z.boolean(),
  state: z.enum(['solid', 'tunnel']),
  movementCost: z.number().int().safe().positive(),
  floorSupported: z.boolean().default(true)
}).strict().superRefine((cell, context) => {
  if (cell.position.y <= 0) context.addIssue({ code: 'custom', path: ['position', 'y'], message: 'Underground cells must be below surface row zero.' });
});
export type UndergroundCell = z.infer<typeof UndergroundCellSchema>;

export const UndergroundDepositSchema = z.object({
  id: EntityIdSchema,
  sectorId: EntityIdSchema,
  position: GlobalCoordinateSchema,
  resource: z.literal('stone'),
  initialQuantity: z.number().int().safe().positive(),
  remaining: z.number().int().safe().nonnegative(),
  bufferQuantity: z.number().int().safe().nonnegative(),
  bufferCapacity: z.number().int().safe().positive(),
  reservedBuffer: z.number().int().safe().nonnegative(),
  revealed: z.boolean(),
  state: z.enum(['available', 'depleted'])
}).strict().superRefine((deposit, context) => {
  if (deposit.position.y <= 0 || deposit.remaining > deposit.initialQuantity ||
      deposit.bufferQuantity > deposit.bufferCapacity || deposit.reservedBuffer > deposit.bufferQuantity ||
      deposit.state === 'depleted' && deposit.remaining !== 0) {
    context.addIssue({ code: 'custom', path: ['remaining'], message: 'Underground deposit stock, buffer or location is invalid.' });
  }
});
export type UndergroundDeposit = z.infer<typeof UndergroundDepositSchema>;

export const UndergroundJobSchema = z.object({
  id: EntityIdSchema,
  kind: z.enum(['excavate', 'mine']),
  target: GlobalCoordinateSchema,
  depositId: EntityIdSchema.nullable(),
  assignedResidentId: PeaceResidentIdSchema.nullable(),
  status: z.enum(['queued', 'in_progress', 'waiting_path', 'completed', 'cancelled']),
  progressTicks: z.number().int().safe().nonnegative(),
  requiredTicks: z.number().int().safe().positive(),
  outputQuantity: z.number().int().safe().nonnegative(),
  blockedReason: z.string().nullable(),
  createdTick: z.number().int().safe().nonnegative(),
  planId: EntityIdSchema.nullable().default(null)
}).strict().superRefine((job, context) => {
  if (job.progressTicks > job.requiredTicks || (job.kind === 'mine') !== (job.depositId !== null)) {
    context.addIssue({ code: 'custom', path: ['progressTicks'], message: 'Underground job state is inconsistent.' });
  }
});
export type UndergroundJob = z.infer<typeof UndergroundJobSchema>;

export const UndergroundRouteStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('excavate'), position: GlobalCoordinateSchema }).strict(),
  z.object({ kind: z.literal('build-ladder'), x: z.number().int().safe(), topDepth: z.number().int().safe().nonnegative(),
    depth: z.number().int().safe().positive() }).strict().superRefine((step, context) => {
      if (step.depth !== step.topDepth + 1) context.addIssue({ code: 'custom', path: ['depth'], message: 'Ladders connect consecutive depth rows.' });
    }),
  z.object({ kind: z.literal('reuse-ladder'), ladderId: EntityIdSchema, x: z.number().int().safe(),
    topDepth: z.number().int().safe().nonnegative(), depth: z.number().int().safe().positive() }).strict().superRefine((step, context) => {
      if (step.depth !== step.topDepth + 1) context.addIssue({ code: 'custom', path: ['depth'], message: 'Ladders connect consecutive depth rows.' });
    }),
  z.object({ kind: z.literal('relocate-ladder'), ladderId: EntityIdSchema, x: z.number().int().safe(),
    topDepth: z.number().int().safe().nonnegative(), depth: z.number().int().safe().positive() }).strict().superRefine((step, context) => {
      if (step.depth !== step.topDepth + 1) context.addIssue({ code: 'custom', path: ['depth'], message: 'Ladders connect consecutive depth rows.' });
    })
]);
export type UndergroundRouteStep = z.infer<typeof UndergroundRouteStepSchema>;

export const UndergroundPlanSchema = z.object({
  id: EntityIdSchema,
  depositId: EntityIdSchema,
  target: GlobalCoordinateSchema,
  path: z.array(GlobalCoordinateSchema).min(1),
  steps: z.array(UndergroundRouteStepSchema).min(1),
  currentStep: z.number().int().safe().nonnegative(),
  state: z.enum(['planned', 'in_progress', 'cancelling', 'completed', 'cancelled', 'blocked']),
  blockedReason: z.string().nullable(),
  createdTick: z.number().int().safe().nonnegative()
}).strict().superRefine((plan, context) => {
  if (plan.currentStep > plan.steps.length || plan.state === 'completed' && plan.currentStep !== plan.steps.length) {
    context.addIssue({ code: 'custom', path: ['currentStep'], message: 'Underground plan progress is inconsistent.' });
  }
});
export type UndergroundPlan = z.infer<typeof UndergroundPlanSchema>;

export const PeaceLadderSchema = z.object({
  id: EntityIdSchema,
  top: GlobalCoordinateSchema,
  bottom: GlobalCoordinateSchema,
  state: z.enum(['planned', 'building', 'complete', 'blocked', 'relocating', 'demolished']),
  assignedResidentId: PeaceResidentIdSchema.nullable(),
  requiredWood: z.number().int().safe().positive(),
  deliveredWood: z.number().int().safe().nonnegative(),
  reservedWood: z.number().int().safe().nonnegative(),
  progressTicks: z.number().int().safe().nonnegative(),
  progressRequired: z.number().int().safe().positive(),
  blockedReason: z.string().nullable(),
  planId: EntityIdSchema.nullable().default(null)
}).strict().superRefine((ladder, context) => {
  if (ladder.bottom.y !== ladder.top.y + 1 || ladder.bottom.x !== ladder.top.x ||
      ladder.deliveredWood + ladder.reservedWood > ladder.requiredWood ||
      ladder.progressTicks > ladder.progressRequired) {
    context.addIssue({ code: 'custom', path: ['bottom'], message: 'Ladder must link downward and keep materials/progress within bounds.' });
  }
});
export type PeaceLadder = z.infer<typeof PeaceLadderSchema>;

export const UNDERGROUND_EXCAVATION_MAX_CELLS = 5;
export const UNDERGROUND_BALANCE = {
  status: 'proposed',
  generatorVersion: 1,
  sectorDepth: 24,
  initialAccessibleDepth: 3,
  deeperLevelUnlockCost: { wood: 20, stone: 10 },
  excavationMaxCells: 5,
  excavationWorkTicks: { humus: 2, clay: 3, stone: 5 },
  ladderWood: 2,
  ladderBuildTicks: 4,
  depositQuantity: 24,
  depositBufferCapacity: 6,
  mineWorkTicks: 2,
  mineYield: 1
} as const;

export const POPULATION_BALANCE = {
  status: 'proposed',
  cabinCapacity: 4,
  migrationProgressTicks: 60,
  minimumWood: 2,
  minimumStone: 1,
  minimumWorkingResidents: 1,
  experiencePerWorkTick: 1,
  configVersion: 'g7.1-v1'
} as const;
export const PopulationBalanceSchema = z.object({
  version: z.string().min(1), balanceStatus: z.literal('proposed'), configVersion: EntityIdSchema,
  cabinCapacity: z.number().int().positive(), migrationProgressTicks: z.number().int().positive(),
  minimumWood: z.number().int().nonnegative(), minimumStone: z.number().int().nonnegative(),
  minimumWorkingResidents: z.number().int().positive(), experiencePerWorkTick: z.number().int().positive(),
  arrivalEdgeOffset: z.number().int().positive(), sourceSections: z.array(z.string().min(1)), notes: z.array(z.string().min(1))
}).strict();
export type PopulationBalance = z.infer<typeof PopulationBalanceSchema>;

/** Shared server/client expansion cap. */
export const MAX_EXPANSION_CELLS = 5;

export const PeaceClearingJobSchema = z.object({
  id: EntityIdSchema,
  sectorId: EntityIdSchema,
  position: GlobalCoordinateSchema,
  workPoint: GlobalCoordinateSchema,
  obstacleId: EntityIdSchema.nullable(),
  obstacleKind: z.enum(['tree', 'stone', 'ground']),
  outputItemId: PeaceCargoItemSchema.nullable(),
  outputQuantity: z.number().int().safe().nonnegative(),
  assignedResidentId: PeaceResidentIdSchema.nullable(),
  status: z.enum(['queued', 'in_progress', 'waiting_worker', 'waiting_path', 'completed', 'cancelled']),
  progressTicks: z.number().int().safe().nonnegative(),
  requiredTicks: z.number().int().safe().positive(),
  blockedReason: z.string().nullable(),
  createdTick: z.number().int().safe().nonnegative()
}).strict().superRefine((job, context) => {
  if (job.outputItemId === null && job.outputQuantity !== 0 || job.outputItemId !== null && job.outputQuantity < 1) {
    context.addIssue({ code: 'custom', path: ['outputQuantity'], message: 'Clearing output item and quantity must agree.' });
  }
  if (job.progressTicks > job.requiredTicks) {
    context.addIssue({ code: 'custom', path: ['progressTicks'], message: 'Clearing progress cannot exceed required work.' });
  }
});
export type PeaceClearingJob = z.infer<typeof PeaceClearingJobSchema>;

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
  materialId: EntityIdSchema.optional(),
  sectorId: EntityIdSchema.optional(),
  prepared: z.boolean().optional(),
  terrainType: PeaceBiomeSchema.optional(),
  obstacleId: EntityIdSchema.nullable().optional()
}).strict();

const PreviewSectorSchema = PeaceSectorBaseSchema.pick({
  id: true, sectorX: true, sectorY: true, bounds: true, biome: true, state: true, ownerId: true, explored: true,
  unlockCost: true, obstacles: true, testOverride: true, preparationTargets: true
}).strict();

const PreviewUndergroundCellSchema = z.object({
  position: GlobalCoordinateSchema,
  geology: z.enum(['unknown', 'humus', 'clay', 'stone', 'bedrock']),
  state: z.enum(['solid', 'tunnel']),
  revealed: z.boolean(),
  floorSupported: z.boolean().default(true),
  selected: z.boolean().optional()
}).strict();

const PreviewBuildingSchema = z.object({
  visualKey: EntityIdSchema,
  buildingId: EntityIdSchema,
  anchor: GlobalCoordinateSchema,
  footprint: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict().optional(),
  entrance: GlobalCoordinateSchema.optional(),
  workPoint: GlobalCoordinateSchema.optional(),
  accessibility: z.enum(['accessible', 'blocked']).optional(),
  accessibilityReason: z.string().nullable().optional(),
  progressTicks: z.number().int().safe().nonnegative().optional(),
  progressRequired: z.number().int().safe().positive().optional(),
  reservedWood: z.number().int().safe().nonnegative().optional(),
  reservedStone: z.number().int().safe().nonnegative().optional(),
  inTransitWood: z.number().int().safe().nonnegative().optional(),
  inTransitStone: z.number().int().safe().nonnegative().optional(),
  state: z.enum(['planned', 'waiting_materials', 'waiting_builder', 'in_progress', 'foundation', 'scaffold', 'cancelling', 'complete', 'cancelled', 'demolished', 'idle', 'operating', 'blocked'])
}).strict();

export const PeaceBuildOrderSchema = z.object({
  id: EntityIdSchema,
  buildingId: EntityIdSchema,
  queuePosition: z.number().int().safe().nonnegative(),
  status: z.enum(['waiting_materials', 'waiting_builder', 'waiting_path', 'in_progress', 'cancelling', 'completed', 'cancelled', 'blocked']),
  assignedResidentId: PeaceResidentIdSchema.nullable(),
  blockedReason: z.string().nullable(),
  // Deprecated G3.4 field; retained to parse old saves and normalized by the dispatcher.
  requiresExplicitBuilder: z.boolean().optional()
}).strict();
export type PeaceBuildOrder = z.infer<typeof PeaceBuildOrderSchema>;

export const PeaceTreeNodeSchema = z.object({
  id: EntityIdSchema,
  sectorId: EntityIdSchema.optional(),
  name: z.string().min(1),
  position: GlobalCoordinateSchema,
  sourceKind: z.enum(['finite', 'renewable_plot']),
  remaining: z.number().int().safe().nonnegative(),
  maxRemaining: z.number().int().safe().positive(),
  state: z.enum(['standing', 'stump', 'uprooted']),
  regrowthProgressTicks: z.number().int().safe().nonnegative(),
  regrowthEveryTicks: z.number().int().safe().positive().nullable(),
  bufferQuantity: z.number().int().safe().nonnegative().default(0),
  bufferCapacity: z.number().int().safe().positive().default(1),
  reservedBuffer: z.number().int().safe().nonnegative().default(0)
}).strict().superRefine((tree, context) => {
  if (tree.bufferQuantity > tree.bufferCapacity || tree.reservedBuffer > tree.bufferQuantity) {
    context.addIssue({ code: 'custom', path: ['bufferQuantity'], message: 'Tree buffer and reservation must remain within its capacity.' });
  }
});
export type PeaceTreeNode = z.infer<typeof PeaceTreeNodeSchema>;

export const PeaceStoneDepositSchema = z.object({
  id: EntityIdSchema,
  sectorId: EntityIdSchema.optional(),
  name: z.string().min(1),
  sourceKind: z.literal('finite'),
  position: GlobalCoordinateSchema,
  remaining: z.number().int().safe().nonnegative(),
  maxRemaining: z.number().int().safe().positive(),
  bufferQuantity: z.number().int().safe().nonnegative(),
  bufferCapacity: z.number().int().safe().positive(),
  reservedBuffer: z.number().int().safe().nonnegative().default(0),
  yieldPerTick: z.number().int().safe().positive(),
  state: z.enum(['available', 'depleted'])
}).strict().superRefine((deposit, context) => {
  if (deposit.remaining > deposit.maxRemaining) {
    context.addIssue({ code: 'custom', path: ['remaining'], message: 'Finite stone stock cannot exceed its initial amount.' });
  }
  if (deposit.bufferQuantity > deposit.bufferCapacity) {
    context.addIssue({ code: 'custom', path: ['bufferQuantity'], message: 'Stone buffer cannot exceed its capacity.' });
  }
  if (deposit.reservedBuffer > deposit.bufferQuantity) {
    context.addIssue({ code: 'custom', path: ['reservedBuffer'], message: 'Stone buffer reservations cannot exceed buffered stock.' });
  }
  if (deposit.state === 'depleted' && deposit.remaining !== 0) {
    context.addIssue({ code: 'custom', path: ['state'], message: 'A depleted stone deposit must have zero remaining stock.' });
  }
});
export type PeaceStoneDeposit = z.infer<typeof PeaceStoneDepositSchema>;

const PreviewResourceNodeSchema = z.object({
  visualKey: EntityIdSchema,
  name: z.string().min(1),
  position: GlobalCoordinateSchema,
  sourceKind: z.enum(['finite', 'renewable_plot']),
  remaining: z.number().int().safe().nonnegative(),
  maxRemaining: z.number().int().safe().positive(),
  bufferQuantity: z.number().int().safe().nonnegative(),
  bufferCapacity: z.number().int().safe().nonnegative(),
  reservedBuffer: z.number().int().safe().nonnegative(),
  state: z.enum(['standing', 'stump', 'uprooted']),
  regrowthProgressTicks: z.number().int().safe().nonnegative(),
  regrowthEveryTicks: z.number().int().safe().positive().nullable()
}).strict();

const PreviewStoneDepositSchema = PeaceStoneDepositSchema.extend({ visualKey: EntityIdSchema }).strict();
const PreviewStorageSchema = PeaceStorageSchema.extend({ visualKey: EntityIdSchema }).strict();

const PreviewActorSchema = z.object({
  visualKey: EntityIdSchema,
  appearanceKey: EntityIdSchema.optional(),
  workRole: PeaceWorkRoleSchema.optional(),
  position: GlobalCoordinateSchema,
  visualState: z.enum([
    'idle', 'walking_to_source', 'gathering', 'loading', 'carrying_to_storage', 'unloading',
    'walking_to_build', 'carrying_materials_to_build', 'building', 'waiting_path', 'waiting_resource', 'waiting_materials',
    'waiting_storage', 'walking_to_stone', 'mining_stone', 'loading_stone', 'carrying_stone_to_storage',
    'carrying_stone_to_build', 'unloading_stone', 'unloading_stone_at_build', 'waiting_stone_source',
    'waiting_stone_storage', 'hauling_to_source', 'hauling_loading', 'hauling_to_storage',
    'hauling_to_worksite', 'hauling_unloading', 'waiting_haul', 'blocked', 'walking_to_clearing', 'clearing',
    'walking_away_from_worksite', 'walking_to_underground', 'walking_to_settlement', 'waiting_path', 'excavating', 'mining_underground',
    'carrying_underground_to_surface', 'building_ladder', 'dig', 'climb', 'study'
  ]),
  cargo: z.number().int().safe().nonnegative().optional(),
  cargoItemId: PeaceCargoItemSchema.nullable().optional()
}).strict();

export const ReadOnlyWorldPreviewSchema = z.object({
  revision: WorldRevisionSchema,
  undergroundUnlockedDepth: z.number().int().safe().min(3).optional(),
  populationSummary: z.object({
    total: z.number().int().safe().nonnegative(), working: z.number().int().safe().nonnegative(),
    free: z.number().int().safe().nonnegative(), unassigned: z.number().int().safe().nonnegative(),
    homeless: z.number().int().safe().nonnegative(), housingPlaces: z.number().int().safe().nonnegative(),
    freeHousingPlaces: z.number().int().safe().nonnegative(), migrationState: z.enum(['waiting', 'progress', 'arriving']),
    migrationProgressTicks: z.number().int().safe().nonnegative(), migrationProgressRequired: z.number().int().safe().positive(),
    attraction: z.enum(['sufficient', 'insufficient', 'no_housing']), factors: z.array(z.string())
  }).strict().optional(),
  cells: z.array(PreviewCellSchema),
  sectors: z.array(PreviewSectorSchema).optional(),
  undergroundCells: z.array(PreviewUndergroundCellSchema).optional(),
  undergroundDeposits: z.array(UndergroundDepositSchema).optional(),
  ladders: z.array(PeaceLadderSchema).optional(),
  undergroundJobs: z.array(UndergroundJobSchema).optional(),
  undergroundPlans: z.array(UndergroundPlanSchema).optional(),
  buildings: z.array(PreviewBuildingSchema),
  storages: z.array(PreviewStorageSchema).optional(),
  buildOrders: z.array(PeaceBuildOrderSchema),
  resourceNodes: z.array(PreviewResourceNodeSchema),
  stoneDeposits: z.array(PreviewStoneDepositSchema),
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
  cancelAfterDelivery: z.boolean(),
  assignmentSource: z.enum(['manual', 'profession'])
}).strict();

export const GatherStoneTaskSchema = WorkerTaskBaseSchema.extend({
  kind: z.literal('gather-stone'),
  phase: z.enum([
    'walking_to_source', 'mining', 'loading', 'carrying_to_storage', 'unloading',
    'carrying_to_build', 'unloading_at_building',
    'waiting_path', 'waiting_resource', 'waiting_storage', 'blocked'
  ]),
  sourceId: EntityIdSchema.nullable(),
  destinationId: EntityIdSchema,
  continuous: z.boolean(),
  cancelAfterDelivery: z.boolean(),
  assignmentSource: z.enum(['workRole', 'recovery']),
  buildingId: EntityIdSchema.optional(),
  orderId: EntityIdSchema.optional(),
  deliveryQuantity: z.number().int().safe().positive().optional()
}).strict().superRefine((task, context) => {
  const linked = task.buildingId !== undefined || task.orderId !== undefined || task.deliveryQuantity !== undefined;
  if (linked && (task.buildingId === undefined || task.orderId === undefined || task.deliveryQuantity === undefined)) {
    context.addIssue({ code: 'custom', path: ['buildingId'], message: 'A direct building delivery requires building, order and quantity.' });
  }
  if (['carrying_to_build', 'unloading_at_building'].includes(task.phase) && !linked) {
    context.addIssue({ code: 'custom', path: ['phase'], message: 'A worksite delivery phase requires a linked building order.' });
  }
});

export const PeaceHaulPhaseSchema = z.enum([
  'walking_to_source', 'loading', 'carrying', 'unloading', 'waiting_source', 'waiting_storage', 'waiting_path', 'blocked'
]);

export const HaulTaskSchema = WorkerTaskBaseSchema.extend({
  kind: z.literal('haul'),
  phase: PeaceHaulPhaseSchema,
  sourceKind: z.enum(['tree-buffer', 'stone-buffer', 'underground-buffer', 'storage', 'building-site']),
  sourceId: EntityIdSchema,
  destinationKind: z.enum(['storage', 'building']),
  destinationId: EntityIdSchema,
  orderId: EntityIdSchema.optional(),
  logisticsTaskId: EntityIdSchema.nullable().default(null),
  destinationReserved: z.boolean().default(true),
  itemId: PeaceCargoItemSchema,
  quantity: z.number().int().safe().positive(),
  assignmentSource: z.enum(['workRole', 'manual'])
}).strict().superRefine((task, context) => {
  if (task.destinationKind === 'building' && !task.orderId) {
    context.addIssue({ code: 'custom', path: ['orderId'], message: 'A worksite haul requires a linked construction order.' });
  }
  if (task.destinationKind === 'storage' && task.orderId !== undefined) {
    context.addIssue({ code: 'custom', path: ['orderId'], message: 'A warehouse delivery cannot carry a construction order ID.' });
  }
});

export const PeaceLogisticsPrioritySchema = z.enum([
  'active_construction', 'ready_construction', 'buffer_clearance', 'warehouse_restock', 'rebalancing'
]);
export type PeaceLogisticsPriority = z.infer<typeof PeaceLogisticsPrioritySchema>;

export const DEFAULT_PEACE_LOGISTICS_PRIORITY_ORDER: PeaceLogisticsPriority[] = [
  'active_construction', 'ready_construction', 'buffer_clearance', 'warehouse_restock', 'rebalancing'
];

export const PeaceLogisticsPolicySchema = z.object({
  priorityOrder: z.array(PeaceLogisticsPrioritySchema).length(5).default(DEFAULT_PEACE_LOGISTICS_PRIORITY_ORDER),
  // null means the item-volume catalog has not set a carry limit for this world yet.
  carryCapacity: z.number().int().safe().positive().nullable().default(null)
}).strict().superRefine((policy, context) => {
  if (new Set(policy.priorityOrder).size !== policy.priorityOrder.length) {
    context.addIssue({ code: 'custom', path: ['priorityOrder'], message: 'Every logistics priority must appear exactly once.' });
  }
});
export type PeaceLogisticsPolicy = z.infer<typeof PeaceLogisticsPolicySchema>;

export const PeaceLogisticsQueueStatusSchema = z.enum([
  'queued', 'assigned', 'in_transit', 'waiting', 'blocked', 'completed', 'cancelled'
]);

export const PeaceLogisticsTaskSchema = z.object({
  id: EntityIdSchema,
  demandKey: z.string().min(1),
  kind: PeaceLogisticsPrioritySchema,
  itemId: PeaceCargoItemSchema,
  sourceKind: z.enum(['tree-buffer', 'stone-buffer', 'underground-buffer', 'storage', 'building-site']),
  sourceId: EntityIdSchema,
  destinationKind: z.enum(['storage', 'building']),
  destinationId: EntityIdSchema,
  preferredStorageId: EntityIdSchema.nullable(),
  fallbackReason: z.string().nullable(),
  orderId: EntityIdSchema.nullable(),
  requiredQuantity: z.number().int().safe().positive(),
  allocatedQuantity: z.number().int().safe().nonnegative(),
  deliveredQuantity: z.number().int().safe().nonnegative(),
  priorityRank: z.number().int().safe().nonnegative(),
  queuePosition: z.number().int().safe().nonnegative().nullable(),
  status: PeaceLogisticsQueueStatusSchema,
  assignedResidentId: PeaceResidentIdSchema.nullable(),
  haulTaskId: EntityIdSchema.nullable(),
  blockedReason: z.string().nullable(),
  createdTick: z.number().int().safe().nonnegative()
}).strict().superRefine((task, context) => {
  const hasAssignment = task.assignedResidentId !== null && task.haulTaskId !== null;
  if ((task.assignedResidentId === null) !== (task.haulTaskId === null)) {
    context.addIssue({ code: 'custom', path: ['haulTaskId'], message: 'Carrier and haul-task assignment must be set together.' });
  }
  if (hasAssignment !== (task.allocatedQuantity > 0)) {
    context.addIssue({ code: 'custom', path: ['allocatedQuantity'], message: 'Allocated shipment quantity must match an assigned carrier.' });
  }
  if (['assigned', 'in_transit'].includes(task.status) && !hasAssignment) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Assigned and in-transit queue tasks must have a carrier.' });
  }
  if (task.deliveredQuantity + task.allocatedQuantity > task.requiredQuantity) {
    context.addIssue({ code: 'custom', path: ['requiredQuantity'], message: 'Delivered and allocated quantities cannot exceed the shipment request.' });
  }
  if (['queued', 'completed', 'cancelled'].includes(task.status) && hasAssignment) {
    context.addIssue({ code: 'custom', path: ['assignedResidentId'], message: 'Queued, completed or cancelled tasks cannot retain a carrier assignment.' });
  }
});
export type PeaceLogisticsTask = z.infer<typeof PeaceLogisticsTaskSchema>;

export const BuildCabinTaskSchema = WorkerTaskBaseSchema.extend({
  kind: z.literal('build-cabin'),
  phase: z.enum(['walking_to_build', 'carrying_materials_to_build', 'building', 'waiting_path', 'waiting_materials', 'blocked']),
  buildingId: EntityIdSchema,
  orderId: EntityIdSchema
}).strict();

export const BuildWorkshopTaskSchema = WorkerTaskBaseSchema.extend({
  kind: z.literal('build-workshop'),
  phase: z.enum(['walking_to_build', 'carrying_materials_to_build', 'building', 'waiting_path', 'waiting_materials', 'blocked']),
  buildingId: EntityIdSchema,
  orderId: EntityIdSchema
}).strict();

export const ClearCellTaskSchema = WorkerTaskBaseSchema.extend({
  kind: z.literal('clear-cell'),
  phase: z.enum(['walking_to_worksite', 'clearing', 'waiting_path', 'blocked']),
  jobId: EntityIdSchema,
  sectorId: EntityIdSchema,
  position: GlobalCoordinateSchema,
  workPoint: GlobalCoordinateSchema
}).strict();

export const WalkAwayFromWorksiteTaskSchema = WorkerTaskBaseSchema.extend({
  kind: z.literal('walk-away-from-worksite'),
  phase: z.literal('walking_away')
}).strict();

export const UndergroundWorkTaskSchema = WorkerTaskBaseSchema.extend({
  kind: z.literal('underground-work'),
  phase: z.enum(['walking_to_worksite', 'working', 'carrying_to_surface', 'waiting_path', 'blocked']),
  jobId: EntityIdSchema,
  target: GlobalCoordinateSchema,
  path: z.array(GlobalCoordinateSchema),
  pathIndex: z.number().int().safe().nonnegative()
}).strict().superRefine((task, context) => {
  if (task.pathIndex > task.path.length) context.addIssue({ code: 'custom', path: ['pathIndex'], message: 'Underground route index is outside its path.' });
});

export const LadderConstructionTaskSchema = WorkerTaskBaseSchema.extend({
  kind: z.literal('build-ladder'),
  phase: z.enum(['walking_to_storage', 'carrying_to_site', 'building', 'waiting_materials', 'waiting_path', 'blocked']),
  ladderId: EntityIdSchema,
  storageId: EntityIdSchema.nullable(),
  path: z.array(GlobalCoordinateSchema),
  pathIndex: z.number().int().safe().nonnegative()
}).strict().superRefine((task, context) => {
  if (task.pathIndex > task.path.length) context.addIssue({ code: 'custom', path: ['pathIndex'], message: 'Ladder route index is outside its path.' });
});

export const LadderRelocationTaskSchema = WorkerTaskBaseSchema.extend({
  kind: z.literal('relocate-ladder'),
  phase: z.enum(['walking_to_ladder', 'dismantling', 'carrying_to_site', 'installing', 'waiting_path', 'blocked']),
  ladderId: EntityIdSchema,
  destinationTop: GlobalCoordinateSchema,
  destinationDepth: z.number().int().safe().positive(),
  waitingPhase: z.enum(['walking_to_ladder', 'carrying_to_site']).nullable().default(null),
  path: z.array(GlobalCoordinateSchema),
  pathIndex: z.number().int().safe().nonnegative()
}).strict().superRefine((task, context) => {
  if (task.pathIndex > task.path.length || task.destinationDepth !== task.destinationTop.y + 1) {
    context.addIssue({ code: 'custom', path: ['pathIndex'], message: 'Ladder relocation destination or route is invalid.' });
  }
});

export const PeaceWorkerTaskSchema = z.discriminatedUnion('kind', [
  GatherWoodTaskSchema, GatherStoneTaskSchema, HaulTaskSchema, BuildCabinTaskSchema, BuildWorkshopTaskSchema,
  ClearCellTaskSchema, WalkAwayFromWorksiteTaskSchema, UndergroundWorkTaskSchema, LadderConstructionTaskSchema,
  LadderRelocationTaskSchema,
  z.object({ kind: z.literal('arrival'), id: EntityIdSchema, phase: z.enum(['commuting', 'waiting_path']),
    targetBuildingId: EntityIdSchema, path: z.array(GlobalCoordinateSchema), pathIndex: z.number().int().safe().nonnegative(),
    progressTicks: z.number().int().safe().nonnegative(), requiredTicks: z.number().int().safe().positive(),
    blockedReason: z.string().nullable() }).strict().superRefine((task, context) => {
      if (task.pathIndex > task.path.length) context.addIssue({ code: 'custom', path: ['pathIndex'], message: 'Arrival path progress is invalid.' });
    })
]);
export type PeaceWorkerTask = z.infer<typeof PeaceWorkerTaskSchema>;

export const PeaceResidentSchema = z.object({
  id: PeaceResidentIdSchema,
  name: z.string().min(1),
  appearanceKey: EntityIdSchema,
  position: GlobalCoordinateSchema,
  facing: z.enum(['left', 'right']),
  state: z.enum(['idle', 'working', 'waiting', 'blocked']),
  workRole: PeaceWorkRoleSchema,
  visualState: z.enum([
    'idle', 'walking_to_source', 'gathering', 'loading', 'carrying_to_storage', 'unloading',
    'walking_to_build', 'carrying_materials_to_build', 'building', 'waiting_path', 'waiting_resource', 'waiting_materials',
    'waiting_storage', 'walking_to_stone', 'mining_stone', 'loading_stone', 'carrying_stone_to_storage',
    'carrying_stone_to_build', 'unloading_stone', 'unloading_stone_at_build', 'waiting_stone_source',
    'waiting_stone_storage', 'hauling_to_source', 'hauling_loading', 'hauling_to_storage',
    'hauling_to_worksite', 'hauling_unloading', 'waiting_haul', 'blocked', 'walking_to_clearing', 'clearing',
    'walking_away_from_worksite', 'walking_to_underground', 'walking_to_settlement', 'waiting_path', 'excavating', 'mining_underground',
    'carrying_underground_to_surface', 'building_ladder', 'carrying_ladder', 'dismantling_ladder', 'installing_ladder'
  ]),
  cargo: z.number().int().safe().nonnegative(),
  cargoItemId: PeaceCargoItemSchema.nullable(),
  preferredStorageId: EntityIdSchema.nullable().default(null),
  preferredHaulSourceId: EntityIdSchema.nullable().default(null),
  createdAtTick: z.number().int().safe().nonnegative().default(0),
  arrivedAtTick: z.number().int().safe().nonnegative().nullable().default(0),
  civilianProfession: z.literal('general_worker').default('general_worker'),
  civilianXp: z.number().int().safe().nonnegative().default(0),
  learningHistory: z.array(z.object({ schoolIds: z.array(EntityIdSchema), profession: EntityIdSchema,
    completedAtTick: z.number().int().safe().nonnegative(), configVersion: EntityIdSchema }).strict()).default([]),
  innateTraits: z.array(EntityIdSchema).default([]),
  characteristics: z.object({ strength: z.number().int().min(1).max(10), dexterity: z.number().int().min(1).max(10),
    endurance: z.number().int().min(1).max(10), intelligence: z.number().int().min(1).max(10) }).strict()
    .default({ strength: 5, dexterity: 5, endurance: 5, intelligence: 5 }),
  housingBuildingId: EntityIdSchema.nullable().default(null),
  arrivalState: z.enum(['settled', 'commuting']).default('settled'),
  blockedReason: z.string().nullable(),
  task: PeaceWorkerTaskSchema.nullable()
}).strict().superRefine((resident, context) => {
  if (resident.cargo === 0 && resident.cargoItemId !== null) {
    context.addIssue({ code: 'custom', path: ['cargoItemId'], message: 'An empty resident cannot retain a cargo item type.' });
  }
  if (resident.cargo > 0 && resident.cargoItemId === null) {
    context.addIssue({ code: 'custom', path: ['cargoItemId'], message: 'A carried quantity must identify its resource.' });
  }
  if (resident.cargo > 0 && resident.task?.kind === 'gather-wood' && resident.cargoItemId !== 'wood') {
    context.addIssue({ code: 'custom', path: ['cargoItemId'], message: 'A wood gathering task may only carry wood.' });
  }
  if (resident.cargo > 0 && resident.task?.kind === 'gather-stone' && resident.cargoItemId !== 'stone') {
    context.addIssue({ code: 'custom', path: ['cargoItemId'], message: 'A stone mining task may only carry stone.' });
  }
  if (resident.task?.kind === 'gather-stone' && resident.task.deliveryQuantity !== undefined &&
      resident.task.deliveryQuantity > resident.cargo) {
    context.addIssue({ code: 'custom', path: ['task', 'deliveryQuantity'], message: 'A worksite delivery cannot reserve more than the resident carries.' });
  }
  if (resident.task?.kind === 'gather-stone' && resident.task.deliveryQuantity !== undefined &&
      resident.cargoItemId !== 'stone') {
    context.addIssue({ code: 'custom', path: ['task', 'deliveryQuantity'], message: 'A stone worksite delivery requires stone cargo.' });
  }
});
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
  buildingKind: z.enum(['cabin', 'workshop']).optional(),
  residentId: PeaceResidentIdSchema.optional(),
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
    kind: z.literal('set-work-role'), residentId: PeaceResidentIdSchema, workRole: PeaceWorkRoleSchema
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('assign-resident'),
    residentId: PeaceResidentIdSchema,
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('tree'), sourceId: EntityIdSchema }).strict(),
      z.object({ kind: z.literal('stone-deposit'), sourceId: EntityIdSchema }).strict(),
      z.object({ kind: z.literal('storage'), storageId: EntityIdSchema }).strict(),
      z.object({ kind: z.literal('build-order'), orderId: EntityIdSchema }).strict()
    ])
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('move-build-order'), orderId: EntityIdSchema, direction: z.enum(['up', 'down'])
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('cancel-build-order'), orderId: EntityIdSchema
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('demolish-building'), buildingId: EntityIdSchema, confirmed: z.literal(true)
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('demolish-storage'), storageId: EntityIdSchema, confirmed: z.literal(true)
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('unlock-sector'), sectorId: EntityIdSchema
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('expand-cells'), sectorId: EntityIdSchema,
    // The simulation returns the typed MAX_EXPANSION_CELLS_EXCEEDED error for gameplay violations.
    positions: z.array(GlobalCoordinateSchema).min(1)
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('clear-cell'), sectorId: EntityIdSchema, position: GlobalCoordinateSchema
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('assign-clear-worker'), residentId: PeaceResidentIdSchema, jobId: EntityIdSchema
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('excavate-cells'), positions: z.array(GlobalCoordinateSchema).min(1)
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('mine-underground'), depositId: EntityIdSchema
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('plan-underground-route'), depositId: EntityIdSchema
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('cancel-underground-plan'), planId: EntityIdSchema
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('build-ladder'), x: z.number().int().safe(), depth: z.number().int().safe().positive(),
    topDepth: z.number().int().safe().nonnegative().optional(),
    residentId: PeaceResidentIdSchema.optional()
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('demolish-ladder'), ladderId: EntityIdSchema, confirmed: z.literal(true)
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('build-cabin'), residentId: PeaceResidentIdSchema.optional(), anchor: GlobalCoordinateSchema
  }).strict(),
  CommandEnvelopeSchema.extend({
    kind: z.literal('build-workshop'), anchor: GlobalCoordinateSchema
  }).strict()
]);
export type PeaceCommand = z.infer<typeof PeaceCommandSchema>;

const PeaceBuildOrderListSchema = z.array(PeaceBuildOrderSchema).superRefine((orders, context) => {
  const ids = new Set<string>();
  const positions = new Set<number>();
  orders.forEach((order, index) => {
    if (ids.has(order.id)) context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Build order IDs must be unique.' });
    if (positions.has(order.queuePosition)) context.addIssue({ code: 'custom', path: [index, 'queuePosition'], message: 'Build queue positions must be unique.' });
    ids.add(order.id);
    positions.add(order.queuePosition);
  });
});

export const PeaceBuildingKindSchema = z.enum(['cabin', 'workshop']);
export type PeaceBuildingKind = z.infer<typeof PeaceBuildingKindSchema>;

export const PeaceBuildingSchema = z.object({
  id: EntityIdSchema,
  sectorId: EntityIdSchema.optional(),
  kind: PeaceBuildingKindSchema,
  housingCapacity: z.number().int().safe().nonnegative().default(0),
  orderId: EntityIdSchema,
  anchor: GlobalCoordinateSchema,
  footprint: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  entrance: GlobalCoordinateSchema.optional(),
  workPoint: GlobalCoordinateSchema.optional(),
  layoutVersion: z.number().int().safe().positive().default(1),
  accessibility: z.enum(['accessible', 'blocked']).default('accessible'),
  accessibilityReason: z.string().nullable().default(null),
  state: z.enum(['planned', 'waiting_materials', 'waiting_builder', 'in_progress', 'foundation', 'scaffold', 'cancelling', 'complete', 'cancelled', 'demolished', 'blocked']),
  progressTicks: z.number().int().safe().nonnegative(),
  progressRequired: z.number().int().safe().positive(),
  reservedWood: z.number().int().safe().nonnegative(),
  reservedStone: z.number().int().safe().nonnegative(),
  inTransitWood: z.number().int().safe().nonnegative().default(0),
  inTransitStone: z.number().int().safe().nonnegative().default(0),
  reservedReturnWood: z.number().int().safe().nonnegative().default(0),
  reservedReturnStone: z.number().int().safe().nonnegative().default(0)
}).strict();
export type PeaceBuilding = z.infer<typeof PeaceBuildingSchema>;

export const PeaceWorldSnapshotSchema = z.object({
  revision: WorldRevisionSchema,
  worldSeed: z.string().min(1).default('peace-home'),
  territoryGeneratorVersion: z.number().int().safe().positive().default(1),
  resources: z.object({
    wood: z.number().int().safe().nonnegative(),
    stone: z.number().int().safe().nonnegative()
  }).strict(),
  storage: z.object({
    id: EntityIdSchema,
    anchor: GlobalCoordinateSchema,
    footprint: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
    capacity: z.number().int().safe().positive()
  }).strict(),
  storages: z.array(PeaceStorageSchema).min(1).optional(),
  logisticsTasks: z.array(PeaceLogisticsTaskSchema).default([]),
  logisticsPolicy: PeaceLogisticsPolicySchema.default({
    priorityOrder: DEFAULT_PEACE_LOGISTICS_PRIORITY_ORDER,
    carryCapacity: null
  }),
  nextLogisticsSequence: z.number().int().safe().positive().default(1),
  sectors: z.array(PeaceSectorSchema).default([]),
  clearingJobs: z.array(PeaceClearingJobSchema).default([]),
  nextClearingSequence: z.number().int().safe().positive().default(1),
  undergroundCells: z.array(UndergroundCellSchema).default([]),
  undergroundUnlockedDepth: z.number().int().safe().min(3).default(3),
  populationMigration: z.object({
    progressTicks: z.number().int().safe().nonnegative().default(0),
    progressRequired: z.number().int().safe().positive().default(POPULATION_BALANCE.migrationProgressTicks),
    nextResidentSequence: z.number().int().safe().positive().default(1),
    pendingResidentId: PeaceResidentIdSchema.nullable().default(null),
    attraction: z.enum(['sufficient', 'insufficient', 'no_housing']).default('no_housing'),
    lastArrivalTick: z.number().int().safe().nonnegative().nullable().default(null)
  }).strict().default({
    progressTicks: 0,
    progressRequired: POPULATION_BALANCE.migrationProgressTicks,
    nextResidentSequence: 1,
    pendingResidentId: null,
    attraction: 'no_housing',
    lastArrivalTick: null
  }),
  undergroundDeposits: z.array(UndergroundDepositSchema).default([]),
  undergroundJobs: z.array(UndergroundJobSchema).default([]),
  undergroundPlans: z.array(UndergroundPlanSchema).default([]),
  ladders: z.array(PeaceLadderSchema).default([]),
  nextUndergroundSequence: z.number().int().safe().positive().default(1),
  surfaceCells: z.array(PeaceSurfaceCellSchema).default([]),
  trees: z.array(PeaceTreeNodeSchema).min(1),
  stoneDeposits: z.array(PeaceStoneDepositSchema).min(1),
  residents: PeaceResidentListSchema,
  buildOrders: PeaceBuildOrderListSchema,
  nextBuildOrderSequence: z.number().int().safe().positive(),
  buildings: z.array(PeaceBuildingSchema)
}).strict().superRefine((world, context) => {
  const sectorIds = new Set<string>();
  const sectorCoordinates = new Set<string>();
  const sectorsById = new Map<string, PeaceSector>();
  for (const [index, sector] of world.sectors.entries()) {
    const coordinate = `${sector.sectorX},${sector.sectorY}`;
    if (sectorIds.has(sector.id)) context.addIssue({ code: 'custom', path: ['sectors', index, 'id'], message: 'Sector IDs must be unique.' });
    if (sectorCoordinates.has(coordinate)) context.addIssue({ code: 'custom', path: ['sectors', index], message: 'Sector coordinates must be unique.' });
    sectorIds.add(sector.id);
    sectorCoordinates.add(coordinate);
    sectorsById.set(sector.id, sector);
  }
  const terrainCells = new Set<string>();
  world.surfaceCells.forEach((cell, index) => {
    const key = `${cell.position.x},${cell.position.y}`;
    if (terrainCells.has(key)) {
      context.addIssue({ code: 'custom', path: ['surfaceCells', index, 'position'], message: 'Surface cells must be unique.' });
    }
    terrainCells.add(key);
    if (cell.sectorId) {
      const sector = sectorsById.get(cell.sectorId);
      if (!sector) context.addIssue({ code: 'custom', path: ['surfaceCells', index, 'sectorId'], message: 'Terrain cell must refer to a saved sector.' });
      else if (cell.position.x < sector.bounds.minX || cell.position.x > sector.bounds.maxX ||
          cell.position.y < sector.bounds.minY || cell.position.y > sector.bounds.maxY) {
        context.addIssue({ code: 'custom', path: ['surfaceCells', index, 'position'], message: 'Terrain cell must lie within its sector bounds.' });
      }
    }
  });
  const cellsByCoordinate = new Map(world.surfaceCells.map((cell) => [`${cell.position.x},${cell.position.y}`, cell]));
  const clearingJobs = new Map<string, PeaceClearingJob>();
  const activeClearTargets = new Set<string>();
  world.clearingJobs.forEach((job, index) => {
    const cellKey = `${job.position.x},${job.position.y}`;
    if (clearingJobs.has(job.id)) context.addIssue({ code: 'custom', path: ['clearingJobs', index, 'id'], message: 'Clearing job IDs must be unique.' });
    if (!sectorsById.has(job.sectorId)) context.addIssue({ code: 'custom', path: ['clearingJobs', index, 'sectorId'], message: 'Clearing job must refer to a saved sector.' });
    if (!cellsByCoordinate.has(cellKey)) context.addIssue({ code: 'custom', path: ['clearingJobs', index, 'position'], message: 'Clearing job must refer to a saved terrain cell.' });
    if (['queued', 'in_progress', 'waiting_worker', 'waiting_path'].includes(job.status)) {
      if (activeClearTargets.has(cellKey)) context.addIssue({ code: 'custom', path: ['clearingJobs', index, 'position'], message: 'Only one active clearing job may target a cell.' });
      activeClearTargets.add(cellKey);
    }
    if (job.assignedResidentId !== null && !world.residents.some((resident) => resident.id === job.assignedResidentId &&
        resident.task?.kind === 'clear-cell' && resident.task.jobId === job.id)) {
      context.addIssue({ code: 'custom', path: ['clearingJobs', index, 'assignedResidentId'], message: 'Assigned clear worker must own the matching task.' });
    }
    clearingJobs.set(job.id, job);
  });
  for (const [index, resident] of world.residents.entries()) {
    if (resident.task?.kind !== 'clear-cell') continue;
    const job = clearingJobs.get(resident.task.jobId);
    if (!job || job.assignedResidentId !== resident.id || job.sectorId !== resident.task.sectorId ||
        job.position.x !== resident.task.position.x || job.position.y !== resident.task.position.y) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'task'], message: 'Resident clearing task must match an assigned saved clearing job.' });
    }
  }
  const undergroundCells = new Map<string, UndergroundCell>();
  world.undergroundCells.forEach((cell, index) => {
    const key = `${cell.position.x},${cell.position.y}`;
    if (undergroundCells.has(key)) context.addIssue({ code: 'custom', path: ['undergroundCells', index, 'position'], message: 'Underground cell coordinates must be unique.' });
    if (!sectorsById.has(cell.sectorId)) context.addIssue({ code: 'custom', path: ['undergroundCells', index, 'sectorId'], message: 'Underground cell must refer to a saved sector.' });
    undergroundCells.set(key, cell);
  });
  const undergroundJobs = new Map<string, UndergroundJob>();
  const activeUndergroundTargets = new Set<string>();
  world.undergroundJobs.forEach((job, index) => {
    const key = `${job.target.x},${job.target.y}`;
    if (undergroundJobs.has(job.id)) context.addIssue({ code: 'custom', path: ['undergroundJobs', index, 'id'], message: 'Underground job IDs must be unique.' });
    if (job.kind === 'excavate' && !undergroundCells.has(key)) context.addIssue({ code: 'custom', path: ['undergroundJobs', index, 'target'], message: 'Excavation job must reference a generated cell.' });
    if (['queued', 'in_progress', 'waiting_path'].includes(job.status)) {
      if (activeUndergroundTargets.has(key)) context.addIssue({ code: 'custom', path: ['undergroundJobs', index, 'target'], message: 'Only one active underground job may target a coordinate.' });
      activeUndergroundTargets.add(key);
    }
    if (job.assignedResidentId !== null && !world.residents.some((resident) => resident.id === job.assignedResidentId &&
        resident.task?.kind === 'underground-work' && resident.task.jobId === job.id)) {
      context.addIssue({ code: 'custom', path: ['undergroundJobs', index, 'assignedResidentId'], message: 'Underground worker must own its matching task.' });
    }
    undergroundJobs.set(job.id, job);
  });
  for (const [index, resident] of world.residents.entries()) {
    if (resident.task?.kind !== 'underground-work') continue;
    const job = undergroundJobs.get(resident.task.jobId);
    if (!job || job.assignedResidentId !== resident.id || job.target.x !== resident.task.target.x ||
        job.target.y !== resident.task.target.y) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'task'], message: 'Underground resident task must match an assigned saved job.' });
    }
  }
  const depositIds = new Set<string>();
  world.undergroundDeposits.forEach((deposit, index) => {
    if (depositIds.has(deposit.id)) context.addIssue({ code: 'custom', path: ['undergroundDeposits', index, 'id'], message: 'Underground deposit IDs must be unique.' });
    depositIds.add(deposit.id);
  });
  const ladderIds = new Set<string>();
  world.ladders.forEach((ladder, index) => {
    if (ladderIds.has(ladder.id)) context.addIssue({ code: 'custom', path: ['ladders', index, 'id'], message: 'Ladder IDs must be unique.' });
    ladderIds.add(ladder.id);
    const topCell = ladder.top.y === 0
      ? world.surfaceCells.some((cell) => cell.position.x === ladder.top.x && cell.position.y === 0 && cell.walkable)
      : (() => {
        const cell = undergroundCells.get(`${ladder.top.x},${ladder.top.y}`);
        return cell?.state === 'tunnel' && cell.floorSupported;
      })();
    const bottom = undergroundCells.get(`${ladder.bottom.x},${ladder.bottom.y}`);
    if (!topCell ||
        !bottom || bottom.state !== 'tunnel' || !bottom.floorSupported) {
      context.addIssue({ code: 'custom', path: ['ladders', index], message: 'Ladder endpoints must connect walkable cells on consecutive underground levels.' });
    }
  });
  const legacySingleStorage = !world.storages ||
    world.storages.length === 1 && !world.residents.some((resident) => resident.workRole === 'hauler');
  if (legacySingleStorage && world.resources.wood + world.resources.stone > world.storage.capacity) {
    context.addIssue({ code: 'custom', path: ['resources'], message: 'Combined stored resources cannot exceed shared storage capacity.' });
  }
  const buildingReturns = new Map(world.buildings.map((building) => [building.id, { wood: 0, stone: 0 }]));
  for (const resident of world.residents) {
    const task = resident.task;
    if (task?.kind !== 'haul' || task.sourceKind !== 'building-site' || resident.cargo > 0) continue;
    const returns = buildingReturns.get(task.sourceId);
    if (returns) returns[task.itemId] += task.quantity;
  }
  if (world.storages) {
    const storageIds = new Set<string>();
    let wood = 0;
    let stone = 0;
    world.storages.forEach((storage, index) => {
      if (storageIds.has(storage.id)) {
        context.addIssue({ code: 'custom', path: ['storages', index, 'id'], message: 'Warehouse IDs must be unique.' });
      }
      storageIds.add(storage.id);
      wood += storage.contents.wood;
      stone += storage.contents.stone;
    });
    if (!storageIds.has(world.storage.id)) {
      context.addIssue({ code: 'custom', path: ['storage', 'id'], message: 'The legacy primary storage must refer to a physical warehouse.' });
    }
    const distributedStorageMode = world.storages.length > 1 || world.residents.some((resident) => resident.workRole === 'hauler');
    if (distributedStorageMode && (wood !== world.resources.wood || stone !== world.resources.stone)) {
      context.addIssue({ code: 'custom', path: ['resources'], message: 'Resource totals must equal the sum of physical warehouse stocks.' });
    }
  }
  const buildings = new Map(world.buildings.map((building) => [building.id, building]));
  const residents = new Map(world.residents.map((resident) => [resident.id, resident]));
  const treeIds = new Set(world.trees.map((tree) => tree.id));
  const stoneIds = new Set(world.stoneDeposits.map((deposit) => deposit.id));
  const storageIds = new Set((world.storages ?? []).map((storage) => storage.id));
  const linkedBuildings = new Set<string>();
  const logisticsTasks = new Map<string, PeaceLogisticsTask>();
  const logisticsTaskAssignments = new Set<string>();
  const logisticsResidentAssignments = new Set<string>();
  world.logisticsTasks.forEach((task, index) => {
    if (logisticsTasks.has(task.id)) {
      context.addIssue({ code: 'custom', path: ['logisticsTasks', index, 'id'], message: 'Logistics task IDs must be unique.' });
    }
    logisticsTasks.set(task.id, task);
    const expectedPriority = world.logisticsPolicy.priorityOrder.indexOf(task.kind);
    if (task.priorityRank !== expectedPriority) {
      context.addIssue({ code: 'custom', path: ['logisticsTasks', index, 'priorityRank'], message: 'Task priority rank must follow the world policy.' });
    }
    if (task.sourceKind === 'tree-buffer' && !treeIds.has(task.sourceId) ||
        task.sourceKind === 'stone-buffer' && !stoneIds.has(task.sourceId) ||
        task.sourceKind === 'storage' && world.storages && !storageIds.has(task.sourceId) ||
        task.sourceKind === 'building-site' && !buildings.has(task.sourceId)) {
      context.addIssue({ code: 'custom', path: ['logisticsTasks', index, 'sourceId'], message: 'Queue source must exist in this world.' });
    }
    if (task.destinationKind === 'storage' && world.storages && !storageIds.has(task.destinationId) ||
        task.destinationKind === 'building' && !buildings.has(task.destinationId)) {
      context.addIssue({ code: 'custom', path: ['logisticsTasks', index, 'destinationId'], message: 'Queue destination must exist in this world.' });
    }
    if (task.assignedResidentId !== null && task.haulTaskId !== null) {
      if (logisticsTaskAssignments.has(task.haulTaskId)) {
        context.addIssue({ code: 'custom', path: ['logisticsTasks', index, 'haulTaskId'], message: 'A haul task cannot be assigned to multiple queue entries.' });
      }
      if (logisticsResidentAssignments.has(task.assignedResidentId)) {
        context.addIssue({ code: 'custom', path: ['logisticsTasks', index, 'assignedResidentId'], message: 'A resident cannot be assigned to multiple haul tasks.' });
      }
      logisticsTaskAssignments.add(task.haulTaskId);
      logisticsResidentAssignments.add(task.assignedResidentId);
      const resident = residents.get(task.assignedResidentId);
      if (!resident || resident.task?.kind !== 'haul' || resident.task.id !== task.haulTaskId ||
          resident.task.logisticsTaskId !== task.id || resident.task.quantity !== task.allocatedQuantity ||
          resident.task.sourceKind !== task.sourceKind || resident.task.sourceId !== task.sourceId ||
          resident.task.destinationKind !== task.destinationKind || resident.task.destinationId !== task.destinationId ||
          resident.task.itemId !== task.itemId) {
        context.addIssue({ code: 'custom', path: ['logisticsTasks', index, 'assignedResidentId'], message: 'Queue assignment must match its authoritative resident haul task.' });
      }
    }
    if (task.status === 'in_transit' && task.allocatedQuantity < 1) {
      context.addIssue({ code: 'custom', path: ['logisticsTasks', index, 'status'], message: 'An in-transit queue task must have an allocated shipment.' });
    }
  });
  if (new Set(world.logisticsPolicy.priorityOrder).size !== world.logisticsPolicy.priorityOrder.length) {
    context.addIssue({ code: 'custom', path: ['logisticsPolicy', 'priorityOrder'], message: 'Logistics priorities must be unique.' });
  }
  world.buildOrders.forEach((order, index) => {
    const building = buildings.get(order.buildingId);
    if (!building) context.addIssue({ code: 'custom', path: ['buildOrders', index, 'buildingId'], message: 'Build order must reference a saved building.' });
    else {
      linkedBuildings.add(building.id);
      if (building.orderId !== order.id) context.addIssue({ code: 'custom', path: ['buildOrders', index, 'id'], message: 'Building and order IDs must agree.' });
    }
    if (order.assignedResidentId && !residents.has(order.assignedResidentId)) {
      context.addIssue({ code: 'custom', path: ['buildOrders', index, 'assignedResidentId'], message: 'Assigned builder must exist.' });
    }
     if (order.status === 'in_progress' && (!order.assignedResidentId || ![...residents.values()].some((resident) =>
       resident.id === order.assignedResidentId &&
       (resident.task?.kind === 'build-cabin' || resident.task?.kind === 'build-workshop') && resident.task.orderId === order.id))) {
      context.addIssue({ code: 'custom', path: ['buildOrders', index, 'status'], message: 'An in-progress order must be owned by a builder task.' });
    }
  });
  world.residents.forEach((resident, index) => {
    if (resident.preferredStorageId && world.storages && !storageIds.has(resident.preferredStorageId)) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'preferredStorageId'], message: 'Preferred storage must exist in this world.' });
    }
    if (resident.preferredHaulSourceId && !treeIds.has(resident.preferredHaulSourceId) &&
        !stoneIds.has(resident.preferredHaulSourceId) && !storageIds.has(resident.preferredHaulSourceId)) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'preferredHaulSourceId'], message: 'Preferred haul source must exist in this world.' });
    }
    const task = resident.task;
    if (task?.kind !== 'haul') return;
    if (task.logisticsTaskId) {
      const queued = logisticsTasks.get(task.logisticsTaskId);
      if (!queued || queued.assignedResidentId !== resident.id || queued.haulTaskId !== task.id) {
        context.addIssue({ code: 'custom', path: ['residents', index, 'task', 'logisticsTaskId'], message: 'Every assigned haul task must appear in the central logistics queue.' });
      }
    }
    if (task.sourceKind === 'tree-buffer' && !treeIds.has(task.sourceId)) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'task', 'sourceId'], message: 'Haul source tree must exist.' });
    }
    if (task.sourceKind === 'stone-buffer' && !stoneIds.has(task.sourceId)) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'task', 'sourceId'], message: 'Haul source deposit must exist.' });
    }
    if (task.sourceKind === 'storage' && world.storages && !storageIds.has(task.sourceId)) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'task', 'sourceId'], message: 'Haul source warehouse must exist.' });
    }
    if (task.sourceKind === 'building-site' && !buildings.has(task.sourceId)) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'task', 'sourceId'], message: 'Haul source building site must exist.' });
    }
    if (task.destinationKind === 'storage' && world.storages && !storageIds.has(task.destinationId)) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'task', 'destinationId'], message: 'Haul destination warehouse must exist.' });
    }
    if (task.destinationKind === 'building' && !buildings.has(task.destinationId)) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'task', 'destinationId'], message: 'Haul destination building must exist.' });
    }
    const loaded = resident.cargo > 0;
    if (loaded && (resident.cargoItemId !== task.itemId || resident.cargo !== task.quantity)) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'task', 'quantity'], message: 'Loaded haul quantity must match the resident cargo.' });
    }
    if (!loaded && ['carrying', 'unloading', 'waiting_storage'].includes(task.phase)) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'cargo'], message: 'A carrying haul task must own the physical cargo.' });
    }
    if (!task.destinationReserved && !(task.destinationKind === 'storage' && loaded &&
        ['waiting_storage', 'waiting_path'].includes(task.phase))) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'task', 'destinationReserved'], message: 'An unreserved destination is allowed only while loaded cargo waits for a warehouse route.' });
    }
  });
  if (world.storages) {
    const storageReservations = new Map(world.storages.map((storage) => [storage.id, {
      inbound: { wood: 0, stone: 0 }, outbound: { wood: 0, stone: 0 }
    }]));
    const buildingInbound = new Map(world.buildings.map((building) => [building.id, { wood: 0, stone: 0 }]));
    const treeReservations = new Map(world.trees.map((tree) => [tree.id, 0]));
    const stoneReservations = new Map(world.stoneDeposits.map((deposit) => [deposit.id, 0]));
    for (const resident of world.residents) {
      const task = resident.task;
      if (task?.kind === 'build-ladder' && task.storageId) {
        const ladder = world.ladders.find((candidate) => candidate.id === task.ladderId);
        const reservations = storageReservations.get(task.storageId);
        if (ladder && reservations) reservations.outbound.wood += ladder.reservedWood;
      }
      if (task?.kind !== 'haul') continue;
      const sourceStillReserved = resident.cargo === 0;
      if (task.sourceKind === 'storage' && sourceStillReserved) {
        const reservations = storageReservations.get(task.sourceId);
        if (reservations) reservations.outbound[task.itemId] += task.quantity;
      }
      if (task.sourceKind === 'tree-buffer' && sourceStillReserved) {
        treeReservations.set(task.sourceId, (treeReservations.get(task.sourceId) ?? 0) + task.quantity);
      }
      if (task.sourceKind === 'stone-buffer' && sourceStillReserved) {
        stoneReservations.set(task.sourceId, (stoneReservations.get(task.sourceId) ?? 0) + task.quantity);
      }
      if (!task.destinationReserved) continue;
      if (task.destinationKind === 'storage') {
        const reservations = storageReservations.get(task.destinationId);
        if (reservations) reservations.inbound[task.itemId] += task.quantity;
      } else {
        const inbound = buildingInbound.get(task.destinationId);
        if (inbound) inbound[task.itemId] += task.quantity;
      }
    }
    world.storages.forEach((storage, index) => {
      const expected = storageReservations.get(storage.id)!;
      if (storage.reservedInbound.wood !== expected.inbound.wood || storage.reservedInbound.stone !== expected.inbound.stone ||
          storage.reservedOutbound.wood !== expected.outbound.wood || storage.reservedOutbound.stone !== expected.outbound.stone) {
        context.addIssue({ code: 'custom', path: ['storages', index], message: 'Warehouse reservations must match active haul tasks.' });
      }
    });
    world.trees.forEach((tree, index) => {
      if (tree.reservedBuffer !== (treeReservations.get(tree.id) ?? 0)) {
        context.addIssue({ code: 'custom', path: ['trees', index, 'reservedBuffer'], message: 'Tree-buffer reservations must match active haul tasks.' });
      }
    });
    world.stoneDeposits.forEach((deposit, index) => {
      if (deposit.reservedBuffer !== (stoneReservations.get(deposit.id) ?? 0)) {
        context.addIssue({ code: 'custom', path: ['stoneDeposits', index, 'reservedBuffer'], message: 'Stone-buffer reservations must match active haul tasks.' });
      }
    });
    world.buildings.forEach((building, index) => {
      const expected = buildingInbound.get(building.id)!;
      if (building.inTransitWood !== expected.wood || building.inTransitStone !== expected.stone) {
        context.addIssue({ code: 'custom', path: ['buildings', index], message: 'Worksite inbound reservations must match active haul tasks.' });
      }
    });
  }
  world.residents.forEach((resident, index) => {
    const task = resident.task;
    if (task?.kind !== 'gather-stone' || task.buildingId === undefined) return;
    const building = buildings.get(task.buildingId);
    const order = world.buildOrders.find((candidate) => candidate.id === task.orderId);
    if (!building || building.kind !== 'workshop' || !order || order.buildingId !== building.id ||
        order.status === 'cancelled' || order.status === 'completed') {
      context.addIssue({ code: 'custom', path: ['residents', index, 'task', 'buildingId'],
        message: 'Direct stone cargo must target an active workshop order.' });
    }
  });
  world.buildings.forEach((building, index) => {
    if (!linkedBuildings.has(building.id)) context.addIssue({ code: 'custom', path: ['buildings', index, 'orderId'], message: 'Every building must have a saved construction order.' });
      if (building.reservedReturnWood > building.reservedWood || building.reservedReturnStone > building.reservedStone) {
        context.addIssue({ code: 'custom', path: ['buildings', index], message: 'Material return reservations cannot exceed worksite stock.' });
      }
      const returns = buildingReturns.get(building.id)!;
      if (building.reservedReturnWood !== returns.wood || building.reservedReturnStone !== returns.stone) {
        context.addIssue({ code: 'custom', path: ['buildings', index], message: 'Worksite return reservations must match active return hauls.' });
      }
  });
}).transform((world) => {
  const isLegacySingleStorage = world.storages?.length === 1 && !world.residents.some((resident) => resident.workRole === 'hauler');
  const storages = isLegacySingleStorage
    ? world.storages?.map((storage) => ({
      ...storage,
      contents: { ...world.resources },
      status: world.resources.wood + world.resources.stone >= storage.capacity ? 'full' as const : 'available' as const,
      blockedReason: null
    }))
    : world.storages;
  const primary = storages?.find((storage) => storage.id === world.storage.id) ?? storages?.[0];
  const resources = isLegacySingleStorage ? world.resources : storages?.reduce((total, storage) => ({
    wood: total.wood + storage.contents.wood,
    stone: total.stone + storage.contents.stone
  }), { wood: 0, stone: 0 }) ?? world.resources;
  return {
    ...world,
    storage: primary
      ? { id: primary.id, anchor: primary.anchor, footprint: primary.footprint, capacity: primary.capacity }
      : world.storage,
    ...(storages ? { storages } : {}),
    resources,
    residents: world.residents.map((resident) => ({
      ...resident,
      preferredStorageId: resident.preferredStorageId ?? null,
      preferredHaulSourceId: resident.preferredHaulSourceId ?? null
    }))
  };
});
export type PeaceWorldSnapshot = z.infer<typeof PeaceWorldSnapshotSchema>;

export function ensurePhysicalStorageSnapshot(world: PeaceWorldSnapshot): PeaceWorldSnapshot {
  if (world.storages?.length) return PeaceWorldSnapshotSchema.parse(world);
  const total = world.resources.wood + world.resources.stone;
  return PeaceWorldSnapshotSchema.parse({
    ...world,
    storages: [{
      id: world.storage.id,
      name: 'Склад',
      kind: 'warehouse',
      anchor: world.storage.anchor,
      footprint: world.storage.footprint,
      capacity: world.storage.capacity,
      contents: { ...world.resources },
      reservedInbound: { wood: 0, stone: 0 },
      reservedOutbound: { wood: 0, stone: 0 },
      status: total >= world.storage.capacity ? 'full' : 'available',
      blockedReason: null
    }]
  });
}
