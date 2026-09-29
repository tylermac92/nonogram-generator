"""Image pipeline: load, crop, grayscale, downsample, and Otsu threshold."""

import hashlib
import io
import os
import warnings
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

MIN_SIDE, MAX_SIDE = 5, 80
MAX_BYTES = 20 * 1024 * 1024
FORMATS = ("PNG", "JPEG", "GIF", "WEBP", "BMP")
FORMAT_NAMES = "PNG, JPEG, GIF, WebP, or BMP"

# Modes that carry an alpha channel; palette images may carry one in their
# "transparency" entry instead.
_ALPHA_MODES = {"RGBA", "RGBa", "LA", "La", "PA"}


class ImageError(ValueError):
    """The image or its settings can't be used: wrong format, too large,
    corrupt, a bad crop, or a grid size or adjustment out of range."""


@dataclass(frozen=True)
class LoadedImage:
    """An upright RGB image with transparency flattened onto white.

    ``sha256`` is the hex digest of the file's bytes as uploaded, so it
    identifies the source regardless of how it was decoded.
    """

    image: Image.Image
    sha256: str

    @property
    def size(self) -> tuple[int, int]:
        return self.image.size


def load_image(source: bytes | str | os.PathLike) -> LoadedImage:
    """Load an image from bytes or a path, validating size and format.

    Applies EXIF orientation, flattens transparency onto white, and returns
    an RGB image. Animated GIF and WebP files use their first frame.
    Raises ``ImageError`` with a message fit for the user on any problem.
    """
    data = _read(source)
    digest = hashlib.sha256(data).hexdigest()
    with warnings.catch_warnings():
        # Pillow warns before it refuses; treat both as too large.
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            with Image.open(io.BytesIO(data), formats=FORMATS) as opened:
                opened.load()
                upright = ImageOps.exif_transpose(opened)
                image = _flatten(upright)
        except UnidentifiedImageError:
            if _looks_supported(data):
                raise ImageError("Image file is corrupt or truncated.") from None
            raise ImageError(f"Unsupported image format: expected {FORMAT_NAMES}.") from None
        except (Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise ImageError(
                f"Image has too many pixels (limit {Image.MAX_IMAGE_PIXELS:,})."
            ) from None
        except (OSError, SyntaxError, ValueError) as exc:
            raise ImageError(f"Image file is corrupt or truncated: {exc}") from None
    return LoadedImage(image=image, sha256=digest)


def crop(image: Image.Image, box: tuple[int, int, int, int] | list[int]) -> Image.Image:
    """Crop to ``box`` = (left, top, right, bottom) in pixels of the upright image.

    The box must lie inside the image and have positive width and height.
    """
    if len(box) != 4 or not all(isinstance(v, int) and not isinstance(v, bool) for v in box):
        raise ImageError(f"Crop box must be four integers (left, top, right, bottom), got {box!r}.")
    left, top, right, bottom = box
    width, height = image.size
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        raise ImageError(
            f"Crop box {list(box)} doesn't fit a {width}x{height} image; it needs "
            f"0 <= left < right <= {width} and 0 <= top < bottom <= {height}."
        )
    return image.crop((left, top, right, bottom))


def grayscale(image: Image.Image) -> np.ndarray:
    """Luminance as a ``uint8`` array of shape (height, width), via Pillow mode ``L``."""
    return np.asarray(image.convert("L"))


def adjust(values: np.ndarray, gamma: float = 1.0, contrast: float = 1.0) -> np.ndarray:
    """Apply gamma, then contrast, to brightness values in 0–1.

    Gamma raises each value to ``1 / gamma``, so gamma above 1 brightens the
    midtones and below 1 darkens them. Contrast scales the distance from
    mid-gray (0.5), clipping to 0–1. A setting of exactly 1.0 is skipped, so
    the defaults return the values unchanged.
    """
    _check_positive("Gamma", gamma, allow_zero=False)
    _check_positive("Contrast", contrast, allow_zero=True)
    out = np.asarray(values, dtype=np.float64)
    if gamma != 1.0:
        out = out ** (1.0 / gamma)
    if contrast != 1.0:
        out = np.clip(0.5 + (out - 0.5) * contrast, 0.0, 1.0)
    return out


def downsample(values: np.ndarray, rows: int, cols: int) -> np.ndarray:
    """Box-filter a (height, width) array to (rows, cols).

    Each cell is the area-weighted mean of the source pixels it covers,
    counting pixels split by a cell boundary in proportion to their overlap.
    """
    height, width = values.shape
    row_weights, col_weights = _box_weights(height, rows), _box_weights(width, cols)
    return row_weights @ np.asarray(values, dtype=np.float64) @ col_weights.T


def brightness_grid(
    image: Image.Image, rows: int, cols: int, *, gamma: float = 1.0, contrast: float = 1.0
) -> np.ndarray:
    """Cell brightness in 0–1 (0 black, 1 white), shape (rows, cols).

    Converts to luminance, applies gamma and contrast to the full-resolution
    pixels, then box-filters down to the grid. Works in bands of source rows
    so a large photo never needs a full-resolution float copy.
    """
    for name, side in (("Rows", rows), ("Columns", cols)):
        if isinstance(side, bool) or not isinstance(side, (int, np.integer)):
            raise ImageError(f"{name} must be an integer, got {side!r}.")
        if not MIN_SIDE <= side <= MAX_SIDE:
            raise ImageError(f"{name} must be between {MIN_SIDE} and {MAX_SIDE}, got {side}.")
    # Luminance has only 256 levels, so the tone curve is a lookup table.
    curve = adjust(np.arange(256) / 255.0, gamma, contrast)
    gray = grayscale(image)
    height, width = gray.shape
    row_weights, col_weights = _box_weights(height, rows), _box_weights(width, cols)
    band = max(1, _BAND_PIXELS // width)
    reduced = np.zeros((rows, width))
    for start in range(0, height, band):
        stop = min(start + band, height)
        reduced += row_weights[:, start:stop] @ curve[gray[start:stop]]
    return reduced @ col_weights.T


def otsu_threshold(grid: np.ndarray) -> float:
    """Otsu's threshold for a brightness grid: the default slider value.

    Tries every split between consecutive distinct brightness values and
    keeps the one that maximises the variance between the dark and light
    groups (equivalently, minimises the variance within them). Returns the
    midpoint of that split, so the dark group falls below the threshold
    (filled) and the light group at or above it (empty). The search is exact
    rather than over histogram bins, which matters on small grids. Ties go
    to the darker split. A grid with a single brightness has nothing to
    separate and gets 0.5.
    """
    values = np.asarray(grid, dtype=np.float64).ravel()
    if values.size == 0 or not np.isfinite(values).all():
        raise ImageError("Brightness grid must be non-empty and finite.")
    levels, counts = np.unique(values, return_counts=True)
    if len(levels) == 1:
        return 0.5
    # Dark group = levels[: k + 1] for each split k; light group = the rest.
    dark_count = np.cumsum(counts)[:-1].astype(np.float64)
    dark_sum = np.cumsum(counts * levels)[:-1]
    light_count = values.size - dark_count
    light_sum = values.sum() - dark_sum
    between = dark_count * light_count * (dark_sum / dark_count - light_sum / light_count) ** 2
    k = int(np.argmax(between))
    return float((levels[k] + levels[k + 1]) / 2)


_BAND_PIXELS = 1 << 22  # about 32 MB of float64 per band


def _box_weights(pixels: int, cells: int) -> np.ndarray:
    """A (cells, pixels) matrix whose rows average each cell's span of pixels."""
    edges = np.linspace(0.0, pixels, cells + 1)
    starts = np.arange(pixels)
    overlap = np.minimum(starts + 1, edges[1:, None]) - np.maximum(starts, edges[:-1, None])
    weights = np.clip(overlap, 0.0, None)
    return weights / weights.sum(axis=1, keepdims=True)


def _check_positive(name: str, value: float, *, allow_zero: bool) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value):
        raise ImageError(f"{name} must be a finite number, got {value!r}.")
    if value < 0 or (value == 0 and not allow_zero):
        bound = "at least 0" if allow_zero else "greater than 0"
        raise ImageError(f"{name} must be {bound}, got {value}.")


def _read(source: bytes | str | os.PathLike) -> bytes:
    if isinstance(source, (bytes, bytearray, memoryview)):
        data = bytes(source)
    else:
        try:
            with open(source, "rb") as f:
                # Read one byte past the cap so an oversized file is caught
                # without reading all of it.
                data = f.read(MAX_BYTES + 1)
        except OSError as exc:
            raise ImageError(f"Can't read image file: {exc}") from None
    if len(data) > MAX_BYTES:
        raise ImageError(f"Image file is larger than the {MAX_BYTES // (1024 * 1024)} MB limit.")
    if not data:
        raise ImageError("Image file is empty.")
    return data


_SIGNATURES = (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF87a", b"GIF89a", b"BM")


def _looks_supported(data: bytes) -> bool:
    """Whether the bytes start like one of the accepted formats."""
    return data.startswith(_SIGNATURES) or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")


def _flatten(image: Image.Image) -> Image.Image:
    """Return an RGB copy with any transparency composited onto white."""
    if image.mode in ("I", "I;16", "I;16B", "I;16L"):
        # 16-bit grayscale PNG: scale to 8 bits rather than clipping at 255.
        image = image.convert("I").point(lambda v: v / 257).convert("L")
    has_alpha = image.mode in _ALPHA_MODES or (
        image.mode in ("P", "L", "RGB") and "transparency" in image.info
    )
    if not has_alpha:
        return image.convert("RGB")
    rgba = image.convert("RGBA")
    white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    return Image.alpha_composite(white, rgba).convert("RGB")
