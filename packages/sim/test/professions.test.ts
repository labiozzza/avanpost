import { describe, expect, it } from 'vitest';
import type { SchoolId } from '@avanpost/shared';
import {
  applySchool,
  professionFor,
  residentNameFor,
  residentTraitsFor
} from '../src';

describe('гражданские школы (stage I.4)', () => {
  it('без школ житель — разнорабочий', () => {
    expect(professionFor([])).toBe('Разнорабочий');
  });

  it('одна школа даёт базовую профессию', () => {
    expect(professionFor(['gather'])).toBe('Добытчик');
    expect(professionFor(['craft'])).toBe('Ремесленник');
  });

  it('GDD-тест I.4: обе перестановки двух школ дают одну профессию', () => {
    const gatherFirst = applySchool([], 'gather');
    const thenCraft = applySchool(gatherFirst.schools, 'craft');
    const craftFirst = applySchool([], 'craft');
    const thenGather = applySchool(craftFirst.schools, 'gather');

    expect(thenCraft.profession).toBe('Каменотёс');
    expect(thenGather.profession).toBe('Каменотёс');
    expect(thenCraft.profession).toBe(thenGather.profession);
  });

  it('повтор школы не даёт новую профессию и не меняет набор школ (GDD 5.4)', () => {
    const first = applySchool([], 'gather');
    expect(first.learned).toBe(true);
    expect(first.profession).toBe('Добытчик');

    const repeat = applySchool(first.schools, 'gather');
    expect(repeat.learned).toBe(false);
    expect(repeat.profession).toBe('Добытчик');
    expect(repeat.schools).toEqual(['gather']);
  });

  it('школы не зависят от порядка и повтор не дублирует набор', () => {
    const order1 = applySchool(applySchool([], 'craft').schools, 'gather');
    const order2 = applySchool(applySchool([], 'gather').schools, 'craft');
    expect(new Set(order1.schools)).toEqual(new Set(order2.schools));
    expect(order1.schools).toHaveLength(2);
  });

  it('имена и таланты жителей детерминированы', () => {
    expect(residentNameFor(0)).toBe('Ева');
    expect(residentNameFor(1)).toBe('Марта');
    const traits = residentTraitsFor(0);
    expect(traits).toHaveLength(2);
    expect(new Set(traits).size).toBe(2);
  });

  it('применение школы коммутативно для типа SchoolId', () => {
    const schools: SchoolId[] = ['gather', 'craft'];
    expect(professionFor(schools)).toBe(professionFor([...schools].reverse()));
  });
});
