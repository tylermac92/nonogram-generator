import hashlib
import io

import numpy as np
import pytest
from PIL import Image

from nonogram import image as image_module
from nonogram.image import MAX_BYTES, ImageError, crop, load_image

ORIENTATION = 0x0112


def encode(im: Image.Image, fmt: str, **kwargs) -> bytes:
    buffer = io.BytesIO()
    im.save(buffer, fmt, **kwargs)
    return buffer.getvalue()


def pixels(im: Image.Image) -> np.ndarray:
    return np.asarray(im)


def marked(width=3, height=2) -> Image.Image:
    """White image with a black top-left pixel, to follow rotations."""
    im = Image.new("RGB", (width, height), (255, 255, 255))
    im.putpixel((0, 0), (0, 0, 0))
    return im


# --- formats -----------------------------------------------------------------


@pytest.mark.parametrize(
    "fmt, kwargs",
    [("PNG", {}), ("JPEG", {"quality": 100}), ("GIF", {}), ("WEBP", {"lossless": True}), ("BMP", {})],
)
def test_accepts_supported_formats(fmt, kwargs):
    loaded = load_image(encode(Image.new("RGB", (4, 3), (200, 100, 50)), fmt, **kwargs))
    assert loaded.image.mode == "RGB"
    assert loaded.size == (4, 3)


def test_accepts_multi_picture_jpeg():
    # Cameras often write MPO, which Pillow reads as a kind of JPEG.
    first, second = Image.new("RGB", (4, 3), "black"), Image.new("RGB", (4, 3), "white")
    data = encode(first, "MPO", save_all=True, append_images=[second])
    assert load_image(data).size == (4, 3)


def test_animated_gif_uses_first_frame():
    frames = [Image.new("L", (2, 2), 0), Image.new("L", (2, 2), 255)]
    data = encode(frames[0], "GIF", save_all=True, append_images=frames[1:])
    assert pixels(load_image(data).image).max() == 0


@pytest.mark.parametrize("fmt", ["TIFF", "ICO", "PPM", "TGA"])
def test_rejects_other_formats(fmt):
    with pytest.raises(ImageError, match="Unsupported image format.*PNG, JPEG, GIF, WebP, or BMP"):
        load_image(encode(Image.new("RGB", (16, 16)), fmt))


def test_rejects_non_images():
    with pytest.raises(ImageError, match="Unsupported image format"):
        load_image(b"%PDF-1.4 not an image")
    with pytest.raises(ImageError, match="empty"):
        load_image(b"")


@pytest.mark.parametrize("keep", [20, 40, 0.5])
def test_rejects_truncated_files(keep):
    data = encode(Image.effect_noise((64, 64), 50).convert("RGB"), "PNG")
    cut = data[: int(len(data) * keep) if isinstance(keep, float) else keep]
    with pytest.raises(ImageError, match="corrupt or truncated"):
        load_image(cut)


def test_rejects_files_over_20_mb(tmp_path):
    assert MAX_BYTES == 20 * 1024 * 1024
    # A valid PNG padded past the cap: the size check must win.
    oversized = encode(Image.new("RGB", (4, 4)), "PNG").ljust(MAX_BYTES + 1, b"\0")
    with pytest.raises(ImageError, match="larger than the 20 MB limit"):
        load_image(oversized)
    path = tmp_path / "big.png"
    path.write_bytes(oversized)
    with pytest.raises(ImageError, match="larger than the 20 MB limit"):
        load_image(path)


def test_accepts_a_file_at_exactly_20_mb():
    # PNG decoders ignore data after IEND, so padding keeps the file valid.
    data = encode(Image.new("RGB", (4, 4)), "PNG").ljust(MAX_BYTES, b"\0")
    assert load_image(data).size == (4, 4)


def test_rejects_decompression_bombs(monkeypatch):
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)
    with pytest.raises(ImageError, match="too many pixels"):
        load_image(encode(Image.new("RGB", (20, 20)), "PNG"))


def test_missing_path_is_an_image_error(tmp_path):
    with pytest.raises(ImageError, match="Can't read"):
        load_image(tmp_path / "nope.png")


# --- orientation ---------------------------------------------------------------


@pytest.mark.parametrize(
    "orientation, size, black",
    [
        (1, (3, 2), (0, 0)),  # as stored
        (3, (3, 2), (1, 2)),  # rotated 180°
        (6, (2, 3), (0, 1)),  # rotated 90° clockwise to display
        (8, (2, 3), (2, 0)),  # rotated 90° counter-clockwise to display
        (2, (3, 2), (0, 2)),  # mirrored
    ],
)
def test_applies_exif_orientation(orientation, size, black):
    exif = Image.Exif()
    exif[ORIENTATION] = orientation
    upright = load_image(encode(marked(), "PNG", exif=exif)).image
    assert upright.size == size
    grid = pixels(upright)[..., 0]
    assert grid[black] == 0 and (grid == 0).sum() == 1
    assert upright.getexif().get(ORIENTATION, 1) == 1  # nothing left to apply


def test_applies_exif_orientation_to_jpeg():
    exif = Image.Exif()
    exif[ORIENTATION] = 6
    big = marked().resize((30, 20), Image.Resampling.NEAREST)  # blocks survive JPEG
    upright = load_image(encode(big, "JPEG", exif=exif, quality=95)).image
    assert upright.size == (20, 30)
    grid = pixels(upright.convert("L"))
    assert grid[5, 15] < 64  # the black block moved to the top right
    assert grid[5, 5] > 192 and grid[25, 15] > 192


# --- transparency ----------------------------------------------------------------


def test_flattens_rgba_onto_white():
    im = Image.new("RGBA", (3, 1))
    im.putpixel((0, 0), (0, 0, 0, 0))  # fully transparent black
    im.putpixel((1, 0), (0, 0, 0, 128))  # half-transparent black
    im.putpixel((2, 0), (10, 20, 30, 255))  # opaque colour
    out = pixels(load_image(encode(im, "PNG")).image)
    assert out[0, 0].tolist() == [255, 255, 255]
    assert out[0, 1].tolist() == [127, 127, 127]
    assert out[0, 2].tolist() == [10, 20, 30]


def test_flattens_grayscale_alpha_onto_white():
    im = Image.new("LA", (2, 1))
    im.putpixel((0, 0), (0, 0))
    im.putpixel((1, 0), (0, 255))
    out = pixels(load_image(encode(im, "PNG")).image)
    assert out[0, 0].tolist() == [255, 255, 255]
    assert out[0, 1].tolist() == [0, 0, 0]


def test_flattens_palette_transparency_onto_white():
    im = Image.new("P", (2, 1))
    im.putpalette([0, 0, 0, 255, 0, 0])
    im.putpixel((0, 0), 0)
    im.putpixel((1, 0), 1)
    for fmt in ("GIF", "PNG"):
        out = pixels(load_image(encode(im, fmt, transparency=0)).image)
        assert out[0, 0].tolist() == [255, 255, 255], fmt
        assert out[0, 1].tolist() == [255, 0, 0], fmt


def test_flattens_webp_transparency_onto_white():
    im = Image.new("RGBA", (2, 1), (0, 0, 0, 0))
    im.putpixel((1, 0), (0, 0, 0, 255))
    out = pixels(load_image(encode(im, "WEBP", lossless=True)).image)
    assert out[0, 0].tolist() == [255, 255, 255]
    assert out[0, 1].tolist() == [0, 0, 0]


def test_sixteen_bit_grayscale_keeps_its_range():
    im = Image.fromarray(np.array([[0, 32896, 65535]], dtype=np.uint16))
    out = pixels(load_image(encode(im, "PNG")).image)[..., 0]
    assert out.tolist() == [[0, 128, 255]]


# --- hash ------------------------------------------------------------------------


def test_sha256_is_of_the_file_bytes(tmp_path):
    data = encode(marked(), "PNG")
    expected = hashlib.sha256(data).hexdigest()
    assert load_image(data).sha256 == expected
    path = tmp_path / "picture.png"
    path.write_bytes(data)
    assert load_image(path).sha256 == expected
    assert load_image(str(path)).sha256 == expected


def test_sha256_tells_images_apart():
    a = load_image(encode(marked(), "PNG")).sha256
    b = load_image(encode(marked(4, 2), "PNG")).sha256
    assert a != b and len(a) == 64


# --- crop ------------------------------------------------------------------------


def test_crop_keeps_the_box():
    im = Image.fromarray(np.arange(4 * 5 * 3, dtype=np.uint8).reshape(4, 5, 3))
    out = crop(im, (1, 2, 4, 4))
    assert out.size == (3, 2)
    assert np.array_equal(pixels(out), pixels(im)[2:4, 1:4])
    assert crop(im, [0, 0, 5, 4]).size == (5, 4)


def test_crop_applies_to_the_upright_image():
    exif = Image.Exif()
    exif[ORIENTATION] = 6  # stored 3x2, displayed 2x3 with black at top right
    upright = load_image(encode(marked(), "PNG", exif=exif)).image
    corner = crop(upright, (1, 0, 2, 1))
    assert pixels(corner)[0, 0].tolist() == [0, 0, 0]


@pytest.mark.parametrize(
    "box",
    [
        (0, 0, 6, 4),  # past the right edge
        (0, 0, 5, 5),  # past the bottom edge
        (-1, 0, 5, 4),  # negative
        (2, 0, 2, 4),  # zero width
        (0, 3, 5, 1),  # upside down
        (0, 0, 5),  # too short
        (0.0, 0, 5, 4),  # not integers
        (True, 0, 5, 4),
    ],
)
def test_crop_rejects_bad_boxes(box):
    with pytest.raises(ImageError, match="Crop box"):
        crop(Image.new("RGB", (5, 4)), box)


def test_image_error_is_a_value_error():
    assert issubclass(image_module.ImageError, ValueError)
