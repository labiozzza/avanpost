import { describe, expect, it } from 'vitest';
import { miningCommandFeedback, worldBlockerMessages } from '../src/world-feedback.js';

describe('world blocker feedback', () => {
  it('keeps full-storage feedback visible with an actionable next step', () => {
    expect(worldBlockerMessages([
      { id: 'worker-1', name: 'Аня', task: { blockedReason: 'STORAGE_FULL' } },
      { id: 'worker-2', name: 'Илья', blockedReason: 'STORAGE_FULL', task: null }
    ], [])).toEqual([
      'Склад заполнен: 2 жителя ждут разгрузки. Постройте ещё один склад или освободите место.'
    ]);
  });

  it('explains why queued mining is waiting on the local buffer or an available worker', () => {
    expect(worldBlockerMessages([], [
      { kind: 'mine', status: 'waiting_path', blockedReason: 'LOCAL_BUFFER_FULL' },
      { kind: 'mine', status: 'waiting_path', blockedReason: 'NO_PATH_TO_EXCAVATION' }
    ])).toEqual([
      'Добыча приостановлена: буфер шахты заполнен. Освободите место на складе, чтобы вывезти камень.',
      'Добыча в очереди: пока нет свободного жителя или пути к месторождению.'
    ]);
  });

  it('reports the miner actually assigned by the accepted mining command', () => {
    const jobs = [{ kind: 'mine', status: 'in_progress', depositId: 'stone-seam', assignedResidentId: 'worker-1' }];
    expect(miningCommandFeedback('stone-seam', jobs, [
      { id: 'worker-1', name: 'Илья', task: { phase: 'walking_to_worksite' } }
    ])).toBe('Илья идёт к месторождению; добыча начнётся по прибытии.');
    expect(miningCommandFeedback('stone-seam', jobs, [
      { id: 'worker-1', name: 'Илья', task: { phase: 'working' } }
    ])).toBe('Илья начал добывать камень.');
  });
});
