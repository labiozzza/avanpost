import type { Profession, SchoolId } from '@avanpost/shared';

export interface SchoolInfo {
  id: SchoolId;
  label: string;
  short: string;
  sign: string;
}

export const SCHOOLS: Record<SchoolId, SchoolInfo> = {
  gather: {
    id: 'gather',
    label: 'Школа добычи',
    short: 'Д',
    sign: 'Школа добычи'
  },
  craft: {
    id: 'craft',
    label: 'Школа ремёсел',
    short: 'Р',
    sign: 'Школа ремёсел'
  }
};

export const PROFESSION_COLORS: Record<Profession, string> = {
  Разнорабочий: '#9aa39b',
  Добытчик: '#c77b3f',
  Ремесленник: '#7c8fd4',
  Каменотёс: '#c9b458'
};

export const PROFESSION_DESCRIPTIONS: Record<Profession, string> = {
  Разнорабочий: 'базовая стройка и перенос грузов',
  Добытчик: 'специализация на добыче сырья',
  Ремесленник: 'простые производственные операции',
  Каменотёс: 'извлечение и обработка камня'
};

export const RESIDENT_NAMES = [
  'Ева',
  'Марта',
  'Гвидо',
  'Агнесса',
  'Бруно',
  'Алиса',
  'Ролан',
  'Ида',
  'Тео',
  'Клара'
] as const;

export const RESIDENT_TRAITS = [
  'Сильный',
  'Меткий',
  'Прилежный',
  'Усидчивый',
  'Ловкий',
  'Выносливый'
] as const;

/** Training length in world ticks (server authority, GDD 9.6). */
export const TRAINING_TICKS = 15;

/** Profession for a set of schools: order-independent, repeats ignored. */
export function professionFor(schools: readonly SchoolId[]): Profession {
  const unique = new Set(schools);
  if (unique.has('gather') && unique.has('craft')) {
    return 'Каменотёс';
  }
  if (unique.has('gather')) {
    return 'Добытчик';
  }
  if (unique.has('craft')) {
    return 'Ремесленник';
  }
  return 'Разнорабочий';
}

/**
 * Attends a school. Repeating the same school never creates a new class
 * (GDD 5.4) and leaves the profession unchanged.
 */
export function applySchool(
  schools: readonly SchoolId[],
  school: SchoolId
): { learned: boolean; schools: SchoolId[]; profession: Profession } {
  if (schools.includes(school)) {
    return { learned: false, schools: [...schools], profession: professionFor(schools) };
  }
  const next = [...schools, school];
  return { learned: true, schools: next, profession: professionFor(next) };
}

export function residentNameFor(index: number): string {
  return RESIDENT_NAMES[index % RESIDENT_NAMES.length] ?? `Житель ${index + 1}`;
}

export function residentTraitsFor(index: number): [string, string] {
  const traitA = RESIDENT_TRAITS[index % RESIDENT_TRAITS.length] ?? 'Старательный';
  const traitB =
    RESIDENT_TRAITS[(index + 3) % RESIDENT_TRAITS.length] ?? 'Дружелюбный';
  return [traitA, traitB];
}
