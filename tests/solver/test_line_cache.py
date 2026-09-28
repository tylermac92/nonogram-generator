import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from line_reference import any_lines, parse, show
from nonogram.solver.line import (
    DEFAULT_CACHE_SIZE,
    CachedLineSolver,
    CacheStats,
    solve_full,
    solve_simple,
)

SOLVERS = pytest.mark.parametrize("solver", [solve_simple, solve_full], ids=["simple", "full"])


def same(a, b) -> bool:
    return (a is None and b is None) or (
        a is not None and b is not None and a.dtype == b.dtype and np.array_equal(a, b)
    )


@SOLVERS
@pytest.mark.parametrize("maxsize", [0, 1, 4, DEFAULT_CACHE_SIZE])
@settings(max_examples=200, deadline=None)
@given(data=st.data())
def test_output_identical_with_cache_on_and_off(solver, maxsize, data):
    # Repeats from the pool make hits likely; small caps force evictions.
    pool = data.draw(st.lists(any_lines, min_size=1, max_size=6))
    sequence = data.draw(st.lists(st.sampled_from(pool), min_size=1, max_size=30))
    cached = CachedLineSolver(solver, maxsize=maxsize)
    for clue, line in sequence:
        assert same(cached(clue, line), solver(clue, line))
    assert cached.stats.lookups == len(sequence)
    assert len(cached) <= maxsize


def test_hit_and_miss_counts():
    cache = CachedLineSolver(solve_full, maxsize=10)
    a, b = ((3,), parse(".....")), ((1, 1), parse("....."))
    assert cache.stats == CacheStats(hits=0, misses=0, size=0, maxsize=10)
    assert cache.hit_rate == 0.0

    cache(*a)
    cache(*a)
    cache(*b)
    cache(*a)
    assert cache.stats == CacheStats(hits=2, misses=2, size=2, maxsize=10)
    assert cache.hit_rate == 0.5
    assert cache.stats.lookups == 4


def test_contradictions_are_cached():
    cache = CachedLineSolver(solve_full)
    assert cache((6,), parse(".....")) is None
    assert cache((6,), parse(".....")) is None
    assert (cache.stats.hits, cache.stats.misses) == (1, 1)


def test_least_recently_used_entry_is_evicted():
    calls = []

    def solver(clue, line):
        calls.append(tuple(clue))
        return solve_full(clue, line)

    cache = CachedLineSolver(solver, maxsize=2)
    line = parse("......")
    cache((1,), line)
    cache((2,), line)
    cache((1,), line)  # (1,) is now most recent
    cache((3,), line)  # evicts (2,)
    assert len(cache) == 2
    cache((1,), line)
    cache((3,), line)
    assert calls == [(1,), (2,), (3,)]
    cache((2,), line)
    assert calls == [(1,), (2,), (3,), (2,)]


def test_key_depends_on_clue_and_line_state():
    cache = CachedLineSolver(solve_full)
    assert show(cache((1,), parse(".1..."))) == "01000"
    assert show(cache((1,), parse("...1."))) == "00010"
    assert show(cache((2,), parse(".1..."))) == ".1.00"
    assert cache.stats.hits == 0


def test_line_dtype_does_not_change_the_key():
    # An int8 line of 8 cells and an int64 line of 1 cell are both 8 bytes.
    cache = CachedLineSolver(solve_full)
    wide = np.array([1], dtype=np.int64)
    assert show(cache((1,), wide)) == "1"
    assert show(cache((1,), parse("1......."))) == "10000000"
    assert show(cache((1,), wide.astype(np.int8))) == "1"
    assert cache.stats.hits == 1


def test_mutating_the_input_line_does_not_corrupt_the_cache():
    cache = CachedLineSolver(solve_full)
    line = parse("..1..")
    cache((1,), line)
    line[0] = 1
    assert show(cache((1,), parse("..1.."))) == "00100"
    assert cache.stats.hits == 1


def test_results_are_read_only():
    cache = CachedLineSolver(solve_full)
    result = cache((5,), parse("....."))
    with pytest.raises(ValueError):
        result[0] = 0


def test_zero_maxsize_stores_nothing_but_counts_lookups():
    cache = CachedLineSolver(solve_full, maxsize=0)
    cache((1,), parse("..."))
    cache((1,), parse("..."))
    assert cache.stats == CacheStats(hits=0, misses=2, size=0, maxsize=0)


def test_negative_maxsize_is_rejected():
    with pytest.raises(ValueError):
        CachedLineSolver(solve_full, maxsize=-1)


def test_reset_stats_and_clear():
    cache = CachedLineSolver(solve_full)
    cache((1,), parse("..."))
    cache((1,), parse("..."))
    cache.reset_stats()
    assert cache.stats == CacheStats(hits=0, misses=0, size=1, maxsize=DEFAULT_CACHE_SIZE)
    cache((1,), parse("..."))
    assert cache.stats.hits == 1
    cache.clear()
    assert cache.stats == CacheStats(hits=0, misses=0, size=0, maxsize=DEFAULT_CACHE_SIZE)
