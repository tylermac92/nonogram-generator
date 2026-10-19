# Sample images

The pictures offered under "Try a sample". Each is free to bundle: public domain (CC0) or made for this project.

| File                                     | Source                                                                                                                                           | Author                    | Licence               | Changes                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | --------------------- | -------------------------- |
| `horse.jpg`                              | scikit-image 0.26.0 sample data, `skimage/data/horse.png`, originally from [openclipart](http://openclipart.org/detail/158377/horse-by-marauder) | Andreas Preuss (marauder) | CC0                   | Saved as JPEG (quality 85) |
| `cameraman.jpg`                          | scikit-image 0.26.0 sample data, `skimage/data/camera.png`                                                                                       | Lav Varshney              | CC0                   | Saved as JPEG (quality 85) |
| `cat.jpg`, `sailboat.jpg`, `skyline.jpg` | Drawn by `draw.py` in this folder                                                                                                                | This project              | Owned by this project | None                       |

The scikit-image licences are stated in the docstrings of `skimage.data.horse()` and `skimage.data.camera()`. To recreate the files:

```sh
pip download --no-deps scikit-image==0.26.0 && unzip -o scikit_image-*.whl 'skimage/data/*'
convert skimage/data/horse.png -strip -quality 85 horse.jpg
convert skimage/data/camera.png -strip -quality 85 cameraman.jpg
python3 draw.py  # needs Pillow; writes cat.jpg, sailboat.jpg and skyline.jpg
```
