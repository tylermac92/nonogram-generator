import json

import numpy as np
import pytest
from typer.testing import CliRunner

from nonogram.bench import GRIDS, SIZES, format_table, run_one
from nonogram.cli import app


def test_sizes_match_the_plan():
    assert SIZES == (15, 30, 50, 80)


@pytest.mark.parametrize("grid", GRIDS)
def test_grids_are_fixed_and_sized(grid):
    a, b = GRIDS[grid](30), GRIDS[grid](30)
    assert a.shape == (30, 30) and a.dtype == bool
    assert np.array_equal(a, b), "benchmark grids must be deterministic"
    assert 0.1 < a.mean() < 0.9, "grid is nearly empty or nearly full"


def test_run_one_reports_time_hit_rate_and_trace():
    result = run_one("shapes", 30, max_depth=2)
    assert result.status == "solved" and result.rating == "hard"
    assert result.seconds >= 0
    assert 0 <= result.simple_hit_rate <= 1 and 0 <= result.full_hit_rate <= 1
    counted = result.simple_cells + result.full_cells + result.probe1_cells + result.probe2_cells
    assert counted == 30 * 30 - result.unknown_cells


def test_format_table_has_a_row_per_result():
    results = [run_one("blobs", 15), run_one("noise", 15)]
    lines = format_table(results).splitlines()
    assert len(lines) == 2 + len(results)
    assert "time (s)" in lines[0] and "simple hit" in lines[0]


def test_bench_command_prints_table_and_writes_json(tmp_path):
    out = tmp_path / "bench.json"
    result = CliRunner().invoke(
        app, ["bench", "--size", "15", "--grid", "blobs", "--grid", "shapes", "--json", str(out)]
    )
    assert result.exit_code == 0, result.output
    assert "blobs" in result.stdout and "shapes" in result.stdout
    payload = json.loads(out.read_text())
    assert payload["max_depth"] == 2
    assert [(r["grid"], r["size"]) for r in payload["results"]] == [("blobs", 15), ("shapes", 15)]


def test_bench_command_rejects_unknown_grid():
    result = CliRunner().invoke(app, ["bench", "--grid", "nope"])
    assert result.exit_code != 0
