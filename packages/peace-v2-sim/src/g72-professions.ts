import { z } from 'zod';
import catalogData from '../../../content/peace-v2/g7.2-professions.json';

export const G72_SCHOOL_IDS = ['extraction', 'crafts', 'logistics', 'sciences'] as const;
export type G72SchoolId = typeof G72_SCHOOL_IDS[number];

const RecipeSchema = z.object({
  recipe_id: z.string().min(1), school_set_or_sequence: z.array(z.enum(G72_SCHOOL_IDS)).max(3),
  required_prior_class: z.string().nullable(), new_profession: z.string().min(1),
  technology_required: z.string().nullable(), academy_level: z.number().int().nonnegative(),
  minimum_skill: z.number().int().nonnegative(), food_cost: z.number().int().nonnegative(),
  materials_cost: z.record(z.string(), z.number().int().nonnegative()), base_training_seconds: z.number().int().nonnegative(),
  visual_transform: z.string().min(1), new_allowed_jobs: z.array(z.string()), xp_curve: z.string().min(1),
  cancellation_policy: z.string().min(1), asset_key: z.string().min(1)
}).strict();
const CatalogSchema = z.object({
  version: z.string().min(1), status: z.literal('proposed'), schools: z.array(z.enum(G72_SCHOOL_IDS)).length(4),
  school_buildings: z.array(z.object({ school_id: z.enum(G72_SCHOOL_IDS), building_kind: z.string(),
    construction_materials: z.record(z.string(), z.number().int().nonnegative()), training_capacity: z.number().int().positive(),
    initial_training_stock: z.number().int().nonnegative(), footprint: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
    construction_seconds: z.number().int().positive() }).strict()).length(4),
  cancellationPolicy: z.object({ version: z.string(), beforeTraining: z.string(), duringTraining: z.string() }).strict(),
  recipes: z.array(RecipeSchema).length(23)
}).strict();

export const G72_PROFESSION_CATALOG = CatalogSchema.parse(catalogData);
export type G72ProfessionRecipe = typeof G72_PROFESSION_CATALOG.recipes[number];

export function g72SchoolBuildingConfig(schoolId: G72SchoolId) {
  return G72_PROFESSION_CATALOG.school_buildings.find((config) => config.school_id === schoolId)!;
}

function pairKey(schools: readonly G72SchoolId[]): string {
  return [...schools].sort().join('+');
}

function validateCatalog(): void {
  const ids = new Set<string>();
  const professions = new Set<string>();
  const recipes = new Set<string>();
  for (const recipe of G72_PROFESSION_CATALOG.recipes) {
    if (ids.has(recipe.recipe_id) || professions.has(recipe.new_profession)) throw new Error(`Duplicate G7.2 recipe or profession: ${recipe.recipe_id}`);
    ids.add(recipe.recipe_id); professions.add(recipe.new_profession);
    if (recipe.school_set_or_sequence.length === 2) {
      const key = pairKey(recipe.school_set_or_sequence);
      if (recipes.has(key)) throw new Error(`Duplicate G7.2 pair recipe: ${key}`);
      recipes.add(key);
    }
    if (recipe.school_set_or_sequence.length === 3 && new Set(recipe.school_set_or_sequence).size !== 3) {
      throw new Error(`Repeated school in G7.2 triple recipe: ${recipe.recipe_id}`);
    }
    if (recipe.school_set_or_sequence.length > 0 && recipe.base_training_seconds <= 0) {
      throw new Error(`Training duration must be positive: ${recipe.recipe_id}`);
    }
  }
  if (recipes.size !== 6) throw new Error(`Expected six unique pair recipes; found ${recipes.size}`);
  const singles = G72_PROFESSION_CATALOG.recipes.filter((recipe) => recipe.school_set_or_sequence.length === 1);
  if (singles.length !== 4) throw new Error(`Expected four single-school recipes; found ${singles.length}`);
  const triples = G72_PROFESSION_CATALOG.recipes.filter((recipe) => recipe.school_set_or_sequence.length === 3);
  if (triples.length !== 12) throw new Error(`Expected twelve explicit triple recipes; found ${triples.length}`);
  const tripleKeys = new Set(triples.map((recipe) => `${pairKey(recipe.school_set_or_sequence.slice(0, 2))}->${recipe.school_set_or_sequence[2]}`));
  if (tripleKeys.size !== 12) throw new Error('G7.2 triple recipe sequences must each have a distinct last-school outcome.');
}
validateCatalog();

/** Resolves a profession only from the ordered, completed schooling history. */
export function resolveG72Profession(completedSchools: readonly G72SchoolId[]): G72ProfessionRecipe | null {
  if (completedSchools.length === 0) return G72_PROFESSION_CATALOG.recipes.find((r) => r.recipe_id === 'general_worker')!;
  if (new Set(completedSchools).size !== completedSchools.length || completedSchools.length > 3) return null;
  if (completedSchools.length === 1) {
    return G72_PROFESSION_CATALOG.recipes.find((r) => r.school_set_or_sequence[0] === completedSchools[0] && r.school_set_or_sequence.length === 1) ?? null;
  }
  if (completedSchools.length === 2) {
    const key = pairKey(completedSchools);
    return G72_PROFESSION_CATALOG.recipes.find((r) => r.school_set_or_sequence.length === 2 && pairKey(r.school_set_or_sequence) === key) ?? null;
  }
  const prior = pairKey(completedSchools.slice(0, 2));
  return G72_PROFESSION_CATALOG.recipes.find((r) => r.school_set_or_sequence.length === 3 &&
    pairKey(r.school_set_or_sequence.slice(0, 2)) === prior && r.school_set_or_sequence[2] === completedSchools[2]) ?? null;
}
