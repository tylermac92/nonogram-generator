"""Command-line interface. A thin wrapper over the core package, mirroring the API."""

from pathlib import Path
from typing import Annotated, Optional

import typer

app = typer.Typer(
    name="nonogram",
    help="Turn an image into a nonogram with exactly one logically reachable solution.",
    no_args_is_help=True,
    add_completion=False,
)


def _not_implemented(command: str) -> None:
    typer.echo(f"nonogram {command}: not implemented yet.", err=True)
    raise typer.Exit(code=1)


@app.command()
def generate(
    image: Annotated[Path, typer.Argument(help="Source image (PNG, JPEG, GIF, WebP, BMP).")],
    size: Annotated[str, typer.Option("--size", help="Grid size as WIDTHxHEIGHT, e.g. 40x30.")],
    output: Annotated[Path, typer.Option("--output", "-o", help="Where to write the puzzle JSON.")],
    threshold: Annotated[
        Optional[float],
        typer.Option("--threshold", help="Brightness threshold in 0-1. Defaults to Otsu."),
    ] = None,
    seed: Annotated[
        Optional[int], typer.Option("--seed", help="Seed for tie-breaking between flip candidates.")
    ] = None,
) -> None:
    """Generate a uniquely solvable puzzle from an image."""
    _not_implemented("generate")


@app.command()
def export(
    puzzle: Annotated[Path, typer.Argument(help="Puzzle JSON file.")],
    output: Annotated[Path, typer.Option("--output", "-o", help="Where to write the PDF.")],
) -> None:
    """Export a puzzle and its solution as a printable PDF."""
    _not_implemented("export")


@app.command()
def solve(
    puzzle: Annotated[Path, typer.Argument(help="Puzzle JSON file.")],
) -> None:
    """Solve a puzzle and print its difficulty rating trace."""
    _not_implemented("solve")


@app.command()
def bench(
    sizes: Annotated[
        Optional[list[int]],
        typer.Option("--size", help="Grid side length; repeat for several. Default: 15 30 50 80."),
    ] = None,
    grids: Annotated[
        Optional[list[str]],
        typer.Option("--grid", help="Test grid (blobs, shapes, noise); repeat for several. Default: all."),
    ] = None,
    max_depth: Annotated[int, typer.Option("--max-depth", min=0, max=2, help="Deepest probing.")] = 2,
    depth2_budget: Annotated[
        Optional[float], typer.Option("--depth2-budget", help="Seconds allowed for depth-2 probing.")
    ] = None,
    json_out: Annotated[
        Optional[Path], typer.Option("--json", help="Also write the results as JSON here.")
    ] = None,
) -> None:
    """Benchmark the solver on fixed test grids at 15x15, 30x30, 50x50, and 80x80.

    Reports solve time, line-solver cache hit rates, and the technique trace:
    how many cells each technique deduced, and the resulting rating.
    """
    import json

    from nonogram.bench import GRIDS, SIZES, format_table, run_one
    from nonogram.solver.probe import DEFAULT_DEPTH2_BUDGET

    grids = grids or list(GRIDS)
    unknown = sorted(set(grids) - set(GRIDS))
    if unknown:
        raise typer.BadParameter(f"unknown grid {', '.join(unknown)}; choose from {', '.join(GRIDS)}")
    budget = DEFAULT_DEPTH2_BUDGET if depth2_budget is None else depth2_budget

    results = []
    for size in sizes or SIZES:
        for grid in grids:
            typer.echo(f"solving {grid} {size}x{size}...", err=True)
            results.append(run_one(grid, size, max_depth=max_depth, depth2_budget=budget))
    typer.echo(format_table(results))
    if json_out is not None:
        payload = {"max_depth": max_depth, "depth2_budget": budget, "results": [r.as_dict() for r in results]}
        json_out.write_text(json.dumps(payload, indent=2) + "\n")


if __name__ == "__main__":
    app()
