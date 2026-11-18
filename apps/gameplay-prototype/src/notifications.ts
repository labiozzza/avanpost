export type NotificationPriority = 'info' | 'error';

export interface NotificationMessage {
  message: string;
  priority: NotificationPriority;
}

const DISPLAY_MS: Record<NotificationPriority, number> = {
  info: 2600,
  error: 3900
};

/**
 * A single-slot notification queue: newer messages replace stale messages,
 * while informational events cannot dismiss an action error.
 */
export class NotificationQueue {
  private current: NotificationMessage | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastMessage: NotificationMessage | null = null;
  private lastShownAt = 0;

  constructor(private readonly onChange: (message: NotificationMessage | null) => void) {}

  push(message: string, priority: NotificationPriority = 'info'): void {
    const text = message.trim();
    if (!text) return;
    if (this.current?.priority === 'error' && priority === 'info') return;

    const now = Date.now();
    if (this.lastMessage?.message === text && this.lastMessage.priority === priority &&
        now - this.lastShownAt < 900) return;

    const next = { message: text, priority };
    this.current = next;
    this.lastMessage = next;
    this.lastShownAt = now;
    this.onChange(next);

    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.current !== next) return;
      this.current = null;
      this.timer = null;
      this.onChange(null);
    }, DISPLAY_MS[priority]);
  }

  dismiss(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.current = null;
    this.onChange(null);
  }

  get active(): NotificationMessage | null {
    return this.current;
  }
}
