import { describe, expect, it } from 'vitest';
import { makePuzzle } from '../puzzle/clues.ts';
import { createGrid } from '../puzzle/grid.ts';
import { svgToPng, toJpeg } from './canvas.ts';
import { CELL, renderSvg } from './svg.ts';

// 10x10 with two filled cells, (0,0) and (7,7); row 3 is empty.
const cells = new Uint8Array(100);
cells[0] = cells[77] = 1;
const puzzle = makePuzzle(createGrid(10, 10, cells));
const svg = renderSvg(puzzle, { solution: true });
// Longest clues have one number, plus 10 px padding.
const left = 10 + CELL;
const top = 10 + CELL;
const size = left + 10 * CELL + 10;

async function pixels(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  const { data, width, height } = context.getImageData(
    0,
    0,
    bitmap.width,
    bitmap.height,
  );
  return {
    width,
    height,
    at: (x: number, y: number) => [
      ...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 3),
    ],
  };
}

describe('svgToPng', () => {
  it('produces SVG that parses and loads as an image', async () => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await img.decode();
    expect(img.naturalWidth).toBe(size);
  });

  it.each([1, 2, 4])('is sharp at %ix', async (scale) => {
    const png = await pixels(await svgToPng(svg, scale));
    expect([png.width, png.height]).toEqual([size * scale, size * scale]);
    const px = (x: number, y: number) =>
      png.at(Math.floor(x * scale), Math.floor(y * scale));
    const centre = (cx: number, cy: number) =>
      px(left + (cx + 0.5) * CELL, top + (cy + 0.5) * CELL);
    const BLACK = [0, 0, 0];
    const WHITE = [255, 255, 255];
    expect(centre(0, 0)).toEqual(BLACK);
    expect(centre(7, 7)).toEqual(BLACK);
    expect(centre(1, 0)).toEqual(WHITE);
    expect(centre(5, 3)).toEqual(WHITE);

    // Along empty row 3: the bold line at column 5 covers exactly 2 units,
    // and the thin line at column 6 exactly 1 unit, with no blur either side.
    const y = Math.floor((top + 3.5 * CELL) * scale);
    const row = (from: number, to: number) =>
      Array.from({ length: (to - from) * scale + 2 }, (_, i) =>
        png.at(from * scale - 1 + i, y),
      );
    const bold = left + 5 * CELL;
    expect(row(bold - 1, bold + 1)).toEqual([
      WHITE,
      ...Array(2 * scale).fill(BLACK),
      WHITE,
    ]);
    const thin = left + 6 * CELL;
    expect(row(thin, thin + 1)).toEqual([
      WHITE,
      ...Array(scale).fill([153, 153, 153]),
      WHITE,
    ]);
  });
});

describe('toJpeg', () => {
  const image = (width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4).fill(200),
  });

  it('halves a large image until its long side fits in 512 px', async () => {
    const { url, scale } = toJpeg(image(2048, 1000));
    expect(scale).toBe(1 / 4);
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    expect([bitmap.width, bitmap.height]).toEqual([512, 250]);
  });

  it('keeps a small image at its size', async () => {
    const { url, scale } = toJpeg(image(300, 200));
    expect(scale).toBe(1);
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    expect([bitmap.width, bitmap.height]).toEqual([300, 200]);
  });
});
