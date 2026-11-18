import { describe, expect, it } from 'vitest';
import { CameraGestureController } from './camera-gestures.js';

describe('CameraGestureController', () => {
  it('rebases the remaining finger when a pinch changes to a one-finger pan', () => {
    const gestures = new CameraGestureController();
    gestures.pointerDown({ id: 1, x: 100, y: 100 }, 1);
    gestures.pointerDown({ id: 2, x: 200, y: 100 }, 1);

    const pinch = gestures.pointerMove({ id: 2, x: 240, y: 100 }, 1);
    expect(pinch).toEqual({
      kind: 'pinch', distance: 140, startDistance: 100, startZoom: 1
    });
    expect(gestures.pointerUp({ id: 2, x: 240, y: 100 })).toBeNull();

    expect(gestures.pointerMove({ id: 1, x: 112, y: 109 }, 1.4)).toEqual({
      kind: 'pan', dx: 12, dy: 9
    });
  });

  it('starts a pinch from the current one-finger pan position without a zoom jump', () => {
    const gestures = new CameraGestureController();
    gestures.pointerDown({ id: 1, x: 100, y: 100 }, 1);
    expect(gestures.pointerMove({ id: 1, x: 120, y: 110 }, 1)).toEqual({
      kind: 'pan', dx: 20, dy: 10
    });

    gestures.pointerDown({ id: 2, x: 220, y: 110 }, 1);
    expect(gestures.pointerMove({ id: 2, x: 220, y: 110 }, 1)).toEqual({
      kind: 'pinch', distance: 100, startDistance: 100, startZoom: 1
    });
    expect(gestures.pointerMove({ id: 2, x: 250, y: 110 }, 1)).toEqual({
      kind: 'pinch', distance: 130, startDistance: 100, startZoom: 1
    });
  });

  it('keeps taps distinct from drags and rebases after a second pinch finger lifts', () => {
    const gestures = new CameraGestureController();
    gestures.pointerDown({ id: 1, x: 30, y: 40 }, 0.8);
    expect(gestures.pointerUp({ id: 1, x: 30, y: 40 })).toEqual({
      kind: 'tap', x: 30, y: 40
    });

    gestures.pointerDown({ id: 1, x: 50, y: 50 }, 0.8);
    gestures.pointerDown({ id: 2, x: 150, y: 50 }, 0.8);
    gestures.pointerMove({ id: 1, x: 40, y: 50 }, 0.8);
    gestures.pointerUp({ id: 1, x: 40, y: 50 });
    expect(gestures.pointerMove({ id: 2, x: 162, y: 55 }, 0.7)).toEqual({
      kind: 'pan', dx: 12, dy: 5
    });
  });

  it('continues a pinch as a smooth pan after one finger lifts, then allows another pinch', () => {
    const gestures = new CameraGestureController();
    gestures.pointerDown({ id: 1, x: 100, y: 100 }, 1);
    gestures.pointerDown({ id: 2, x: 200, y: 100 }, 1);

    const zoom = gestures.pointerMove({ id: 2, x: 240, y: 100 }, 1);
    expect(zoom).toEqual({ kind: 'pinch', distance: 140, startDistance: 100, startZoom: 1 });
    expect(gestures.pointerUp({ id: 2, x: 240, y: 100 })).toBeNull();
    expect(gestures.pointerMove({ id: 1, x: 108, y: 106 }, 1.4)).toEqual({
      kind: 'pan', dx: 8, dy: 6
    });
    expect(gestures.pointerUp({ id: 1, x: 108, y: 106 })).toBeNull();

    gestures.pointerDown({ id: 1, x: 120, y: 120 }, 1.4);
    gestures.pointerDown({ id: 2, x: 220, y: 120 }, 1.4);
    expect(gestures.pointerMove({ id: 2, x: 250, y: 120 }, 1.4)).toEqual({
      kind: 'pinch', distance: 130, startDistance: 100, startZoom: 1.4
    });
  });

  it('does not turn cancelled contacts into taps or retain them for the next gesture', () => {
    const gestures = new CameraGestureController();
    gestures.pointerDown({ id: 1, x: 30, y: 40 }, 1);
    gestures.pointerDown({ id: 2, x: 130, y: 40 }, 1);
    gestures.pointerMove({ id: 2, x: 150, y: 40 }, 1);

    // Scene pointercancel handling resets the controller because Phaser has no
    // native pointercancel input event; no cancelled contact may select an object.
    gestures.reset();
    expect(gestures.pointerUp({ id: 1, x: 30, y: 40 })).toBeNull();
    gestures.pointerDown({ id: 3, x: 70, y: 80 }, 1);
    expect(gestures.pointerUp({ id: 3, x: 70, y: 80 })).toEqual({
      kind: 'tap', x: 70, y: 80
    });
  });

  it('keeps rapid independent taps from inheriting a previous pointer state', () => {
    const gestures = new CameraGestureController();
    for (const [id, x] of [[1, 30], [2, 60], [3, 90]] as const) {
      gestures.pointerDown({ id, x, y: 40 }, 1);
      expect(gestures.pointerUp({ id, x, y: 40 })).toEqual({ kind: 'tap', x, y: 40 });
    }
  });
});
