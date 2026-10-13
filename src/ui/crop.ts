import type { Rect } from '../core/image/types.ts';

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

const MIN_SIDE = 10;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Shifts the crop, keeping its size and keeping it inside the image. */
export function moveCrop(
  crop: Rect,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
): Rect {
  return {
    ...crop,
    x: clamp(Math.round(crop.x + dx), 0, imageWidth - crop.width),
    y: clamp(Math.round(crop.y + dy), 0, imageHeight - crop.height),
  };
}

/**
 * Drags one corner while the opposite corner stays fixed. Sides stay at least
 * 10 px and inside the image. When square, the side follows whichever axis
 * moved further.
 */
export function resizeCrop(
  crop: Rect,
  corner: Corner,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
  square: boolean,
): Rect {
  const west = corner[1] === 'w';
  const north = corner[0] === 'n';
  const fixedX = west ? crop.x + crop.width : crop.x;
  const fixedY = north ? crop.y + crop.height : crop.y;
  const roomX = west ? fixedX : imageWidth - fixedX;
  const roomY = north ? fixedY : imageHeight - fixedY;
  let width = clamp(
    Math.round(crop.width + (west ? -dx : dx)),
    MIN_SIDE,
    roomX,
  );
  let height = clamp(
    Math.round(crop.height + (north ? -dy : dy)),
    MIN_SIDE,
    roomY,
  );
  if (square) {
    width = height = Math.min(
      Math.abs(dx) >= Math.abs(dy) ? width : height,
      roomX,
      roomY,
    );
  }
  return {
    x: west ? fixedX - width : fixedX,
    y: north ? fixedY - height : fixedY,
    width,
    height,
  };
}

/** The largest square that fits the crop, centered on it and kept inside the image. */
export function squareCrop(
  crop: Rect,
  imageWidth: number,
  imageHeight: number,
): Rect {
  const side = Math.min(crop.width, crop.height);
  return {
    x: clamp(
      Math.round(crop.x + (crop.width - side) / 2),
      0,
      imageWidth - side,
    ),
    y: clamp(
      Math.round(crop.y + (crop.height - side) / 2),
      0,
      imageHeight - side,
    ),
    width: side,
    height: side,
  };
}
