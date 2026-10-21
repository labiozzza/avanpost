import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { TERRAIN_TYPES, PROFESSIONS, type CatalogInfo, type TerrainType } from '@avanpost/shared';
import type { BiomeRule, TerrainRule } from '@avanpost/sim';

const terrainSchema = z.object({
  label: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  passable: z.boolean(),
  cart_passable: z.boolean(),
  move_cost: z.number().int().min(1),
  clearable: z.boolean(),
  clearing_work: z.number().int().min(0),
  becomes: z.enum(TERRAIN_TYPES).nullable()
});

const biomeSchema = z.object({
  label: z.string().min(1),
  tint: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  weight: z.number().min(0),
  terrain_weights: z.record(z.string(), z.number().min(0))
});

const balanceSchema = z.object({
  meta: z.object({
    version: z.union([z.string(), z.number()]).transform(String),
    provenance: z.string().min(1),
    source: z.string().min(1),
    updated: z.string().min(1)
  }),
  sectors: z.object({
    width: z.number().int().min(8),
    height: z.number().int().min(8),
    max_depth: z.number().int().min(1),
    unlock: z.object({
      adjacent_only: z.boolean(),
      cost: z.object({
        wood: z.number().int().min(0),
        stone: z.number().int().min(0)
      })
    })
  }),
  biomes: z.record(z.string(), biomeSchema),
  terrain: z.record(z.string(), terrainSchema),
  pathing: z.object({
    transports: z.array(z.enum(['person', 'cart'])).min(1),
    diagonal: z.boolean()
  }),
  clearing: z.object({
    work_per_tick: z.number().int().min(1),
    max_tasks: z.number().int().min(1),
    stamp_outcrop: z.boolean()
  }),
  economy: z.object({
    enabled: z.boolean(),
    nodes: z.record(
      z.string(),
      z.object({
        label: z.string().min(1),
        item: z.string().min(1),
        dx: z.number().int(),
        dy: z.number().int(),
        amount: z.number().int().min(1),
        renewable: z.boolean(),
        regen_per_tick: z.number().int().min(0),
        yield_per_tick: z.number().int().min(1),
        buffer_capacity: z.number().int().min(1),
        tint: z.string().regex(/^#[0-9a-fA-F]{6}$/)
      })
    )
  })
});

const itemsSchema = z.object({
  meta: z.object({ version: z.union([z.string(), z.number()]).transform(String) }),
  items: z.record(
    z.string(),
    z.object({
      label: z.string().min(1),
      category: z.string().min(1),
      volume: z.number().int().min(1),
      base_value: z.number().int().min(0)
    })
  )
});

const storageSchema = z.object({
  meta: z.object({ version: z.union([z.string(), z.number()]).transform(String) }),
  storage_types: z.record(
    z.string(),
    z.object({
      label: z.string().min(1),
      capacity: z.number().int().min(1),
      categories: z.array(z.string().min(1)).min(1)
    })
  ),
  carrier: z
    .object({
      capacity: z.number().int().min(1),
      cart_capacity: z.number().int().min(1),
      move_ticks_per_tile: z.number().int().min(1),
      load_ticks: z.number().int().min(1),
      unload_ticks: z.number().int().min(1),
      count: z.number().int().min(1),
      cart_count: z.number().int().min(0)
    })
    .refine((carrier) => carrier.cart_count <= carrier.count, {
      message: 'cart_count must not exceed carrier count'
    }),
  gatherer: z.object({ count: z.number().int().min(1) }),
  builders: z.object({ count: z.number().int().min(0) }),
  starting_storages: z
    .array(
      z.object({
        type: z.string().min(1),
        dx: z.number().int(),
        dy: z.number().int(),
        items: z.record(z.string(), z.number().int().min(0))
      })
    )
    .min(1)
});

const buildingsSchema = z.object({
  meta: z.object({ version: z.union([z.string(), z.number()]).transform(String) }),
  build_rate: z.number().int().min(1),
  salvage_ratio: z.number().min(0).max(1),
  buildings: z.record(
    z.string(),
    z.object({
      label: z.string().min(1),
      category: z.enum(['housing', 'production', 'storage', 'infrastructure']),
      description: z.string().min(1),
      build_work: z.number().int().min(1),
      workers_limit: z.number().int().min(0),
      materials: z.record(z.string(), z.number().int().min(1)),
      walkable: z.boolean().optional().default(false),
      cart_passable: z.boolean().optional().default(true),
      move_cost: z.number().min(0.1).optional(),
      tint: z.string().regex(/^#[0-9a-fA-F]{6}$/)
    })
  )
});

const populationSchema = z.object({
  meta: z.object({ version: z.union([z.string(), z.number()]).transform(String) }),
  population: z.object({
    starting_residents: z.number().int().min(1),
    base_capacity: z.number().int().min(0),
    housing_capacity_per_house: z.number().int().min(0),
    migration_enabled: z.boolean(),
    migration_min_ticks: z.number().int().min(1),
    arrival_laborer_role: z.enum(['carrier', 'gatherer', 'builder'])
  }),
  xp: z.object({
    xp_per_task: z.number().int().min(0),
    xp_per_school: z.number().int().min(0),
    level_thresholds: z.array(z.number().int().min(1)).min(1)
  })
});

const recipesSchema = z.object({
  meta: z.object({ version: z.union([z.string(), z.number()]).transform(String) }),
  recipes: z.record(
    z.string(),
    z.object({
      label: z.string().min(1),
      station: z.string().min(1),
      required_profession: z.string().min(1),
      unlock_technology: z.string().min(1),
      production_seconds: z.number().int().min(1),
      inputs: z.record(z.string(), z.number().int().min(1)),
      outputs: z.record(z.string(), z.number().int().min(1)),
      tint: z.string().regex(/^#[0-9a-fA-F]{6}$/)
    })
  )
});

const craftBalanceSchema = z.object({
  meta: z.object({ version: z.union([z.string(), z.number()]).transform(String) }),
  craft: z.object({
    default_production_ticks: z.number().int().min(1),
    buffer_capacity: z.number().int().min(1)
  }),
  research: z.object({
    enabled: z.boolean(),
    points_per_tick: z.number().int().min(0),
    default_node_cost: z.number().int().min(1),
    max_parallel_projects: z.number().int().min(1)
  })
});

const techTreeSchema = z.object({
  meta: z.object({ version: z.union([z.string(), z.number()]).transform(String) }),
  tech_tree: z.record(
    z.string(),
    z.object({
      label: z.string().min(1),
      description: z.string().min(1),
      root: z.boolean(),
      requires: z.array(z.string().min(1)),
      cost: z.number().int().min(1),
      unlock_recipes: z.array(z.string().min(1)),
      tint: z.string().regex(/^#[0-9a-fA-F]{6}$/)
    })
  )
});

export interface RecipeRule {
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

export interface TechnologyRule {
  id: string;
  label: string;
  description: string;
  root: boolean;
  requires: string[];
  cost: number;
  unlockRecipes: string[];
  tint: string;
}

export interface CraftBalance {
  defaultProductionTicks: number;
  bufferCapacity: number;
}

export interface ResearchBalance {
  enabled: boolean;
  pointsPerTick: number;
  defaultNodeCost: number;
  maxParallelProjects: number;
}

export interface ItemRule {
  id: string;
  label: string;
  category: string;
  volume: number;
  baseValue: number;
}

export interface BuildingRule {
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

export interface StorageTypeRule {
  id: string;
  label: string;
  capacity: number;
  categories: string[];
}

export interface CarrierRule {
  capacity: number;
  cartCapacity: number;
  moveTicksPerTile: number;
  loadTicks: number;
  unloadTicks: number;
  count: number;
  cartCount: number;
}

export interface StartingStorage {
  type: string;
  dx: number;
  dy: number;
  items: Record<string, number>;
}

export interface NodeRule {
  kind: string;
  label: string;
  item: string;
  dx: number;
  dy: number;
  amount: number;
  renewable: boolean;
  regenPerTick: number;
  yieldPerTick: number;
  bufferCapacity: number;
  tint: string;
}

export interface WorldBalance {
  meta: {
    version: string;
    provenance: string;
    source: string;
    updated: string;
  };
  sector: {
    width: number;
    height: number;
    maxDepth: number;
    unlock: {
      adjacentOnly: boolean;
      cost: { wood: number; stone: number };
    };
  };
  biomes: BiomeRule[];
  terrains: Record<TerrainType, TerrainRule>;
  pathing: { transports: Array<'person' | 'cart'>; diagonal: boolean };
  clearing: { workPerTick: number; maxTasks: number; stampOutcrop: boolean };
  economyEnabled: boolean;
  items: Record<string, ItemRule>;
  storageTypes: Record<string, StorageTypeRule>;
  carrier: CarrierRule;
  gathererCount: number;
  builderCount: number;
  buildings: Record<string, BuildingRule>;
  buildRate: number;
  salvageRatio: number;
  startingStorages: StartingStorage[];
  nodes: NodeRule[];
  population: {
    startingResidents: number;
    baseCapacity: number;
    housingCapacityPerHouse: number;
    migrationEnabled: boolean;
    migrationMinTicks: number;
    arrivalLaborerRole: 'carrier' | 'gatherer' | 'builder';
  };
  xp: {
    xpPerTask: number;
    xpPerSchool: number;
    levelThresholds: number[];
  };
  recipes: Record<string, RecipeRule>;
  techTree: Record<string, TechnologyRule>;
  craft: CraftBalance;
  research: ResearchBalance;
}

let cached: WorldBalance | null = null;
let cachedPath: string | null = null;

export function findContentFile(name: string, start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, 'content', name);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`content/${name} not found`);
    dir = parent;
  }
}

export function findBalanceFile(start: string = process.cwd()): string {
  return findContentFile('world_balance.yaml', start);
}

function readYaml(file: string): unknown {
  return parse(readFileSync(file, 'utf8'));
}

export function loadWorldBalance(file?: string): WorldBalance {
  const resolved = path.resolve(file ?? findBalanceFile());
  const cacheKey = `${resolved}|${findContentFile('items.yaml')}|${findContentFile('storage.yaml')}|${findContentFile('buildings.yaml')}|${findContentFile('population_balance.yaml')}|${findContentFile('recipes.yaml')}|${findContentFile('craft_balance.yaml')}|${findContentFile('tech_tree.yaml')}`;
  if (cached && cachedPath === cacheKey) return cached;

  const raw = balanceSchema.parse(readYaml(resolved));
  const rawItems = itemsSchema.parse(readYaml(findContentFile('items.yaml')));
  const rawStorage = storageSchema.parse(readYaml(findContentFile('storage.yaml')));
  const rawBuildings = buildingsSchema.parse(readYaml(findContentFile('buildings.yaml')));
  const rawPopulation = populationSchema.parse(
    readYaml(findContentFile('population_balance.yaml'))
  );
  const rawRecipes = recipesSchema.parse(readYaml(findContentFile('recipes.yaml')));
  const rawCraft = craftBalanceSchema.parse(readYaml(findContentFile('craft_balance.yaml')));
  const rawTech = techTreeSchema.parse(readYaml(findContentFile('tech_tree.yaml')));

  const items: Record<string, ItemRule> = {};
  for (const [id, item] of Object.entries(rawItems.items)) {
    items[id] = {
      id,
      label: item.label,
      category: item.category,
      volume: item.volume,
      baseValue: item.base_value
    };
  }

  const storageTypes: Record<string, StorageTypeRule> = {};
  for (const [id, type] of Object.entries(rawStorage.storage_types)) {
    storageTypes[id] = {
      id,
      label: type.label,
      capacity: type.capacity,
      categories: type.categories
    };
  }

  const startingStorages: StartingStorage[] = rawStorage.starting_storages.map(
    (storage) => {
      const type = storageTypes[storage.type];
      if (!type) {
        throw new Error(`storage.yaml: unknown storage type "${storage.type}"`);
      }
      let volume = 0;
      for (const [itemId, qty] of Object.entries(storage.items)) {
        const item = items[itemId];
        if (!item) {
          throw new Error(`storage.yaml: unknown item "${itemId}"`);
        }
        if (!type.categories.includes(item.category)) {
          throw new Error(
            `storage.yaml: ${storage.type} does not accept ${itemId} (${item.category})`
          );
        }
        volume += item.volume * qty;
      }
      if (volume > type.capacity) {
        throw new Error(
          `storage.yaml: starting ${storage.type} exceeds capacity (${volume}/${type.capacity})`
        );
      }
      return {
        type: storage.type,
        dx: storage.dx,
        dy: storage.dy,
        items: storage.items
      };
    }
  );

  for (const item of Object.values(items)) {
    const covered = Object.values(storageTypes).some((type) =>
      type.categories.includes(item.category)
    );
    if (!covered) {
      throw new Error(`storage.yaml: category "${item.category}" has no storage type`);
    }
  }

  const buildings: Record<string, BuildingRule> = {};
  for (const [id, building] of Object.entries(rawBuildings.buildings)) {
    for (const itemId of Object.keys(building.materials)) {
      if (!items[itemId]) {
        throw new Error(`buildings.yaml: building "${id}" uses unknown item "${itemId}"`);
      }
    }
    if (building.category === 'infrastructure' && !building.walkable) {
      throw new Error(`buildings.yaml: infrastructure "${id}" must be walkable`);
    }
    if (building.walkable && building.move_cost === undefined) {
      throw new Error(`buildings.yaml: walkable "${id}" needs move_cost`);
    }
    buildings[id] = {
      id,
      label: building.label,
      category: building.category,
      description: building.description,
      buildWork: building.build_work,
      workersLimit: building.workers_limit,
      materials: building.materials,
      walkable: building.walkable,
      cartPassable: building.cart_passable,
      moveCost: building.move_cost ?? null,
      tint: building.tint
    };
  }
  if (Object.keys(buildings).length === 0) {
    throw new Error('buildings.yaml: no buildings defined');
  }

  const nodes: NodeRule[] = Object.entries(raw.economy.nodes).map(([kind, node]) => {
    const item = items[node.item];
    if (!item) {
      throw new Error(`world_balance.yaml: node "${kind}" uses unknown item "${node.item}"`);
    }
    return {
      kind,
      label: node.label,
      item: node.item,
      dx: node.dx,
      dy: node.dy,
      amount: node.amount,
      renewable: node.renewable,
      regenPerTick: node.regen_per_tick,
      yieldPerTick: node.yield_per_tick,
      bufferCapacity: node.buffer_capacity,
      tint: node.tint
    };
  });
  if (nodes.length === 0) throw new Error('world_balance.yaml: economy nodes are empty');
  if (!items.logs || !items.stone) {
    throw new Error('items.yaml: logs and stone are required for sector unlock cost');
  }

  const terrains = {} as Record<TerrainType, TerrainRule>;
  for (const type of TERRAIN_TYPES) {
    const entry = raw.terrain[type];
    if (!entry) throw new Error(`world_balance.yaml: terrain "${type}" is missing`);
    if (entry.clearable && entry.clearing_work <= 0) {
      throw new Error(`world_balance.yaml: clearable terrain "${type}" needs clearing_work`);
    }
    if (entry.clearable && !entry.becomes) {
      throw new Error(`world_balance.yaml: clearable terrain "${type}" needs becomes`);
    }
    terrains[type] = {
      id: type,
      label: entry.label,
      color: entry.color,
      passable: entry.passable,
      cartPassable: entry.cart_passable,
      moveCost: entry.move_cost,
      clearable: entry.clearable,
      clearingWork: entry.clearing_work,
      becomes: entry.becomes
    };
  }

  const biomes: BiomeRule[] = Object.entries(raw.biomes).map(([id, biome]) => {
    const terrainWeights: Partial<Record<TerrainType, number>> = {};
    for (const [type, weight] of Object.entries(biome.terrain_weights)) {
      if (!(TERRAIN_TYPES as readonly string[]).includes(type)) {
        throw new Error(`world_balance.yaml: biome "${id}" uses unknown terrain "${type}"`);
      }
      terrainWeights[type as TerrainType] = weight;
    }
    if (Object.values(terrainWeights).every((weight) => (weight ?? 0) <= 0)) {
      throw new Error(`world_balance.yaml: biome "${id}" has no positive terrain weights`);
    }
    return { id, label: biome.label, tint: biome.tint, weight: biome.weight, terrainWeights };
  });
  if (biomes.length === 0) throw new Error('world_balance.yaml: at least one biome is required');

  const recipes: Record<string, RecipeRule> = {};
  for (const [id, recipe] of Object.entries(rawRecipes.recipes)) {
    if (!buildings[recipe.station]) {
      throw new Error(`recipes.yaml: recipe "${id}" uses unknown station "${recipe.station}"`);
    }
    if (!(PROFESSIONS as readonly string[]).includes(recipe.required_profession)) {
      throw new Error(
        `recipes.yaml: recipe "${id}" uses unknown profession "${recipe.required_profession}"`
      );
    }
    for (const itemId of [...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)]) {
      if (!items[itemId]) {
        throw new Error(`recipes.yaml: recipe "${id}" uses unknown item "${itemId}"`);
      }
    }
    recipes[id] = {
      id,
      label: recipe.label,
      station: recipe.station,
      requiredProfession: recipe.required_profession,
      unlockTechnology: recipe.unlock_technology,
      productionSeconds: recipe.production_seconds,
      inputs: recipe.inputs,
      outputs: recipe.outputs,
      tint: recipe.tint
    };
  }
  if (Object.keys(recipes).length === 0) {
    throw new Error('recipes.yaml: no recipes defined');
  }

  const techTree: Record<string, TechnologyRule> = {};
  for (const [id, node] of Object.entries(rawTech.tech_tree)) {
    for (const dependency of node.requires) {
      if (!rawTech.tech_tree[dependency]) {
        throw new Error(
          `tech_tree.yaml: node "${id}" requires unknown node "${dependency}"`
        );
      }
    }
    for (const recipeId of node.unlock_recipes) {
      if (!recipes[recipeId]) {
        throw new Error(
          `tech_tree.yaml: node "${id}" unlocks unknown recipe "${recipeId}"`
        );
      }
    }
    techTree[id] = {
      id,
      label: node.label,
      description: node.description,
      root: node.root,
      requires: node.requires,
      cost: node.cost,
      unlockRecipes: node.unlock_recipes,
      tint: node.tint
    };
  }
  if (Object.keys(techTree).length === 0) {
    throw new Error('tech_tree.yaml: no nodes defined');
  }
  if (!Object.values(techTree).some((node) => node.root)) {
    throw new Error('tech_tree.yaml: at least one root node is required');
  }
  for (const recipe of Object.values(recipes)) {
    if (!techTree[recipe.unlockTechnology]) {
      throw new Error(
        `recipes.yaml: recipe "${recipe.id}" references unknown technology "${recipe.unlockTechnology}"`
      );
    }
  }
  {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string): void => {
      if (done.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`tech_tree.yaml: dependency cycle at node "${id}"`);
      }
      visiting.add(id);
      for (const dependency of techTree[id]?.requires ?? []) visit(dependency);
      visiting.delete(id);
      done.add(id);
    };
    for (const id of Object.keys(techTree)) visit(id);
  }

  const balance: WorldBalance = {
    meta: raw.meta,
    sector: {
      width: raw.sectors.width,
      height: raw.sectors.height,
      maxDepth: raw.sectors.max_depth,
      unlock: {
        adjacentOnly: raw.sectors.unlock.adjacent_only,
        cost: raw.sectors.unlock.cost
      }
    },
    biomes,
    terrains,
    pathing: { transports: raw.pathing.transports, diagonal: raw.pathing.diagonal },
    clearing: {
      workPerTick: raw.clearing.work_per_tick,
      maxTasks: raw.clearing.max_tasks,
      stampOutcrop: raw.clearing.stamp_outcrop
    },
    economyEnabled: raw.economy.enabled,
    items,
    storageTypes,
    carrier: {
      capacity: rawStorage.carrier.capacity,
      cartCapacity: rawStorage.carrier.cart_capacity,
      moveTicksPerTile: rawStorage.carrier.move_ticks_per_tile,
      loadTicks: rawStorage.carrier.load_ticks,
      unloadTicks: rawStorage.carrier.unload_ticks,
      count: rawStorage.carrier.count,
      cartCount: rawStorage.carrier.cart_count
    },
    gathererCount: rawStorage.gatherer.count,
    builderCount: rawStorage.builders.count,
    buildings,
    buildRate: rawBuildings.build_rate,
    salvageRatio: rawBuildings.salvage_ratio,
    startingStorages,
    nodes,
    population: {
      startingResidents: rawPopulation.population.starting_residents,
      baseCapacity: rawPopulation.population.base_capacity,
      housingCapacityPerHouse: rawPopulation.population.housing_capacity_per_house,
      migrationEnabled: rawPopulation.population.migration_enabled,
      migrationMinTicks: rawPopulation.population.migration_min_ticks,
      arrivalLaborerRole: rawPopulation.population.arrival_laborer_role
    },
    xp: {
      xpPerTask: rawPopulation.xp.xp_per_task,
      xpPerSchool: rawPopulation.xp.xp_per_school,
      levelThresholds: rawPopulation.xp.level_thresholds
    },
    recipes,
    techTree,
    craft: {
      defaultProductionTicks: rawCraft.craft.default_production_ticks,
      bufferCapacity: rawCraft.craft.buffer_capacity
    },
    research: {
      enabled: rawCraft.research.enabled,
      pointsPerTick: rawCraft.research.points_per_tick,
      defaultNodeCost: rawCraft.research.default_node_cost,
      maxParallelProjects: rawCraft.research.max_parallel_projects
    }
  };

  cached = balance;
  cachedPath = cacheKey;
  return balance;
}

export function toCatalog(balance: WorldBalance): CatalogInfo {
  return {
    balanceVersion: balance.meta.version,
    provenance: balance.meta.provenance,
    terrains: TERRAIN_TYPES.map((type) => {
      const rule = balance.terrains[type];
      return {
        id: type,
        label: rule.label,
        color: rule.color,
        passable: rule.passable,
        cartPassable: rule.cartPassable,
        clearable: rule.clearable,
        clearingWork: rule.clearingWork
      };
    }),
    biomes: balance.biomes.map((biome) => ({
      id: biome.id,
      label: biome.label,
      tint: biome.tint
    })),
    items: Object.values(balance.items)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => ({
        id: item.id,
        label: item.label,
        category: item.category,
        volume: item.volume,
        baseValue: item.baseValue
      })),
    storageTypes: Object.values(balance.storageTypes)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((type) => ({
        id: type.id,
        label: type.label,
        capacity: type.capacity,
        categories: type.categories
      })),
    buildings: Object.values(balance.buildings)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((building) => ({
        id: building.id,
        label: building.label,
        category: building.category,
        description: building.description,
        buildWork: building.buildWork,
        workersLimit: building.workersLimit,
        materials: building.materials,
        walkable: building.walkable,
        cartPassable: building.cartPassable,
        moveCost: building.moveCost,
        tint: building.tint
      })),
    nodeTypes: balance.nodes.map((node) => ({
      id: node.kind,
      label: node.label,
      item: node.item,
      tint: node.tint
    })),
    recipes: Object.values(balance.recipes)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((recipe) => ({
        id: recipe.id,
        label: recipe.label,
        station: recipe.station,
        requiredProfession: recipe.requiredProfession,
        unlockTechnology: recipe.unlockTechnology,
        productionSeconds: recipe.productionSeconds,
        inputs: recipe.inputs,
        outputs: recipe.outputs,
        tint: recipe.tint
      }))
  };
}
