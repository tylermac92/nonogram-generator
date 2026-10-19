import { useEffect, useMemo, useRef, useState } from 'react';
import type { Rect, RgbaImage } from '../core/image/types.ts';
import type { Grid } from '../core/puzzle/types.ts';

const BOX = 320; // largest side of each picture, in CSS pixels

/** The photo's crop beside the grid, or the grid laid over it at 50%. */
export function Compare({
  image,
  crop,
  grid,
}: {
  image: RgbaImage;
  crop: Rect;
  grid: Grid;
}) {
  const [overlay, setOverlay] = useState(false);
  const photo = useRef<HTMLCanvasElement>(null);
  const cells = useRef<HTMLCanvasElement>(null);
  const scale = Math.min(BOX / crop.width, BOX / crop.height);
  const width = Math.round(crop.width * scale);
  const height = Math.round(crop.height * scale);

  const source = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    c.getContext('2d')!.putImageData(
      // Decoded pixels always sit on a plain ArrayBuffer, so the cast is safe.
      new ImageData(
        image.data as Uint8ClampedArray<ArrayBuffer>,
        image.width,
        image.height,
      ),
      0,
      0,
    );
    return c;
  }, [image]);

  useEffect(() => {
    const { x, y, width: w, height: h } = crop;
    photo
      .current!.getContext('2d')!
      .drawImage(source, x, y, w, h, 0, 0, width, height);
  }, [source, crop, width, height]);

  useEffect(() => {
    // The grid spans exactly the crop, the area each cell was averaged from.
    const g = cells.current!.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, width, height);
    g.fillStyle = '#000';
    const at = (i: number, n: number, size: number) =>
      Math.round((i * size) / n);
    grid.cells.forEach((v, i) => {
      if (!v) return;
      const [cx, cy] = [i % grid.width, Math.floor(i / grid.width)];
      const x = at(cx, grid.width, width);
      const y = at(cy, grid.height, height);
      g.fillRect(
        x,
        y,
        at(cx + 1, grid.width, width) - x,
        at(cy + 1, grid.height, height) - y,
      );
    });
  }, [grid, width, height]);

  return (
    <details className="compare">
      <summary>Compare with the photo</summary>
      <label>
        <input
          type="checkbox"
          checked={overlay}
          onChange={(e) => setOverlay(e.target.checked)}
        />{' '}
        Overlay the grid on the photo
      </label>
      <div className={overlay ? 'pictures overlay' : 'pictures'}>
        <canvas
          ref={photo}
          width={width}
          height={height}
          role="img"
          aria-label="Photo crop"
        />
        <canvas
          ref={cells}
          width={width}
          height={height}
          role="img"
          aria-label="Grid"
        />
      </div>
    </details>
  );
}
