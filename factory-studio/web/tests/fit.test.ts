import { describe, expect, it } from 'vitest';
import { PHONE_INSET, readableViewport, type Box } from '../src/shared/graph';

const wide: Box = { x: 0, y: -100, width: 4000, height: 600 };

describe('readableViewport', () => {
  it('centres a drawing that fits the view on that axis', () => {
    const view = readableViewport({ x: 0, y: -50, width: 500, height: 100 }, null, 1000, 800, 0.6);
    expect(view.zoom).toBe(0.6);
    expect(view.x).toBe((1000 - 300) / 2);
    expect(view.y).toBe((800 - 60) / 2 + 30);
  });

  it('puts the left edge at the inset when nothing is focal and the drawing overflows', () => {
    const view = readableViewport(wide, null, 1000, 800, 0.6);
    expect(view.x).toBe(PHONE_INSET);
    expect(view.y).toBe((800 - 360) / 2 + 60);
  });

  it('centres the focal step where the drawing overflows', () => {
    const focal: Box = { x: 2000, y: 0, width: 156, height: 104 };
    const view = readableViewport(wide, focal, 1000, 800, 0.6);
    expect(view.x).toBe(500 - (2000 + 78) * 0.6);
  });

  it('never pans past either end of the drawing', () => {
    const left: Box = { x: 10, y: 0, width: 156, height: 104 };
    expect(readableViewport(wide, left, 1000, 800, 0.6).x).toBe(PHONE_INSET);
    const right: Box = { x: 3900, y: 0, width: 100, height: 104 };
    expect(readableViewport(wide, right, 1000, 800, 0.6).x).toBe(1000 - PHONE_INSET - 4000 * 0.6);
  });
});
