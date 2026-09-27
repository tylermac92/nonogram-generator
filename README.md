# nonogram-generator

Turn any image into a nonogram with exactly one logically reachable solution.
See `docs/product_brief.md` and `docs/technical_design_document.md`.

## Development

```sh
pip install -e ".[dev]"   # add ",numba" for the optional JIT extra
pytest
nonogram --help
```
