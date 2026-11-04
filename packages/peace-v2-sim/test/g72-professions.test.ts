import { describe, expect, it } from 'vitest';
import { G72_PROFESSION_CATALOG, resolveG72Profession } from '../src/g72-professions.js';

describe('G7.2 proposed profession catalog', () => {
  it('contains the 23 requested outcomes and no negative costs', () => {
    expect(G72_PROFESSION_CATALOG.recipes).toHaveLength(23);
    expect(new Set(G72_PROFESSION_CATALOG.recipes.map((r) => r.new_profession)).size).toBe(23);
    expect(G72_PROFESSION_CATALOG.status).toBe('proposed');
    for (const recipe of G72_PROFESSION_CATALOG.recipes) {
      expect(recipe.food_cost).toBeGreaterThanOrEqual(0);
      expect(Object.values(recipe.materials_cost).every((cost) => cost >= 0)).toBe(true);
    }
  });

  it('makes all six pairs commutative', () => {
    const pairs = G72_PROFESSION_CATALOG.recipes.filter((r) => r.school_set_or_sequence.length === 2);
    expect(pairs).toHaveLength(6);
    for (const recipe of pairs) {
      const [first, second] = recipe.school_set_or_sequence;
      expect(resolveG72Profession([first!, second!])?.new_profession).toBe(recipe.new_profession);
      expect(resolveG72Profession([second!, first!])?.new_profession).toBe(recipe.new_profession);
    }
  });

  it('uses the third school to select each explicit triple and rejects repeats/fourth schools', () => {
    const triples = G72_PROFESSION_CATALOG.recipes.filter((r) => r.school_set_or_sequence.length === 3);
    expect(triples).toHaveLength(12);
    expect(G72_PROFESSION_CATALOG.recipes.filter((r) => r.school_set_or_sequence.length === 1)).toHaveLength(4);
    for (const recipe of triples) {
      const [first, second, last] = recipe.school_set_or_sequence;
      expect(resolveG72Profession([first!, second!, last!])?.new_profession).toBe(recipe.new_profession);
      expect(resolveG72Profession([second!, first!, last!])?.new_profession).toBe(recipe.new_profession);
    }
    expect(resolveG72Profession(['extraction', 'extraction'])).toBeNull();
    expect(resolveG72Profession(['extraction', 'crafts', 'logistics', 'sciences'])).toBeNull();
  });
});
