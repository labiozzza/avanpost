import { z } from 'zod';

export const TERRAIN_TYPES = [
  'grass',
  'soil',
  'forest',
  'scree',
  'rock',
  'water'
] as const;
export type TerrainType = (typeof TERRAIN_TYPES)[number];

export const SECTOR_STATUSES = [
  'unknown',
  'unlockable',
  'unlocked',
  'clearing',
  'prepared',
  'occupied'
] as const;
export type SectorStatus = (typeof SECTOR_STATUSES)[number];

export const TRANSPORTS = ['person', 'cart'] as const;
export type Transport = (typeof TRANSPORTS)[number];

export interface ClearingProgress {
  workDone: number;
  workRequired: number;
}

export interface TerrainCell {
  x: number;
  y: number;
  type: TerrainType;
  obstacle: boolean;
  passable: boolean;
  reachable: boolean;
  cartReachable: boolean;
  clearable: boolean;
  clearing: ClearingProgress | null;
}

export interface PlayerSnapshot {
  id: string;
  createdAt: string;
  currentPhase: 'peace' | 'war';
}

export interface SectorSnapshot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  biome: string;
  status: SectorStatus;
  terrain: TerrainCell[];
}

export interface TerrainInfo {
  id: TerrainType;
  label: string;
  color: string;
  passable: boolean;
  cartPassable: boolean;
  clearable: boolean;
  clearingWork: number;
}

export interface BiomeInfo {
  id: string;
  label: string;
  tint: string;
}

export interface ItemInfo {
  id: string;
  label: string;
  category: string;
  volume: number;
  baseValue: number;
}

export interface StorageTypeInfo {
  id: string;
  label: string;
  capacity: number;
  categories: string[];
}

export interface NodeTypeInfo {
  id: string;
  label: string;
  item: string;
  tint: string;
}

export interface BuildingInfo {
  id: string;
  label: string;
  category: 'housing' | 'production' | 'storage' | 'infrastructure';
  description: string;
  buildWork: number;
  workersLimit: number;
  materials: Record<string, number>;
  walkable: boolean;
  cartPassable: boolean;
  moveCost: number | null;
  tint: string;
}

export interface CatalogInfo {
  balanceVersion: string;
  provenance: string;
  terrains: TerrainInfo[];
  biomes: BiomeInfo[];
  items: ItemInfo[];
  storageTypes: StorageTypeInfo[];
  nodeTypes: NodeTypeInfo[];
  buildings: BuildingInfo[];
  recipes: RecipeSnapshot[];
}

export interface SectorCost {
  wood: number;
  stone: number;
}

export interface FrontierSector {
  x: number;
  y: number;
  biome: string;
  cost: SectorCost;
  economyEnabled: boolean;
}

export interface ClearingTask {
  sectorId: string;
  sectorX: number;
  sectorY: number;
  x: number;
  y: number;
  terrain: TerrainType;
  workDone: number;
  workRequired: number;
  active: boolean;
}

export interface StoredItem {
  item: string;
  qty: number;
}

export interface StorageSnapshot {
  id: string;
  sectorId: string;
  type: string;
  label: string;
  x: number;
  y: number;
  capacity: number;
  volume: number;
  reserved: number;
  free: number;
  contents: StoredItem[];
}

export interface ResourceNodeSnapshot {
  id: string;
  sectorId: string;
  kind: string;
  label: string;
  item: string;
  x: number;
  y: number;
  amount: number;
  maxAmount: number;
  buffer: number;
  bufferCapacity: number;
  reserved: number;
  active: boolean;
  renewable: boolean;
  regenPerTick: number;
  yieldPerTick: number;
}

export const HAUL_STATES = [
  'queued',
  'reserved',
  'worker_to_source',
  'loading',
  'moving',
  'unloading',
  'complete',
  'blocked',
  'failed',
  'retryable'
] as const;
export type HaulState = (typeof HAUL_STATES)[number];

export interface HaulTaskSnapshot {
  id: string;
  item: string;
  qty: number;
  nodeId: string;
  storageId: string;
  carrierId: string | null;
  status: HaulState;
  path: Array<[number, number]>;
  pathIndex: number;
  stateTicks: number;
}

export interface LaborerSnapshot {
  id: string;
  role: 'gatherer' | 'carrier' | 'builder';
  status: 'idle' | 'gathering' | 'hauling' | 'building';
  transport: Transport;
  sectorId: string;
  x: number;
  y: number;
  taskId: string | null;
  nodeId: string | null;
  buildingId: string | null;
  residentId: string | null;
}

export const SCHOOL_IDS = ['gather', 'craft'] as const;
export type SchoolId = (typeof SCHOOL_IDS)[number];

export const PROFESSIONS = [
  'Разнорабочий',
  'Добытчик',
  'Ремесленник',
  'Каменотёс'
] as const;
export type Profession = (typeof PROFESSIONS)[number];

export const RESIDENT_STATES = ['idle', 'school'] as const;
export type ResidentState = (typeof RESIDENT_STATES)[number];

export interface ResidentTrainingSnapshot {
  schoolId: SchoolId;
  leftTicks: number;
  totalTicks: number;
}

export interface ResidentSnapshot {
  id: string;
  name: string;
  traits: string[];
  schools: SchoolId[];
  profession: Profession;
  xp: number;
  level: number;
  xpInto: number;
  xpSpan: number;
  xpToNext: number;
  state: ResidentState;
  training: ResidentTrainingSnapshot | null;
  laborerId: string | null;
}

export interface PopulationSnapshot {
  residents: number;
  capacity: number;
  freeSlots: number;
  migrationEnabled: boolean;
  nextArrivalInTicks: number;
}

export const BUILDING_STATUSES = [
  'awaiting_materials',
  'building',
  'complete',
  'demolition',
  'demolished'
] as const;
export type BuildingStatus = (typeof BUILDING_STATUSES)[number];

export interface BuildingMaterialSnapshot {
  item: string;
  required: number;
  delivered: number;
}

export interface BuildingSnapshot {
  id: string;
  sectorId: string;
  type: string;
  label: string;
  category: BuildingInfo['category'];
  description: string;
  x: number;
  y: number;
  status: BuildingStatus;
  workDone: number;
  workRequired: number;
  workersLimit: number;
  walkable: boolean;
  tint: string;
  materials: BuildingMaterialSnapshot[];
  createdAt: string;
  completedAt: string | null;
}

export const TRANSFER_STATES = [
  'queued',
  'reserved',
  'worker_to_source',
  'loading',
  'moving',
  'unloading',
  'complete',
  'failed'
] as const;
export type TransferState = (typeof TRANSFER_STATES)[number];

export interface TransferTaskSnapshot {
  id: string;
  direction: 'to_building' | 'to_storage' | 'to_buffer' | 'from_buffer';
  buildingId: string;
  storageId: string;
  item: string;
  qty: number;
  carrierId: string | null;
  status: TransferState;
  path: Array<[number, number]>;
  pathIndex: number;
  stateTicks: number;
}

export const CRAFT_ORDER_STATES = ['active', 'blocked', 'complete', 'cancelled'] as const;
export type CraftOrderState = (typeof CRAFT_ORDER_STATES)[number];

export interface CraftBufferEntrySnapshot {
  item: string;
  qty: number;
}

export interface CraftOrderSnapshot {
  id: string;
  buildingId: string;
  recipeId: string;
  label: string;
  workerId: string | null;
  progress: number;
  workRequired: number;
  status: CraftOrderState;
  inputs: CraftBufferEntrySnapshot[];
  outputs: CraftBufferEntrySnapshot[];
  bufferCapacity: number;
}

export interface ResearchStateSnapshot {
  enabled: boolean;
  points: number;
  pointsPerTick: number;
  active: {
    technologyId: string;
    progress: number;
    cost: number;
    scholarId: string | null;
    status: 'active' | 'paused';
  } | null;
  researched: string[];
}

export interface TechNodeSnapshot {
  id: string;
  label: string;
  description: string;
  root: boolean;
  requires: string[];
  cost: number;
  unlockRecipes: string[];
  researched: boolean;
  available: boolean;
  tint: string;
}

export interface RecipeSnapshot {
  id: string;
  label: string;
  station: string;
  requiredProfession: string;
  unlockTechnology: string;
  productionSeconds: number;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  tint: string;
}

export interface WorldStats {
  sectors: number;
  cells: number;
  reachable: number;
  cartReachable: number;
  blocked: number;
  activeClearings: number;
  clearedCells: number;
  preparedSectors: number;
  storageVolume: number;
  storageCapacity: number;
  activeHauls: number;
  activeTransfers: number;
  idleCarriers: number;
  activeNodes: number;
  buildings: number;
  buildingsComplete: number;
  builders: number;
  idleBuilders: number;
}

export interface WorldSnapshot {
  player: PlayerSnapshot;
  tick: number;
  version: number;
  tickMillis: number;
  sectors: SectorSnapshot[];
  frontier: FrontierSector[];
  clearingTasks: ClearingTask[];
  storages: StorageSnapshot[];
  nodes: ResourceNodeSnapshot[];
  haulTasks: HaulTaskSnapshot[];
  buildings: BuildingSnapshot[];
  transferTasks: TransferTaskSnapshot[];
  laborers: LaborerSnapshot[];
  residents: ResidentSnapshot[];
  population: PopulationSnapshot;
  craftOrders: CraftOrderSnapshot[];
  research: ResearchStateSnapshot;
  techTree: TechNodeSnapshot[];
  economyEnabled: boolean;
  stats: WorldStats;
  catalog: CatalogInfo;
  serverTime: string;
  simVersion: string;
  buildVersion: string;
}

export const AdvanceCommandSchema = z.object({
  request_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative()
});

export type AdvanceCommand = z.infer<typeof AdvanceCommandSchema>;

export const UnlockSectorCommandSchema = z.object({
  request_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
  sector_x: z.number().int(),
  sector_y: z.number().int()
});

export type UnlockSectorCommand = z.infer<typeof UnlockSectorCommandSchema>;

export const GatherNodeCommandSchema = z.object({
  request_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
  node_id: z.string().uuid()
});

export type GatherNodeCommand = z.infer<typeof GatherNodeCommandSchema>;

export const StopGatherCommandSchema = z.object({
  request_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
  node_id: z.string().uuid()
});

export type StopGatherCommand = z.infer<typeof StopGatherCommandSchema>;

export const BuildCommandSchema = z.object({
  request_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
  building_type: z.string().min(1),
  sector_id: z.string().uuid(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative()
});

export type BuildCommand = z.infer<typeof BuildCommandSchema>;

export const DemolishCommandSchema = z.object({
  request_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
  building_id: z.string().uuid()
});

export type DemolishCommand = z.infer<typeof DemolishCommandSchema>;

export const ClearCellCommandSchema = z.object({
  request_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
  sector_id: z.string().uuid(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative()
});

export type ClearCellCommand = z.infer<typeof ClearCellCommandSchema>;

export const SendSchoolCommandSchema = z.object({
  request_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
  resident_id: z.string().uuid(),
  school: z.enum(SCHOOL_IDS)
});

export type SendSchoolCommand = z.infer<typeof SendSchoolCommandSchema>;

export const StartCraftCommandSchema = z.object({
  request_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
  building_id: z.string().uuid(),
  recipe_id: z.string().min(1),
  worker_id: z.string().uuid()
});

export type StartCraftCommand = z.infer<typeof StartCraftCommandSchema>;

export const CancelCraftCommandSchema = z.object({
  request_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
  building_id: z.string().uuid()
});

export type CancelCraftCommand = z.infer<typeof CancelCraftCommandSchema>;

export const StartResearchCommandSchema = z.object({
  request_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
  technology_id: z.string().min(1),
  scholar_id: z.string().uuid().nullable().optional()
});

export type StartResearchCommand = z.infer<typeof StartResearchCommandSchema>;

export const CancelResearchCommandSchema = z.object({
  request_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative()
});

export type CancelResearchCommand = z.infer<typeof CancelResearchCommandSchema>;

export interface CommandResponse {
  snapshot: WorldSnapshot;
  replayed: boolean;
}

export type AdvanceResponse = CommandResponse;
export type UnlockSectorResponse = CommandResponse;
export type ClearCellResponse = CommandResponse;
export type GatherNodeResponse = CommandResponse;
export type StopGatherResponse = CommandResponse;
export type BuildResponse = CommandResponse;
export type DemolishResponse = CommandResponse;
export type SendSchoolResponse = CommandResponse;
export type StartCraftResponse = CommandResponse;
export type CancelCraftResponse = CommandResponse;
export type StartResearchResponse = CommandResponse;
export type CancelResearchResponse = CommandResponse;

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export const ErrorCode = {
  NO_SESSION: 'NO_SESSION',
  STALE_VERSION: 'STALE_VERSION',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SECTOR_NOT_FOUND: 'SECTOR_NOT_FOUND',
  SECTOR_EXISTS: 'SECTOR_EXISTS',
  NOT_ADJACENT: 'NOT_ADJACENT',
  PATH_BLOCKED: 'PATH_BLOCKED',
  TERRAIN_NOT_FOUND: 'TERRAIN_NOT_FOUND',
  NOT_CLEARABLE: 'NOT_CLEARABLE',
  ALREADY_CLEARED: 'ALREADY_CLEARED',
  CLEARING_ALREADY_STARTED: 'CLEARING_ALREADY_STARTED',
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  NODE_DEPLETED: 'NODE_DEPLETED',
  ALREADY_GATHERING: 'ALREADY_GATHERING',
  NOT_GATHERING: 'NOT_GATHERING',
  NO_IDLE_GATHERER: 'NO_IDLE_GATHERER',
  INSUFFICIENT_RESOURCE: 'INSUFFICIENT_RESOURCE',
  BUILDING_NOT_FOUND: 'BUILDING_NOT_FOUND',
  BUILDING_TYPE_NOT_FOUND: 'BUILDING_TYPE_NOT_FOUND',
  BUILDING_NOT_COMPLETE: 'BUILDING_NOT_COMPLETE',
  BUILDING_BUSY: 'BUILDING_BUSY',
  CELL_OCCUPIED: 'CELL_OCCUPIED',
  NOT_BUILDABLE: 'NOT_BUILDABLE',
  SECTOR_NOT_SUPPORTED: 'SECTOR_NOT_SUPPORTED',
  RESIDENT_NOT_FOUND: 'RESIDENT_NOT_FOUND',
  RESIDENT_IN_SCHOOL: 'RESIDENT_IN_SCHOOL',
  SCHOOL_ALREADY_LEARNED: 'SCHOOL_ALREADY_LEARNED',
  RECIPE_NOT_FOUND: 'RECIPE_NOT_FOUND',
  RECIPE_LOCKED: 'RECIPE_LOCKED',
  CRAFT_ALREADY_ACTIVE: 'CRAFT_ALREADY_ACTIVE',
  CRAFT_NOT_FOUND: 'CRAFT_NOT_FOUND',
  WRONG_PROFESSION: 'WRONG_PROFESSION',
  TECHNOLOGY_NOT_FOUND: 'TECHNOLOGY_NOT_FOUND',
  TECHNOLOGY_NOT_AVAILABLE: 'TECHNOLOGY_NOT_AVAILABLE',
  RESEARCH_ALREADY_ACTIVE: 'RESEARCH_ALREADY_ACTIVE',
  RESEARCH_NOT_FOUND: 'RESEARCH_NOT_FOUND',
  RESEARCH_DISABLED: 'RESEARCH_DISABLED',
  INTERNAL: 'INTERNAL'
} as const;

export type ErrorCodeName = (typeof ErrorCode)[keyof typeof ErrorCode];
