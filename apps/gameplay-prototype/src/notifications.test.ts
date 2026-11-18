import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationQueue, type NotificationMessage } from './notifications.js';

describe('NotificationQueue', () => {
  afterEach(() => vi.useRealTimers());

  it('replaces stale information instead of accumulating a backlog', () => {
    vi.useFakeTimers();
    const changes: Array<NotificationMessage | null> = [];
    const queue = new NotificationQueue((message) => changes.push(message));

    queue.push('Добыча завершена.');
    queue.push('Материал доставлен.');

    expect(changes).toEqual([
      { message: 'Добыча завершена.', priority: 'info' },
      { message: 'Материал доставлен.', priority: 'info' }
    ]);
    expect(queue.active).toEqual({ message: 'Материал доставлен.', priority: 'info' });
    vi.advanceTimersByTime(2599);
    expect(queue.active).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(queue.active).toBeNull();
    expect(changes.at(-1)).toBeNull();
  });

  it('does not let an informational event dismiss an action error', () => {
    vi.useFakeTimers();
    const changes: Array<NotificationMessage | null> = [];
    const queue = new NotificationQueue((message) => changes.push(message));

    queue.push('Недостаточно дерева.', 'error');
    vi.advanceTimersByTime(500);
    queue.push('Житель добыл дерево.');

    expect(queue.active).toEqual({ message: 'Недостаточно дерева.', priority: 'error' });
    expect(changes).toHaveLength(1);
    vi.advanceTimersByTime(3399);
    expect(queue.active).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(queue.active).toBeNull();
  });

  it('promotes an action error over an active informational message', () => {
    vi.useFakeTimers();
    const changes: Array<NotificationMessage | null> = [];
    const queue = new NotificationQueue((message) => changes.push(message));

    queue.push('Житель отправился к лесу.');
    vi.advanceTimersByTime(400);
    queue.push('Недостаточно дерева.', 'error');

    expect(queue.active).toEqual({ message: 'Недостаточно дерева.', priority: 'error' });
    vi.advanceTimersByTime(3900);
    expect(queue.active).toBeNull();
  });
});
