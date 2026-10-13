import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { Rect, RgbaImage } from '../core/image/types.ts';
import { moveCrop, resizeCrop, type Corner } from './crop.ts';

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
const MAX_WIDTH = 480;
const MAX_HEIGHT = 360;

/** The source image with a movable, resizable crop box over it. */
export function CropBox({
  image,
  crop,
  square,
  onChange,
}: {
  image: RgbaImage;
  crop: Rect;
  square: boolean;
  onChange: (crop: Rect) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width: W, height: H } = image;

  useEffect(() => {
    const c = canvas.current!;
    c.width = image.width;
    c.height = image.height;
    // Explicit display size: the crop box is positioned in percentages of it.
    const scale = Math.min(
      1,
      MAX_WIDTH / image.width,
      MAX_HEIGHT / image.height,
    );
    c.style.width = `${image.width * scale}px`;
    c.style.height = `${image.height * scale}px`;
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
  }, [image]);

  function startDrag(e: PointerEvent, corner: Corner | null) {
    e.preventDefault();
    e.stopPropagation();
    const start = crop;
    const scale = W / canvas.current!.getBoundingClientRect().width;
    const [x0, y0] = [e.clientX, e.clientY];
    // Window listeners keep the drag going when the pointer leaves the box.
    const move = (m: globalThis.PointerEvent) => {
      const dx = (m.clientX - x0) * scale;
      const dy = (m.clientY - y0) * scale;
      onChange(
        corner
          ? resizeCrop(start, corner, dx, dy, W, H, square)
          : moveCrop(start, dx, dy, W, H),
      );
    };
    const end = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  }

  function onKeyDown(e: KeyboardEvent) {
    const step = Math.max(1, Math.round(Math.min(W, H) * 0.02));
    const delta = (
      {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      } as Record<string, [number, number]>
    )[e.key];
    if (!delta) return;
    e.preventDefault();
    const [dx, dy] = delta;
    onChange(
      e.shiftKey
        ? resizeCrop(crop, 'se', dx, dy, W, H, square)
        : moveCrop(crop, dx, dy, W, H),
    );
  }

  const percent = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <figure className="crop">
      <div className="crop-frame">
        <canvas ref={canvas} />
        <div
          className="crop-box"
          role="group"
          tabIndex={0}
          aria-label="Crop area. Arrow keys move it; Shift+arrow keys resize it."
          style={{
            left: percent(crop.x, W),
            top: percent(crop.y, H),
            width: percent(crop.width, W),
            height: percent(crop.height, H),
          }}
          onPointerDown={(e) => startDrag(e, null)}
          onKeyDown={onKeyDown}
        >
          {CORNERS.map((corner) => (
            <div
              key={corner}
              className={`crop-handle ${corner}`}
              data-corner={corner}
              aria-hidden="true"
              onPointerDown={(e) => startDrag(e, corner)}
            />
          ))}
        </div>
      </div>
      <figcaption>
        Crop {crop.width} × {crop.height} px at ({crop.x}, {crop.y})
      </figcaption>
    </figure>
  );
}
