import { parseSavedWorld, STORAGE_KEY, type PrototypeWorld } from './simulation.js';
import type { GridMode } from './land-grid.js';

export const SAVE_EXPORT_FORMAT = 'avanpost-gameplay-prototype-save';
export const SAVE_EXPORT_VERSION = 1;
export const MAX_SAVE_EXPORT_BYTES = 2 * 1024 * 1024;

export interface SaveExport {
  world: PrototypeWorld;
  gridMode: GridMode;
  exportedAt: string;
}

export function serializeSaveExport(
  world: PrototypeWorld,
  gridMode: GridMode,
  exportedAt = new Date()
): string {
  return JSON.stringify({
    format: SAVE_EXPORT_FORMAT,
    version: SAVE_EXPORT_VERSION,
    storageKey: STORAGE_KEY,
    exportedAt: exportedAt.toISOString(),
    preferences: { gridMode },
    world
  }, null, 2);
}

export function parseSaveExport(raw: string): SaveExport {
  if (new TextEncoder().encode(raw).byteLength > MAX_SAVE_EXPORT_BYTES) {
    throw new Error('Файл сохранения слишком большой.');
  }

  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error('Файл не содержит корректный JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Структура файла сохранения не распознана.');
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.format !== SAVE_EXPORT_FORMAT || envelope.version !== SAVE_EXPORT_VERSION ||
      envelope.storageKey !== STORAGE_KEY || typeof envelope.exportedAt !== 'string' ||
      !Number.isFinite(Date.parse(envelope.exportedAt))) {
    throw new Error('Версия или origin сохранения не совпадает с этим прототипом.');
  }
  const preferences = envelope.preferences;
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    throw new Error('Настройки файла сохранения не распознаны.');
  }
  const gridMode = (preferences as Record<string, unknown>).gridMode;
  if (gridMode !== 'off' && gridMode !== 'borders' && gridMode !== 'planning') {
    throw new Error('Режим сетки в файле сохранения недопустим.');
  }
  if (!envelope.world) throw new Error('В файле нет поселения.');
  const world = parseSavedWorld(JSON.stringify(envelope.world));
  if (!world) throw new Error('Поселение не прошло проверку структуры. Текущее сохранение не изменено.');
  return { world, gridMode, exportedAt: envelope.exportedAt };
}
