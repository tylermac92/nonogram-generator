/** Same shape as the browser's ImageData, so tests can build one in Node. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA, row-major, not premultiplied
}

/** Full-resolution luminance, 0–255 per pixel. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** In source pixels; fractional values are allowed. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
