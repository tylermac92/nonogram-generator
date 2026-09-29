"""Image pipeline: load, crop, grayscale, downsample, and Otsu threshold."""

import hashlib
import io
import os
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 20 * 1024 * 1024
FORMATS = ("PNG", "JPEG", "GIF", "WEBP", "BMP")
FORMAT_NAMES = "PNG, JPEG, GIF, WebP, or BMP"

# Modes that carry an alpha channel; palette images may carry one in their
# "transparency" entry instead.
_ALPHA_MODES = {"RGBA", "RGBa", "LA", "La", "PA"}


class ImageError(ValueError):
    """The image can't be used: wrong format, too large, corrupt, or a bad crop."""


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
