import { describe, expect, it } from 'vitest';
import { gridFromRows } from '../puzzle/grid.ts';
import { random } from '../test-utils.ts';
import {
  adjust,
  cleanup,
  downscale,
  otsu,
  threshold,
  toGray,
} from './pipeline.ts';
import type { GrayImage, RgbaImage } from './types.ts';

function rgba(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function gray(
  width: number,
  height: number,
  value: (x: number, y: number) => number,
): GrayImage {
  return toGray(
    rgba(
      width,
      height,
      (x, y) =>
        [...Array(3).fill(value(x, y)), 255] as [
          number,
          number,
          number,
          number,
        ],
    ),
  );
}

const whole = (image: GrayImage) => ({
  x: 0,
  y: 0,
  width: image.width,
  height: image.height,
});
const rows = (cells: Uint8Array, width: number) =>
  Array.from({ length: cells.length / width }, (_, y) =>
    Array.from(cells.subarray(y * width, (y + 1) * width)).join(''),
  );

describe('toGray', () => {
  it('uses Rec. 709 luminance weights', () => {
    const image = rgba(3, 1, (x) =>
      x === 0
        ? [255, 0, 0, 255]
        : x === 1
          ? [0, 255, 0, 255]
          : [0, 0, 255, 255],
    );
    expect(Array.from(toGray(image).data)).toEqual([54, 182, 18]);
  });

  it('composites transparency onto white', () => {
    const image = rgba(3, 1, (x) => [0, 0, 0, [0, 128, 255][x]!]);
    expect(Array.from(toGray(image).data)).toEqual([255, 127, 0]);
  });
});

describe('image to grid', () => {
  it.each([4, 8, 20, 40])(
    'turns a centered black square into a filled block at width %i',
    (width) => {
      const image = gray(200, 200, (x, y) =>
        x >= 50 && x < 150 && y >= 50 && y < 150 ? 0 : 255,
      );
      const values = downscale(image, whole(image), width, width);
      const grid = threshold(values, width, width, otsu(values), false);
      const lo = width / 4;
      const hi = (width * 3) / 4;
      grid.cells.forEach((cell, i) => {
        const x = i % width;
        const y = Math.floor(i / width);
        expect(cell, `cell ${x},${y}`).toBe(
          x >= lo && x < hi && y >= lo && y < hi ? 1 : 0,
        );
      });
    },
  );
});

describe('downscale', () => {
  it('averages a 1-px checkerboard to exact mid-gray', () => {
    const image = gray(256, 256, (x, y) => ((x + y) % 2 ? 255 : 0));
    const values = downscale(image, whole(image), 8, 8);
    expect(Array.from(values)).toEqual(Array(64).fill(127.5));
  });

  it('averages a 3-px checkerboard at an uneven ratio without aliasing', () => {
    const image = gray(300, 300, (x, y) =>
      (Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? 255 : 0,
    );
    for (const v of downscale(image, whole(image), 7, 7)) {
      expect(v).toBeGreaterThanOrEqual(100);
      expect(v).toBeLessThanOrEqual(155);
    }
  });

  it('enlarges by repeating each pixel', () => {
    const image = gray(2, 2, (x, y) => [10, 20, 30, 40][y * 2 + x]!);
    expect(Array.from(downscale(image, whole(image), 4, 4))).toEqual([
      10, 10, 20, 20, 10, 10, 20, 20, 30, 30, 40, 40, 30, 30, 40, 40,
    ]);
  });

  it('downscales a crop the same as an image cut to that crop', () => {
    const value = (x: number, y: number) => (x * 7 + y * 13) % 256;
    const image = gray(100, 80, value);
    const cut = gray(60, 40, (x, y) => value(x + 10, y + 20));
    expect(
      downscale(image, { x: 10, y: 20, width: 60, height: 40 }, 6, 4),
    ).toEqual(downscale(cut, whole(cut), 6, 4));
  });

  it('rejects a crop outside the image', () => {
    const image = gray(10, 10, () => 0);
    expect(() =>
      downscale(image, { x: 5, y: 0, width: 10, height: 10 }, 5, 5),
    ).toThrow(RangeError);
  });
});

describe('adjust', () => {
  const values = Float32Array.from([0, 64, 128, 200, 255]);

  it('leaves values unchanged at (0, 0)', () => {
    expect(adjust(values, 0, 0)).toEqual(values);
  });

  it('shifts with brightness and clamps', () => {
    expect(Array.from(adjust(values, 50, 0))).toEqual([64, 128, 192, 255, 255]);
    expect(Array.from(adjust(values, -100, 0))).toEqual([0, 0, 0, 72, 127]);
  });

  it('flattens to mid-gray at contrast -100', () => {
    expect(Array.from(adjust(values, 0, -100))).toEqual(Array(5).fill(128));
  });
});

describe('otsu', () => {
  it('picks a cutoff between the two peaks of a two-tone image', () => {
    const next = random(3);
    const values = Float32Array.from(
      { length: 1000 },
      (_, i) => (i % 3 ? 200 : 40) + (next() - 0.5) * 30,
    );
    const cutoff = otsu(values);
    expect(cutoff).toBeGreaterThan(55);
    expect(cutoff).toBeLessThan(185);
  });

  it('splits pure black and white in the middle', () => {
    expect(otsu([0, 0, 255, 255])).toBe(128);
  });

  it('returns 128 for a single tone', () => {
    expect(otsu([90, 90, 90])).toBe(128);
  });
});

describe('threshold', () => {
  it('fills cells darker than the cutoff', () => {
    const grid = threshold(
      Float32Array.from([10, 127, 128, 250]),
      2,
      2,
      128,
      false,
    );
    expect(Array.from(grid.cells)).toEqual([1, 1, 0, 0]);
  });

  it('inverts to the exact complement', () => {
    const next = random(11);
    for (let c = 0; c < 50; c++) {
      const values = Float32Array.from({ length: 35 }, () => next() * 255);
      const cutoff = Math.floor(next() * 256);
      const normal = threshold(values, 7, 5, cutoff, false);
      const inverted = threshold(values, 7, 5, cutoff, true);
      expect(inverted.cells).toEqual(normal.cells.map((v) => 1 - v));
    }
  });
});

describe('cleanup', () => {
  const clean = (input: string[]) => {
    const grid = cleanup(gridFromRows(input));
    return rows(grid.cells, grid.width);
  };

  it('removes an isolated filled cell', () => {
    expect(clean(['00000', '00100', '00000'])).toEqual([
      '00000',
      '00000',
      '00000',
    ]);
  });

  it('fills a single-cell hole', () => {
    expect(clean(['11111', '11011', '11111'])).toEqual([
      '11111',
      '11111',
      '11111',
    ]);
  });

  it('leaves 2-cell runs and 2-cell holes alone', () => {
    const input = [
      '0000000',
      '0110010',
      '0000010',
      '1111111',
      '1100111',
      '1111111',
    ];
    expect(clean(input)).toEqual(input);
  });

  it('never treats a border cell as a hole', () => {
    const input = ['101', '111'];
    expect(clean(input)).toEqual(input);
  });
});
