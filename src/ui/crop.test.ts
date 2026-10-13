import { describe, expect, it } from 'vitest';
import { moveCrop, resizeCrop, squareCrop, type Corner } from './crop.ts';

const W = 200;
const H = 100;
const crop = { x: 50, y: 20, width: 100, height: 60 };

describe('moveCrop', () => {
  it('clamps flush with each edge and keeps the size', () => {
    expect(moveCrop(crop, -500, 0, W, H)).toEqual({ ...crop, x: 0 });
    expect(moveCrop(crop, 500, 0, W, H)).toEqual({ ...crop, x: 100 });
    expect(moveCrop(crop, 0, -500, W, H)).toEqual({ ...crop, y: 0 });
    expect(moveCrop(crop, 0, 500, W, H)).toEqual({ ...crop, y: 40 });
    expect(moveCrop(crop, 10.4, -5.6, W, H)).toEqual({ ...crop, x: 60, y: 14 });
  });
});

describe('resizeCrop', () => {
  // Opposite corner of each dragged corner, which must not move.
  const fixed = (c: Corner, r: typeof crop) => [
    c[1] === 'w' ? r.x + r.width : r.x,
    c[0] === 'n' ? r.y + r.height : r.y,
  ];

  it.each(['nw', 'ne', 'sw', 'se'] as Corner[])(
    'keeps the opposite corner fixed when dragging %s',
    (corner) => {
      const out = (corner[1] === 'w' ? -1 : 1) * 10;
      const down = (corner[0] === 'n' ? -1 : 1) * 10;
      const grown = resizeCrop(crop, corner, out, down, W, H, false);
      expect([grown.width, grown.height]).toEqual([110, 70]);
      expect(fixed(corner, grown)).toEqual(fixed(corner, crop));
      const shrunk = resizeCrop(crop, corner, -out, -down, W, H, false);
      expect([shrunk.width, shrunk.height]).toEqual([90, 50]);
      expect(fixed(corner, shrunk)).toEqual(fixed(corner, crop));
    },
  );

  it('keeps sides at least 10 px, even when dragged across the fixed corner', () => {
    expect(resizeCrop(crop, 'se', -95, -55, W, H, false)).toEqual({
      x: 50,
      y: 20,
      width: 10,
      height: 10,
    });
    expect(resizeCrop(crop, 'nw', 500, 500, W, H, false)).toEqual({
      x: 140,
      y: 70,
      width: 10,
      height: 10,
    });
  });

  it('stops at the image edge', () => {
    expect(resizeCrop(crop, 'se', 500, 500, W, H, false)).toEqual({
      x: 50,
      y: 20,
      width: 150,
      height: 80,
    });
  });

  it('stays square, following the axis that moved further', () => {
    const square = { x: 20, y: 20, width: 40, height: 40 };
    expect(resizeCrop(square, 'se', 30, 5, W, H, true)).toEqual({
      ...square,
      width: 70,
      height: 70,
    });
    expect(resizeCrop(square, 'se', -10, 0, W, H, true)).toEqual({
      ...square,
      width: 30,
      height: 30,
    });
    // Only 80 px of room below the fixed corner.
    expect(resizeCrop(square, 'se', 500, 0, W, H, true)).toEqual({
      ...square,
      width: 80,
      height: 80,
    });
  });
});

describe('squareCrop', () => {
  it('centers on the old crop', () => {
    expect(squareCrop({ x: 0, y: 30, width: 100, height: 40 }, W, H)).toEqual({
      x: 30,
      y: 30,
      width: 40,
      height: 40,
    });
  });

  it('squares the whole image', () => {
    expect(squareCrop({ x: 0, y: 0, width: W, height: H }, W, H)).toEqual({
      x: 50,
      y: 0,
      width: 100,
      height: 100,
    });
  });
});
