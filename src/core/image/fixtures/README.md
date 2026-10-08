# Image fixtures

Made with Pillow (`python3 -m pip install pillow`), from this folder:

```sh
python3 -c "
from PIL import Image
img = Image.new('L', (40, 20), 255); img.paste(0, (0, 0, 20, 20))
exif = Image.Exif(); exif[0x0112] = 6
img.save('exif-rotated.jpg', quality=95, exif=exif)
png = Image.new('RGBA', (20, 20), (0, 0, 0, 0)); png.paste((0, 0, 0, 255), (5, 5, 15, 15))
png.save('transparent.png')
"
```

- `exif-rotated.jpg`: stored 40x20 with the left half black, EXIF Orientation 6 (rotate 90° clockwise to display). Shown upright it is 20x40 with the top half black.
- `transparent.png`: 20x20, fully transparent except an opaque black 10x10 square in the middle.
