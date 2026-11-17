export interface PointerPosition {
  id: number;
  x: number;
  y: number;
}

interface ActivePointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
}

export type CameraGesture =
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'pinch'; distance: number; startDistance: number; startZoom: number }
  | { kind: 'tap'; x: number; y: number }
  | null;

export class CameraGestureController {
  private readonly activePointers = new Map<number, ActivePointer>();
  private pinchStart: { distance: number; zoom: number } | null = null;

  reset(): void {
    this.activePointers.clear();
    this.pinchStart = null;
  }

  pointerDown(pointer: PointerPosition, zoom: number): void {
    this.activePointers.set(pointer.id, {
      x: pointer.x,
      y: pointer.y,
      startX: pointer.x,
      startY: pointer.y,
      moved: false
    });
    if (this.activePointers.size >= 2) {
      for (const active of this.activePointers.values()) active.moved = true;
      this.pinchStart = { distance: this.pointerDistance(), zoom };
    }
  }

  pointerMove(pointer: PointerPosition, zoom: number): CameraGesture {
    const active = this.activePointers.get(pointer.id);
    if (!active) return null;

    const previousX = active.x;
    const previousY = active.y;
    active.x = pointer.x;
    active.y = pointer.y;

    if (this.activePointers.size >= 2) {
      active.moved = true;
      if (!this.pinchStart) this.pinchStart = { distance: this.pointerDistance(), zoom };
      return {
        kind: 'pinch',
        distance: this.pointerDistance(),
        startDistance: this.pinchStart.distance,
        startZoom: this.pinchStart.zoom
      };
    }

    if (Math.hypot(pointer.x - active.startX, pointer.y - active.startY) > 8) active.moved = true;
    if (!active.moved) return null;

    active.startX = pointer.x;
    active.startY = pointer.y;
    return { kind: 'pan', dx: pointer.x - previousX, dy: pointer.y - previousY };
  }

  pointerUp(pointer: PointerPosition): CameraGesture {
    const active = this.activePointers.get(pointer.id);
    if (!active) return null;

    const wasMultiTouch = this.pinchStart !== null || this.activePointers.size > 1;
    this.activePointers.delete(pointer.id);
    if (wasMultiTouch) {
      this.pinchStart = null;
      // Rebase the remaining contact at its current position. Its next move is
      // a fresh pan delta, never the distance accumulated during the pinch.
      for (const remaining of this.activePointers.values()) {
        remaining.startX = remaining.x;
        remaining.startY = remaining.y;
        remaining.moved = true;
      }
      return null;
    }

    return active.moved ? null : { kind: 'tap', x: pointer.x, y: pointer.y };
  }

  private pointerDistance(): number {
    const [first, second] = [...this.activePointers.values()];
    return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 1;
  }
}
