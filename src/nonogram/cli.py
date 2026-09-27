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
def bench() -> None:
    """Benchmark solving and generation at 15x15, 30x30, 50x50, and 80x80."""
    _not_implemented("bench")


if __name__ == "__main__":
    app()
