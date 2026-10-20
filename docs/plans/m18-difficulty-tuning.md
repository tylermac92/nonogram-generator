# M18 Implementation Plan — Difficulty Tuning

Plan for the one open criterion of M16 in `docs/user-stories.md`:

> Across the sample set, ratings rise with puzzle size and complexity, judged by solving them yourself, and the thresholds are tuned to match.

The tests already checked that ratings never fall as a sample grows. What was missing was the judgement: someone solving puzzles and saying how hard each felt. The first version of this plan asked you to play eight puzzles. You chose to automate it instead, so a **simulated player** stands in for the person, and the criterion now reads "judged against a simulated player".

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| What gets tuned | Only the three cutoffs in `THRESHOLDS` (`difficulty.ts`). The score formula stays as it is | The M16 risks note says "the thresholds are one line to change". Changing the formula would need its own plan |
| The judge | `play(puzzle)` in `core/solver/player.ts`, used only by tests. It solves the way people are first taught: sweep the lines whose crossings changed and apply only the **left–right overlap** (slide each run as far left and right as the line allows; cells a run covers both ways are filled, cells no run can reach are empty). When a whole sweep finds nothing, it uses full line logic on one line and counts a hard step. It reports the lines it read and the hard steps | Independent of the score: the score counts the full solver's rounds, while the player measures how much looking a person would do with the simpler technique. It is a model of a person, not a person |
| Its measure | Lines read. No sample needed a hard step (overlap alone solved all 30 Valid runs), so hard steps don't affect these results | Reading a line and working out what it gives is the step a person repeats most |
| Turning work into labels | Rank the 30 Valid runs by lines read and give out M16's label sizes in that order: 9 Easy, 12 Medium, 6 Hard, 3 Expert | The player ranks the runs, but labels need a scale, and any minutes-per-line figure would be made up. Keeping M16's label sizes is the one choice already made with the samples in view |
| How cutoffs are set | For each boundary, take the cutoff that mislabels the fewest runs, halfway across the gap between the scores on either side, rounded to a whole number where one fits | As far as possible from the evidence on either side, so small decoder shifts don't change a label |
| When the order is wrong | One mismatch is accepted and recorded below. Two or more would mean the score is missing something, and the formula would need its own plan before ticking M16 | Ranking by a model has noise too |
| Locking it in | `samples.browser.test.ts` ranks the Valid runs by the player's work, gives out the same label sizes, and expects exactly the accepted mismatch. It fails with the old cutoffs (cat at 20 then also differs) | Without it, a later solver or pipeline change could quietly undo the tuning |
| `score` | `difficulty.ts` exports `score(result)`, the side × depth number `difficulty` already computed | Cutoffs are fitted to it, and the tests use it |

## Results

Every sample at widths 10–50, built in the browser the way the creator builds it by default. The scores and labels matched the M16 prototype table. The rank correlation between score and lines read over the 30 Valid runs is 0.95.

| Sample | Width | Score | Lines read | Player | Before | After |
| --- | --- | --- | --- | --- | --- | --- |
| skyline | 10 | 8.9 | 18 | Easy | Easy | Easy |
| skyline | 15 | 12.8 | 26 | Easy | Easy | Easy |
| skyline | 20 | 17.3 | 35 | Easy | Easy | Easy |
| skyline | 25 | 21.8 | 44 | Easy | Medium | Medium **≠** |
| skyline | 30 | 26.3 | 53 | Medium | Medium | Medium |
| skyline | 40 | 34.6 | 70 | Medium | Medium | Medium |
| skyline | 50 | 43.9 | 152 | Hard | Hard | Hard |
| cat | 10 | 8.9 | 18 | Easy | Easy | Easy |
| cat | 15 | 13.2 | 47 | Easy | Easy | Easy |
| cat | 20 | 17.9 | 64 | Medium | Easy | Medium |
| cat | 25 | 23.8 | 81 | Medium | Medium | Medium |
| cat | 30 | 29.1 | 107 | Medium | Medium | Medium |
| cat | 40 | 37.8 | 139 | Hard | Hard | Hard |
| cat | 50 | 49.5 | 189 | Hard | Hard | Hard |
| sailboat | 10 | 9.8 | 33 | Easy | Easy | Easy |
| sailboat | 15 | 15.2 | 48 | Easy | Easy | Easy |
| sailboat | 20 | 20.7 | 64 | Medium | Medium | Medium |
| sailboat | 25 | 27.3 | 99 | Medium | Medium | Medium |
| sailboat | 30 | 33.8 | 120 | Medium | Medium | Medium |
| sailboat | 40 | 45.0 | 160 | Hard | Hard | Hard |
| sailboat | 50 | 57.6 | 210 | Expert | Expert | Expert |
| cameraman | 10 | 11.4 | 44 | Easy | Easy | Easy |
| cameraman | 15 | 22.3 | 84 | Medium | Medium | Medium |
| cameraman | 20 | 25.7 | 99 | Medium | Medium | Medium |
| cameraman | 25 | 37.5 | 156 | Hard | Hard | Hard |
| cameraman | 30 | 39.0 | 153 | Hard | Hard | Hard |
| cameraman | 40 | 61.7 | 268 | Expert | Expert | Expert |
| cameraman | 50 | — | — | not Valid | — | — |
| horse | 10 | — | — | not Valid | — | — |
| horse | 15 | 22.4 | 85 | Medium | Medium | Medium |
| horse | 20 | 27.3 | 102 | Medium | Medium | Medium |
| horse | 25 | — | — | not Valid | — | — |
| horse | 30 | — | — | not Valid | — | — |
| horse | 40 | — | — | not Valid | — | — |
| horse | 50 | 91.8 | 437 | Expert | Expert | Expert |

- **Cutoffs before:** Easy below 20, Medium below 35, Hard below 55.
- **Cutoffs after:** Easy below **17.6**, Medium below **36**, Hard below **54**. No whole number fits the Easy gap (17.3 to 17.9), so that one keeps a decimal.
- **What changed:** cat at 20 moves from Easy to Medium; no other sample changes label.
- **Accepted mismatch (≠):** skyline at 25 scores Medium, but the player reads only 44 lines, among the Easy ones. Skyline is a simple picture that overlap settles quickly, but its depth counts several rounds. Any cutoff that made it Easy would also make cat at 20 and sailboat at 20 Easy, which the player rates Medium.

## Files

```
src/core/solver/difficulty.ts       # export score(); new THRESHOLDS
src/core/solver/difficulty.test.ts  # score case; boundary cases at the new cutoffs
src/core/solver/player.ts           # the simulated player (tests only)
src/core/solver/player.test.ts      # Node
src/ui/samples.browser.test.ts      # ratings agree with the player's ranking
docs/plans/m18-difficulty-tuning.md # this file
docs/user-stories.md, docs/project-spec.md  # criterion reworded; M16 ticked; cutoffs
```

## Steps

1. **Scores.** Export `score`. A one-off script (not committed) built every sample at widths 10–50 in the browser and recorded each label, score and share link.
2. **Simulated player.** `player.ts` with its Node tests.
3. **Cutoffs.** Ran the player on every run, fitted the cutoffs by the rules above, updated `THRESHOLDS` and the boundary cases.
4. **Lock-in test and docs.** Added the agreement test, reworded the criterion and ticked M16.

## Tests

`player.test.ts` (Node):

| Case | Expected |
| --- | --- |
| A run of 8 in 10 blank cells | The middle 6 are filled |
| A run of 1 with the first cell known filled | The rest are empty |
| An empty clue | Every cell empty |
| A clue that can't fit | Reported |
| 2,000 random partly-known lines | Overlap never sets a cell full line logic disagrees with, and sometimes sets fewer |
| A full 5x5 | Solved in one sweep, 10 lines read, no hard steps |
| The grid that needs guessing | Not solved |
| 40 random grids | Solved exactly when the line solver solves them |

`difficulty.test.ts` (Node): `score` on a hand-made result; results just under and at 17.6, 36 and 54 get the labels either side; the existing cases are unchanged.

`samples.browser.test.ts` (Chromium, the real decoder): ranked by the player's work with M16's label sizes, every Valid run rates as the player ranks it except skyline at 25. The existing cases are unchanged.

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| Across the sample set, ratings rise with puzzle size and complexity, judged against a simulated player, and the thresholds are tuned to match | Results table; the agreement test; the existing rating-order test |

## Out of scope for M18

Changing the score formula, using the player's work as the rating itself, harder techniques in the player (it moves to full line logic instead), showing the score in the app, and rating puzzles that aren't Valid.

## Risks

- **A model, not a person:** the player shows the score orders puzzles the way the work does, but how hard a puzzle *feels* can still differ, for example a big, easy picture that is merely long. If players report labels that feel wrong, a play check like the first version of this plan is still the way to settle it.
- **Label sizes carried over:** the scale (how many of each label) comes from M16's cutoffs; the player only decides which runs get them.
- **Only overlap needed:** repeated overlap solved every Valid sample, and every one of 255 line-solvable random 20x20 grids (checked once, not in the tests). So the player's signal is the amount of work, not which technique a puzzle needs; it can't tell a long, plain puzzle from a short, tricky one.
