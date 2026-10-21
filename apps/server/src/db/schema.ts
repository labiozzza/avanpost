import type { Generated } from 'kysely';
import type { SectorStatus, TerrainType, Transport } from '@avanpost/shared';

export interface PlayersTable {
  id: string;
  created_at: Date;
  last_active_at: Date;
  current_phase: 'peace' | 'war';
  display_name: string | null;
}

export interface SessionsTable {
  token_hash: string;
  player_id: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
}

export interface WorldSectorTable {
  id: string;
  owner_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  biome: string;
  status: SectorStatus;
  seed: number;
  created_at: Date;
}

export interface WorldStateTable {
  owner_id: string;
  tick: number;
  version: number;
  world_seed: number;
  last_migration_tick: number;
  updated_at: Date;
}

export interface TerrainCellTable {
  sector_id: string;
  x: number;
  y: number;
  terrain_type: TerrainType;
  obstacle: boolean;
  passable: boolean;
}

export interface ClearingJobTable {
  id: string;
  owner_id: string;
  sector_id: string;
  x: number;
  y: number;
  work_done: number;
  work_required: number;
  status: 'active' | 'done';
  created_at: Date;
  updated_at: Date;
}

export interface StorageTable {
  id: string;
  owner_id: string;
  sector_id: string;
  type: string;
  x: number;
  y: number;
  capacity: number;
  volume: number;
  reserved: number;
  created_at: Date;
}

export interface StorageItemTable {
  storage_id: string;
  item: string;
  qty: number;
}

export interface ResourceNodeTable {
  id: string;
  owner_id: string;
  sector_id: string;
  kind: string;
  item: string;
  x: number;
  y: number;
  amount: number;
  max_amount: number;
  renewable: boolean;
  regen_per_tick: number;
  yield_per_tick: number;
  buffer: number;
  buffer_reserved: number;
  buffer_capacity: number;
  active: boolean;
  gatherer_id: string | null;
  created_at: Date;
}

export interface LaborerTable {
  id: string;
  owner_id: string;
  sector_id: string;
  role: 'gatherer' | 'carrier' | 'builder';
  status: 'idle' | 'gathering' | 'hauling' | 'building';
  transport: Transport;
  x: number;
  y: number;
  node_id: string | null;
  resident_id: string | null;
  created_at: Date;
}

export interface HaulTaskTable {
  id: string;
  owner_id: string;
  node_id: string;
  storage_id: string;
  item: string;
  qty: number;
  carrier_id: string | null;
  status: string;
  path_to_source: unknown;
  path_to_storage: unknown;
  path_index: number;
  state_ticks: number;
  reserved_source: number;
  reserved_destination: number;
  created_at: Date;
  updated_at: Date;
}

export interface BuildingTable {
  id: string;
  owner_id: string;
  sector_id: string;
  type: string;
  x: number;
  y: number;
  status: 'awaiting_materials' | 'building' | 'complete' | 'demolition' | 'demolished';
  work_done: number;
  work_required: number;
  workers_limit: number;
  builder_id: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface BuildingMaterialTable {
  building_id: string;
  item: string;
  required: number;
  delivered: number;
}

export interface TransferTaskTable {
  id: string;
  owner_id: string;
  building_id: string;
  storage_id: string;
  direction: 'to_building' | 'to_storage';
  item: string;
  qty: number;
  carrier_id: string | null;
  status: string;
  path_from: unknown;
  path_to: unknown;
  path_index: number;
  state_ticks: number;
  created_at: Date;
  updated_at: Date;
}

export interface ResidentTable {
  id: string;
  owner_id: string;
  name: string;
  traits: unknown;
  schools: unknown;
  profession: string;
  xp: number;
  status: 'idle' | 'school';
  school_id: string | null;
  training_left_ticks: number;
  training_total_ticks: number;
  created_at: Date;
}

export interface CommandLogTable {
  player_id: string;
  request_id: string;
  command_type: string;
  payload: unknown;
  result: unknown;
  created_at: Date;
}

export interface OutboxEventTable {
  id: Generated<string>;
  player_id: string;
  event_type: string;
  payload: unknown;
  created_at: Date;
}

export interface DB {
  players: PlayersTable;
  sessions: SessionsTable;
  world_sector: WorldSectorTable;
  world_state: WorldStateTable;
  terrain_cell: TerrainCellTable;
  clearing_job: ClearingJobTable;
  storage: StorageTable;
  storage_item: StorageItemTable;
  resource_node: ResourceNodeTable;
  laborer: LaborerTable;
  haul_task: HaulTaskTable;
  building: BuildingTable;
  building_material: BuildingMaterialTable;
  transfer_task: TransferTaskTable;
  resident: ResidentTable;
  command_log: CommandLogTable;
  outbox_event: OutboxEventTable;
}
