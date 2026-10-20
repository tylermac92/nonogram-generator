# M18 Implementation Plan — Difficulty Tuning

Plan for the one open criterion of M16 in `docs/user-stories.md`:

> Across the sample set, ratings rise with puzzle size and complexity, judged by solving them yourself, and the thresholds are tuned to match.

The tests already check that ratings never fall as a sample grows. What's missing is the play check: a person solving a spread of puzzles and saying how hard each felt. This milestone is mostly that session, plus a small code change to record the result.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| What gets tuned | Only the three cutoffs in `THRESHOLDS` (`difficulty.ts`). The score formula stays as it is unless the play check shows it orders puzzles wrongly (see "When the order is wrong") | The M16 risks note says "the thresholds are one line to change". Changing the formula is a separate decision and would need new evidence |
| Puzzle set | Eight puzzles, two for each expected label, taken from the M16 prototype table: **Easy** cat at 15, skyline at 20; **Medium** sailboat at 25, cameraman at 20; **Hard** cameraman at 25, cat at 40; **Expert** cameraman at 40, sailboat at 50. Step 1 rebuilds the table with the browser's decoder and swaps in a neighbouring width if a pick has moved label or isn't Valid | Two per label shows where each boundary falls. The prototype used ImageMagick, and the browser's decoder may shift a few cells |
| Playing blind | Each puzzle is played from its share link, in a shuffled order, with the puzzle number as the only name. A shared link shows no title and no difficulty (decided in M15), so the player can't see the expected label | A player who knows the label will tend to agree with it |
| What's recorded | For each puzzle: the time from the M17 timer, and the player's own label (Easy / Medium / Hard / Expert). Use the same device for all eight; a desktop is best | The player's label is what the cutoffs are fitted to. Time is a check on it: if a puzzle took twice as long as another with the same label, ask about it |
| Seeing the scores | `difficulty.ts` exports `score(result)` (side × depth, the number already computed inside) and `difficulty` uses it. Step 1's table lists each puzzle's score | A cutoff can only be placed between two numbers. The export is one line, and the tests use it too |
| How cutoffs are set | Sort the eight by score. Each cutoff goes halfway between the highest-scoring puzzle the player rated at or below that label and the lowest-scoring one they rated above it, rounded to a whole number | Puts each boundary as far as possible from the evidence on either side, so small decoder shifts don't change a label |
| When the order is wrong | If a lower-scoring puzzle felt harder than a higher-scoring one, no cutoffs fit all eight. Then pick the cutoffs that mislabel the fewest puzzles (on a tie, keep the current value) and note each mismatch under Results. If two or more of the eight are still mislabelled, stop and discuss changing the formula before ticking M16 | One mismatch is noise from a single player. Two suggests the score is missing something, such as one very hard line in an otherwise easy puzzle |
| Locking it in | `samples.browser.test.ts` gets a table of the eight puzzles and the labels the player gave, and checks that each one rates that way. Any mismatch accepted above is left out of the table, with a comment | Without it, a later solver or pipeline change could quietly undo the tuning |

## Files

```
src/core/solver/difficulty.ts       # export score(); new THRESHOLDS
src/core/solver/difficulty.test.ts  # boundary cases moved to the new cutoffs
src/ui/samples.browser.test.ts      # played puzzles rate as the player rated them
docs/plans/m18-difficulty-tuning.md # Results section filled in
docs/user-stories.md, docs/project-spec.md  # tick M16
```

## Steps

1. **Links and scores.** Export `score`. Run a one-off script in the browser test runner (not committed) that builds each sample at widths 10–50 the way the creator does, and prints the label, score and share link for each. Copy the eight picks, their scores and their links into Results below, in shuffled order.
2. **Play check (you).** Solve the eight from the links, in order. Write down each time and how hard it felt. Expect about 2–4 hours in total; the two Expert puzzles take the longest, and you can spread them over several sittings because progress is autosaved.
3. **Cutoffs.** Fit the cutoffs by the rule above, update `THRESHOLDS`, and move the boundary cases in `difficulty.test.ts` to the new values.
4. **Lock-in test and ticks.** Add the played puzzles to `samples.browser.test.ts`, run the full suite, then tick M16 in the spec and the user stories.

## Results

Step 1 rebuilt every sample at widths 10–50 with the browser's decoder. Every label and score matched the M16 prototype table, so all eight planned picks stand.

**Play these in order.** Each link opens the live site in play mode, with no title and no difficulty. Fill in your time and your own label as you go.

| # | Link | Time | Your label |
| --- | --- | --- | --- |
| 1 | [Puzzle 1](https://tylermac92.github.io/nonogram-generator/#p=ARQU3X6yjF7dRLSJnDvyU0o-oYpi8M5Y-NiHSlN9A409zvavtTwQ2nN0T_rHkLzRovwsVQB_) | | |
| 2 | [Puzzle 2](https://tylermac92.github.io/nonogram-generator/#p=ASge3zi8vzFzcFqzxthn8WwI228M0A28F2A1ciXbPcDrxBmCGPjYTRJ1XwqDWB8-AUta9leMEQX-b5EBogVruiWPahbEJroqbMgw-btz-E4_ZBW-07HuU389QmMFrwxZUbz4SmOzcrAUKfg_W3ZJAR6JSUJEmNauSBre_Fzm6mMB7aDo1bStvdZwvvgtfyMpn-F2F8q91Z09WQ) | | |
| 3 | [Puzzle 3](https://tylermac92.github.io/nonogram-generator/#p=AQ8LO1pyiCMYuY4tq82kdoe1imKZHsvmMg) | | |
| 4 | [Puzzle 4](https://tylermac92.github.io/nonogram-generator/#p=ATIm_xr6sWLyMYW5j2siFw77SPPZlUWGAlcafFkNmhBqn31_TNfQvY1Cj25G-s6sgEdadKltGJO5lXw8UnrpLTRzbFIjrMBMcKYgBrBviTZLBTbgZ-u30ZdHauYKWY8XSpSccMpFuWb4Tq_Pwc0322BwNv0rd1gZcPeGGbMaL59B35OjVCQHts_sRHzTgXOanMbdRADW5he4tFxwHYJFliV-upfTotxZNJFAKB2se5ncLdIFdjx0enGD90wOLfZLAsTyKReJ3hKIvE1YIerBOh9NbZ_5DZg9EkBAQSBnojjv30HXuMFfAacgA96NZ9z-bZg) | | |
| 5 | [Puzzle 5](https://tylermac92.github.io/nonogram-generator/#p=ARQPn3wwikT-HQK_p_IPW_IAZjmeXDap4mGeUi92xqwbDX6O0f55Byt_) | | |
| 6 | [Puzzle 6](https://tylermac92.github.io/nonogram-generator/#p=ARkZGT46tR830L85uOq00zO4X4UefSBf3ueiHFaKjv7PJoWWodiFvnFRH5qMybeJlTxZ33Qxf307j2hIZSmnVJghIFPIEuyzUyy8P7fHOocrdjs) | | |
| 7 | [Puzzle 7](https://tylermac92.github.io/nonogram-generator/#p=ARkTWzy4swUUiQkTgyWJ2hkGoTXBSKTPNlJH-y2Ru8HS5e2F2vovrNlU_snpwwJTmeGRaAdUjTHu-OsXnLhBDg) | | |
| 8 | [Puzzle 8](https://tylermac92.github.io/nonogram-generator/#p=ASgoGT46tR830L85uO600zy4X4refT-_3tiiHEnrDuF0ppmLQcd6eY6u35180bR2ZSJe23TOAO1ED2uK5Sm4k2MuwFPAGWywqyNELHfH33rMtgE6YBQwhJt5J-tsjpbjCQ8H5PDt3TVeQUKd8yFBqTUfqrGz14d8HbuP6UUyG00e48LleGYkcayu0j6NL5FviF10dOYi9HcuzgwrAxb5GhCFombU07HI_zf8poOzTuYIUQwftRCv8vaKky6a2YYr1raFzjasM9f27hg6) | | |

<details>
<summary>Answer key (open only after you've played all eight)</summary>

| # | Sample and width | Score | Label before | Label after |
| --- | --- | --- | --- | --- |
| 1 | cameraman at 20 (20x20) | 25.7 | Medium | |
| 2 | cat at 40 (40x30) | 37.8 | Hard | |
| 3 | cat at 15 (15x11) | 13.2 | Easy | |
| 4 | sailboat at 50 (50x38) | 57.6 | Expert | |
| 5 | skyline at 20 (20x15) | 17.3 | Easy | |
| 6 | cameraman at 25 (25x25) | 37.5 | Hard | |
| 7 | sailboat at 25 (25x19) | 27.3 | Medium | |
| 8 | cameraman at 40 (40x40) | 61.7 | Expert | |

</details>

Cutoffs before: Easy below 20, Medium below 35, Hard below 55. After: _to fill_.

## Tests

`difficulty.test.ts` (Node):

| Case | Expected |
| --- | --- |
| `score` on a hand-made 10x10 result | Side × depth, as in the M16 table |
| Results just under and at each new cutoff | The labels either side of it |
| Existing cases: stuck and contradiction give null; the disc never rates lower as it grows; a multi-pass grid rates above a one-pass grid | Unchanged |

`samples.browser.test.ts` (Chromium, the real decoder):

| Case | Expected |
| --- | --- |
| Each played puzzle (sample, width, default settings) | Rates as the player rated it |
| Existing cases: Valid at width 20, ratings never fall with width, the failing runs mostly pass after a suggestion or auto-fix | Unchanged |

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| Ratings rise with size and complexity across the samples, judged by solving them yourself, and the thresholds are tuned to match | The Results table from your play check; the lock-in test; the existing rating-order test |

## Out of scope for M18

Changing the score formula (if the play check calls for it, that gets its own plan), calibrating to more than one player, showing the score number in the app, and rating puzzles that aren't Valid.

## Risks

- **One player, eight puzzles:** the cutoffs fit one person's feel. That's what the criterion asks for, but other players may disagree near the boundaries.
- **Time cost:** the two Expert puzzles may take an hour each. Playing only one of them saves time, but then the Hard / Expert cutoff rests on a single puzzle.
- **Learning effect:** players get faster as they go. The shuffled order spreads that across labels instead of making the later puzzles look easier.
