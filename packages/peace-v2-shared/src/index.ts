import { z } from 'zod';
export const PEACE_WORLD_SCHEMA_VERSION = 8;
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
  G33StoneBalance,
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
export const PeaceWorkRoleSchema = z.enum(['none', 'woodcutter', 'builder', 'stone_miner', 'hauler']);
export type PeaceWorkRole = z.infer<typeof PeaceWorkRoleSchema>;
export const PeaceCargoItemSchema = z.enum(['wood', 'stone']);
export type PeaceCargoItem = z.infer<typeof PeaceCargoItemSchema>;

export const PeaceResourceQuantitiesSchema = z.object({
  wood: z.number().int().safe().nonnegative(),
  stone: z.number().int().safe().nonnegative()
}).strict();

export const PeaceStorageSchema = z.object({
  id: EntityIdSchema,
  name: z.string().min(1),
  kind: z.literal('warehouse'),
  anchor: GlobalCoordinateSchema,
  footprint: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
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
  state: z.enum(['planned', 'waiting_materials', 'waiting_builder', 'in_progress', 'foundation', 'scaffold', 'complete', 'cancelled', 'idle', 'operating', 'blocked'])
}).strict();

export const PeaceBuildOrderSchema = z.object({
  id: EntityIdSchema,
  buildingId: EntityIdSchema,
  queuePosition: z.number().int().safe().nonnegative(),
  status: z.enum(['waiting_materials', 'waiting_builder', 'waiting_path', 'in_progress', 'completed', 'cancelled', 'blocked']),
  assignedResidentId: PeaceResidentIdSchema.nullable(),
  blockedReason: z.string().nullable(),
  // Deprecated G3.4 field; retained to parse old saves and normalized by the dispatcher.
  requiresExplicitBuilder: z.boolean().optional()
}).strict();
export type PeaceBuildOrder = z.infer<typeof PeaceBuildOrderSchema>;

export const PeaceTreeNodeSchema = z.object({
  id: EntityIdSchema,
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
    'hauling_to_worksite', 'hauling_unloading', 'waiting_haul', 'blocked', 'dig', 'climb', 'study'
  ]),
  cargo: z.number().int().safe().nonnegative().optional(),
  cargoItemId: PeaceCargoItemSchema.nullable().optional()
}).strict();

export const ReadOnlyWorldPreviewSchema = z.object({
  revision: WorldRevisionSchema,
  cells: z.array(PreviewCellSchema),
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

export const HaulTaskSchema = WorkerTaskBaseSchema.extend({
  kind: z.literal('haul'),
  phase: z.enum(['walking_to_source', 'loading', 'carrying', 'unloading', 'waiting_source', 'waiting_storage', 'waiting_path', 'blocked']),
  sourceKind: z.enum(['tree-buffer', 'stone-buffer', 'storage']),
  sourceId: EntityIdSchema,
  destinationKind: z.enum(['storage', 'building']),
  destinationId: EntityIdSchema,
  orderId: EntityIdSchema.optional(),
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

export const PeaceWorkerTaskSchema = z.discriminatedUnion('kind', [
  GatherWoodTaskSchema, GatherStoneTaskSchema, HaulTaskSchema, BuildCabinTaskSchema, BuildWorkshopTaskSchema
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
    'hauling_to_worksite', 'hauling_unloading', 'waiting_haul', 'blocked'
  ]),
  cargo: z.number().int().safe().nonnegative(),
  cargoItemId: PeaceCargoItemSchema.nullable(),
  preferredStorageId: EntityIdSchema.nullable().default(null),
  preferredHaulSourceId: EntityIdSchema.nullable().default(null),
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

export const PeaceBuildingSchema = z.object({
  id: EntityIdSchema,
  kind: z.enum(['cabin', 'workshop']),
  orderId: EntityIdSchema,
  anchor: GlobalCoordinateSchema,
  footprint: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  state: z.enum(['planned', 'waiting_materials', 'waiting_builder', 'in_progress', 'foundation', 'scaffold', 'complete', 'cancelled', 'blocked']),
  progressTicks: z.number().int().safe().nonnegative(),
  progressRequired: z.number().int().safe().positive(),
  reservedWood: z.number().int().safe().nonnegative(),
  reservedStone: z.number().int().safe().nonnegative(),
  inTransitWood: z.number().int().safe().nonnegative().default(0),
  inTransitStone: z.number().int().safe().nonnegative().default(0)
}).strict();
export type PeaceBuilding = z.infer<typeof PeaceBuildingSchema>;

export const PeaceWorldSnapshotSchema = z.object({
  revision: WorldRevisionSchema,
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
  trees: z.array(PeaceTreeNodeSchema).min(1),
  stoneDeposits: z.array(PeaceStoneDepositSchema).min(1),
  residents: PeaceResidentListSchema,
  buildOrders: PeaceBuildOrderListSchema,
  nextBuildOrderSequence: z.number().int().safe().positive(),
  buildings: z.array(PeaceBuildingSchema)
}).strict().superRefine((world, context) => {
  const legacySingleStorage = !world.storages ||
    world.storages.length === 1 && !world.residents.some((resident) => resident.workRole === 'hauler');
  if (legacySingleStorage && world.resources.wood + world.resources.stone > world.storage.capacity) {
    context.addIssue({ code: 'custom', path: ['resources'], message: 'Combined stored resources cannot exceed shared storage capacity.' });
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
    if (task.sourceKind === 'tree-buffer' && !treeIds.has(task.sourceId)) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'task', 'sourceId'], message: 'Haul source tree must exist.' });
    }
    if (task.sourceKind === 'stone-buffer' && !stoneIds.has(task.sourceId)) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'task', 'sourceId'], message: 'Haul source deposit must exist.' });
    }
    if (task.sourceKind === 'storage' && world.storages && !storageIds.has(task.sourceId)) {
      context.addIssue({ code: 'custom', path: ['residents', index, 'task', 'sourceId'], message: 'Haul source warehouse must exist.' });
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
