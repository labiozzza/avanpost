import type { Kysely, Transaction } from 'kysely';
import type { WorldBalance } from '../balance';
import type {
  BuildingMaterialTable,
  BuildingBufferTable,
  BuildingTable,
  CraftOrderTable,
  DB,
  HaulTaskTable,
  LaborerTable,
  ResourceNodeTable,
  ResearchProjectTable,
  ResidentTable,
  StorageItemTable,
  StorageTable,
  TransferTaskTable
} from '../db/schema';

/**
 * In-memory world for one catch-up run (ADR-0005). The world_state row lock is
 * held for the whole run, so this memory image is the only writer: systems
 * mutate these rows in place and `flush()` persists the post-run state inside
 * the same locked transaction. Per-tick SQL round-trips disappear while the
 * per-tick evaluation order stays identical (ADR-0005 D07): a period can be
 * split across runs and still produce the same end state.
 */

export interface BuildingWithMaterials extends BuildingTable {
  materials: BuildingMaterialTable[];
}

export const TERMINAL_HAUL = new Set(['complete', 'failed', 'blocked']);
export const TERMINAL_TRANSFER = new Set(['complete', 'failed']);
const CRAFT_PLANNABLE = new Set(['active', 'blocked', 'complete', 'cancelled']);

/** Tables whose row key is not a single `id` column. */
type CompositeKey = { columns: string[] };
const KEY_BY_TABLE: Partial<Record<keyof DB, { id?: false; columns: string[]; updatedAt?: boolean }>> = {
  storage_item: { columns: ['storage_id', 'item'], updatedAt: false },
  building_buffer: { columns: ['building_id', 'item'], updatedAt: false },
  building_material: { columns: ['building_id', 'item'], updatedAt: false },
  storage: { columns: ['id'], updatedAt: false },
  resource_node: { columns: ['id'], updatedAt: false },
  laborer: { columns: ['id'], updatedAt: false },
  resident: { columns: ['id'], updatedAt: false },
  haul_task: { columns: ['id'] },
  transfer_task: { columns: ['id'] },
  craft_order: { columns: ['id'] },
  building: { columns: ['id'] },
  research_project: { columns: ['id'] }
};

export class WorldRun {
  readonly ownerId: string;
  readonly balance: WorldBalance;
  /** Reference timestamp of the catch-up; new rows created during the run use it. */
  now: Date = new Date();

  storages: StorageTable[] = [];
  storageItems: StorageItemTable[] = [];
  nodes: ResourceNodeTable[] = [];
  laborers: LaborerTable[] = [];
  buildings: BuildingWithMaterials[] = [];
  buffers: BuildingBufferTable[] = [];
  haulTasks: HaulTaskTable[] = [];
  transferTasks: TransferTaskTable[] = [];
  craftOrders: CraftOrderTable[] = [];
  residents: ResidentTable[] = [];
  researchProject: ResearchProjectTable | null = null;
  researchPoints = 0;
  researchedTechs: Set<string> = new Set();
  lastMigrationTick: number | null = null;
  migrationDirty = false;
  firstSectorId: string | null = null;
  spawn: { x: number; y: number } | null = null;

  private baseline = new Map<object, string>();
  private addedRows: { table: keyof DB; values: object }[] = [];
  private playersClean = true;
  private insertedTechnologies = new Set<string>();

  private constructor(ownerId: string, balance: WorldBalance) {
    this.ownerId = ownerId;
    this.balance = balance;
  }

  static async load(
    trx: Kysely<DB> | Transaction<DB>,
    ownerId: string,
    balance: WorldBalance,
    now: Date
  ): Promise<WorldRun> {
    const run = new WorldRun(ownerId, balance);
    run.now = now;

    const [
      storageRows,
      storageItemRows,
      nodeRows,
      laborerRows,
      buildingRows,
      materialRows,
      bufferRows,
      haulRows,
      transferRows,
      craftRows,
      residentRows,
      projectRow,
      techRows,
      playerRow,
      stateRow,
      sectorRow,
      spawnRow
    ] = await Promise.all([
      trx
        .selectFrom('storage')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .orderBy('type')
        .orderBy('x')
        .execute(),
      trx
        .selectFrom('storage_item')
        .selectAll()
        .where('storage_id', 'in', (qb) =>
          qb.selectFrom('storage').select('id').where('owner_id', '=', ownerId)
        )
        .execute(),
      trx
        .selectFrom('resource_node')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .orderBy('kind')
        .execute(),
      trx
        .selectFrom('laborer')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .orderBy('created_at')
        .execute(),
      trx
        .selectFrom('building')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .orderBy('created_at')
        .execute(),
      trx
        .selectFrom('building_material')
        .selectAll()
        .where('building_id', 'in', (qb) =>
          qb.selectFrom('building').select('id').where('owner_id', '=', ownerId)
        )
        .orderBy('item')
        .execute(),
      trx
        .selectFrom('building_buffer')
        .selectAll()
        .where('building_id', 'in', (qb) =>
          qb.selectFrom('building').select('id').where('owner_id', '=', ownerId)
        )
        .execute(),
      trx
        .selectFrom('haul_task')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .where('status', 'not in', Array.from(TERMINAL_HAUL))
        .orderBy('created_at')
        .execute(),
      trx
        .selectFrom('transfer_task')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .where('status', 'not in', Array.from(TERMINAL_TRANSFER))
        .orderBy('created_at')
        .execute(),
      trx
        .selectFrom('craft_order')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .orderBy('created_at')
        .execute(),
      trx
        .selectFrom('resident')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .orderBy('created_at')
        .execute(),
      trx
        .selectFrom('research_project')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .where('status', 'in', ['active', 'paused'])
        .executeTakeFirst(),
      trx
        .selectFrom('researched_technology')
        .select(['technology_id'])
        .where('owner_id', '=', ownerId)
        .execute(),
      trx
        .selectFrom('players')
        .select(['research_points'])
        .where('id', '=', ownerId)
        .executeTakeFirst(),
      trx
        .selectFrom('world_state')
        .select(['last_migration_tick'])
        .where('owner_id', '=', ownerId)
        .executeTakeFirst(),
      trx
        .selectFrom('world_sector')
        .select(['id'])
        .where('owner_id', '=', ownerId)
        .orderBy('x')
        .orderBy('y')
        .executeTakeFirst(),
      trx
        .selectFrom('storage')
        .select(['x', 'y'])
        .where('owner_id', '=', ownerId)
        .orderBy('created_at')
        .executeTakeFirst()
    ]);

    run.storages = storageRows as StorageTable[];
    run.storageItems = storageItemRows;
    run.nodes = nodeRows as ResourceNodeTable[];
    run.laborers = laborerRows as LaborerTable[];
    run.haulTasks = (haulRows as HaulTaskTable[]).map((row) => ({
      ...row,
      path_to_source:
        typeof row.path_to_source === 'string'
          ? row.path_to_source
          : JSON.stringify(row.path_to_source ?? []),
      path_to_storage:
        typeof row.path_to_storage === 'string'
          ? row.path_to_storage
          : JSON.stringify(row.path_to_storage ?? [])
    }));
    run.transferTasks = (transferRows as TransferTaskTable[]).map((row) => ({
      ...row,
      path_from:
        typeof row.path_from === 'string'
          ? row.path_from
          : JSON.stringify(row.path_from ?? []),
      path_to:
        typeof row.path_to === 'string'
          ? row.path_to
          : JSON.stringify(row.path_to ?? [])
    }));
    run.craftOrders = craftRows.filter((row) => CRAFT_PLANNABLE.has(row.status));
    run.residents = (residentRows as ResidentTable[]).map((row) => ({
      ...row,
      traits:
        typeof row.traits === 'string'
          ? row.traits
          : JSON.stringify(row.traits ?? []),
      schools:
        typeof row.schools === 'string'
          ? row.schools
          : JSON.stringify(row.schools ?? [])
    }));
    run.researchProject = projectRow ?? null;
    run.researchedTechs = new Set(techRows.map((row) => row.technology_id));
    run.researchPoints = playerRow?.research_points ?? 0;
    run.lastMigrationTick = stateRow?.last_migration_tick ?? null;
    run.firstSectorId = sectorRow?.id ?? null;
    run.spawn = spawnRow ? { x: spawnRow.x, y: spawnRow.y } : null;

    const materialsByBuilding = new Map<string, BuildingMaterialTable[]>();
    for (const material of materialRows as BuildingMaterialTable[]) {
      const list = materialsByBuilding.get(material.building_id) ?? [];
      list.push(material);
      materialsByBuilding.set(material.building_id, list);
    }
    run.buildings = (buildingRows as BuildingTable[]).map((building) => ({
      ...building,
      materials: materialsByBuilding.get(building.id) ?? []
    }));

    for (const row of run.storages) run.baseline.set(row, JSON.stringify(row));
    for (const row of run.storageItems) run.baseline.set(row, JSON.stringify(row));
    for (const row of run.nodes) run.baseline.set(row, JSON.stringify(row));
    for (const row of run.laborers) run.baseline.set(row, JSON.stringify(row));
    for (const buffer of bufferRows as BuildingBufferTable[]) {
      run.buffers.push(buffer);
      run.baseline.set(buffer, JSON.stringify(buffer));
    }
    for (const row of run.buildings) run.baseline.set(row, JSON.stringify(row));
    for (const building of run.buildings) {
      for (const material of building.materials) {
        run.baseline.set(material, JSON.stringify(material));
      }
    }
    for (const row of run.haulTasks) run.baseline.set(row, JSON.stringify(row));
    for (const row of run.transferTasks) run.baseline.set(row, JSON.stringify(row));
    for (const row of run.craftOrders) run.baseline.set(row, JSON.stringify(row));
    for (const row of run.residents) run.baseline.set(row, JSON.stringify(row));
    if (run.researchProject) run.baseline.set(run.researchProject, JSON.stringify(run.researchProject));

    return run;
  }

  /** Buildings filtered by status, preserving creation order (loadBuildings semantics). */
  buildingsByStatus(statuses: BuildingTable['status'][]): BuildingWithMaterials[] {
    if (statuses.length === 0) return this.buildings;
    return this.buildings.filter((building) => statuses.includes(building.status));
  }

  findStorageItem(storageId: string, item: string): StorageItemTable | undefined {
    return this.storageItems.find(
      (row) => row.storage_id === storageId && row.item === item
    );
  }

  storageQty(storageId: string, item: string): number {
    return this.findStorageItem(storageId, item)?.qty ?? 0;
  }

  takeStorageItem(storageId: string, item: string, qty: number, volume: number): void {
    const existing = this.findStorageItem(storageId, item);
    const storage = this.storages.find((row) => row.id === storageId);
    if (!existing || !storage) throw new Error('storage item not found');
    if (existing.qty < qty || storage.volume < volume) throw new Error('insufficient storage quantity');
    existing.qty -= qty;
    storage.volume -= volume;
  }

  addStorageItem(storageId: string, item: string, qty: number, volume: number): void {
    const storage = this.storages.find((row) => row.id === storageId);
    if (!storage) return;
    const existing = this.findStorageItem(storageId, item);
    if (existing) existing.qty += qty;
    else {
      const row = { storage_id: storageId, item, qty };
      this.storageItems.push(row);
      this.addedRows.push({ table: 'storage_item', values: row });
    }
    if (storage.volume + volume > storage.capacity) throw new Error('storage capacity exceeded');
    storage.volume += volume;
    storage.reserved = Math.max(0, storage.reserved - volume);
  }

  addBuffer(buildingId: string, item: string, qty: number): BuildingBufferTable {
    const existing = this.buffers.find(
      (buffer) => buffer.building_id === buildingId && buffer.item === item
    );
    if (existing) {
      existing.qty += qty;
      return existing;
    }
    const row: BuildingBufferTable = {
      building_id: buildingId,
      item,
      qty,
      reserved: 0
    } as BuildingBufferTable;
    this.buffers.push(row);
    this.addedRows.push({ table: 'building_buffer', values: row });
    return row;
  }

  bufferFor(buildingId: string, item: string): BuildingBufferTable | undefined {
    return this.buffers.find(
      (buffer) => buffer.building_id === buildingId && buffer.item === item
    );
  }

  /** Residents in school cannot take production or logistics tasks. */
  residentIsAvailable(residentId: string | null): boolean {
    if (!residentId) return true;
    const resident = this.residents.find((row) => row.id === residentId);
    return !resident || resident.status !== 'school';
  }

  availableLaborers(role: LaborerTable['role']): LaborerTable[] {
    return this.laborers.filter(
      (laborer) =>
        laborer.role === role &&
        laborer.status === 'idle' &&
        this.residentIsAvailable(laborer.resident_id)
    );
  }

  addHaulTask(task: HaulTaskTable): void {
    this.haulTasks.push(task);
    this.addedRows.push({ table: 'haul_task', values: task });
  }

  addTransferTask(task: TransferTaskTable): void {
    this.transferTasks.push(task);
    this.addedRows.push({ table: 'transfer_task', values: task });
  }

  addResident(resident: ResidentTable): void {
    this.residents.push(resident);
    this.addedRows.push({ table: 'resident', values: resident });
  }

  addLaborer(laborer: LaborerTable): void {
    this.laborers.push(laborer);
    this.addedRows.push({ table: 'laborer', values: laborer });
  }

  markTechnologyResearched(technologyId: string): void {
    if (this.researchedTechs.has(technologyId)) return;
    this.researchedTechs.add(technologyId);
    this.insertedTechnologies.add(technologyId);
  }

  addResearchPoints(amount: number): void {
    if (amount === 0) return;
    this.playersClean = false;
    this.researchPoints += amount;
  }

  setMigrationTick(tick: number): void {
    if (this.lastMigrationTick === tick) return;
    this.lastMigrationTick = tick;
    this.migrationDirty = true;
  }

  private flushable(row: object): object {
    if (!('materials' in row)) return row;
    const { materials: _ignored, ...plain } = row as BuildingWithMaterials;
    return plain;
  }

  /** Write the memory image back inside the same locked transaction. */
  async flush(trx: Transaction<DB>): Promise<void> {
    for (const { table, values } of this.addedRows) {
      await trx
        .insertInto(table as never)
        .values(this.flushable(values) as never)
        .execute();
    }
    this.addedRows = [];

    for (const technologyId of this.insertedTechnologies) {
      await trx
        .insertInto('researched_technology')
        .values({
          owner_id: this.ownerId,
          technology_id: technologyId,
          researched_at: this.now
        })
        .onConflict((oc) => oc.columns(['owner_id', 'technology_id']).doNothing())
        .execute();
    }
    this.insertedTechnologies = new Set();

    const persist = async (row: object, table: keyof DB): Promise<void> => {
      const baseline = this.baseline.get(row);
      if (baseline && baseline === JSON.stringify(row)) return;
      const key = KEY_BY_TABLE[table] ?? { columns: ['id'] };
      if (key.updatedAt !== false) {
        (row as { updated_at?: Date }).updated_at = this.now;
      }
      const plain = this.flushable(row) as Record<string, unknown>;
      let query = trx
        .updateTable(table as never)
        .set(plain as never);
      for (const column of key.columns) {
        query = query.where(column as never, '=', plain[column] as never);
      }
      await query.execute();
      this.baseline.set(row, JSON.stringify(row));
    };

    for (const row of this.storages) await persist(row, 'storage');
    for (const row of this.storageItems) await persist(row, 'storage_item');
    for (const row of this.nodes) await persist(row, 'resource_node');
    for (const row of this.laborers) await persist(row, 'laborer');
    for (const building of this.buildings) await persist(building, 'building');
    for (const building of this.buildings) {
      for (const material of building.materials) await persist(material, 'building_material');
    }
    for (const row of this.buffers) await persist(row, 'building_buffer');
    for (const row of this.haulTasks) await persist(row, 'haul_task');
    for (const row of this.transferTasks) await persist(row, 'transfer_task');
    for (const row of this.craftOrders) await persist(row, 'craft_order');
    for (const row of this.residents) await persist(row, 'resident');
    if (this.researchProject) await persist(this.researchProject, 'research_project');

    if (!this.playersClean) {
      await trx
        .updateTable('players')
        .set({ research_points: this.researchPoints })
        .where('id', '=', this.ownerId)
        .execute();
      this.playersClean = true;
    }

    if (this.migrationDirty && this.lastMigrationTick !== null) {
      await trx
        .updateTable('world_state')
        .set({ last_migration_tick: this.lastMigrationTick })
        .where('owner_id', '=', this.ownerId)
        .execute();
      this.migrationDirty = false;
    }
  }
}
