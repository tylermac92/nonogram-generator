# Nonogram Generator — User Stories

Oct 8, 2026 · @Tyler MacPherson

One user story per milestone from the project spec, each with a description and acceptance criteria you can tick off. Stories for M1–M4 are written from the developer's view, since those milestones have no UI; the rest are written for two users: the **creator**, who turns images into puzzles, and the **player**, who solves them.

## Phase 1 — Core logic

### M1. Project scaffold

**Story:** As a developer, I want a configured project that tests and deploys automatically, so that every later milestone ships to a live URL with tests guarding it.

**Description:** Set up Vite + React + TypeScript with Vitest, ESLint, and Prettier. Create the folder layout from the spec (`core/`, `workers/`, `ui/`), add a CI workflow, and deploy an empty app to the chosen static host.

**Acceptance criteria:**

- [x] `npm run dev` starts the app locally and `npm run build` produces a static bundle with no errors.
- [x] `npm test` runs Vitest, and at least one placeholder test passes.
- [x] Lint and type-check run in CI on every push and fail the build on errors.
- [x] A push to the main branch deploys automatically, and the live URL loads the app.
- [x] TypeScript strict mode is on.

### M2. Grid and clue generation

**Story:** As a developer, I want a tested grid type and clue generator, so that every other module shares one correct model of a puzzle.

**Description:** Implement `Grid`, `ClueRun`, and `Puzzle` as defined in the spec, with v1 cell values 0 and 1 but types that allow palette indices later. Write a pure function that derives row and column clues from a grid.

**Acceptance criteria:**

- [x] An empty row produces the clue "0" (an empty run list displayed as 0).
- [x] A fully filled row of width *w* produces the single clue *w*.
- [x] A row such as `1101110` produces clues 2 3; tests also cover separated, adjacent-to-edge, and single-cell runs.
- [x] 1x1, 5x5, non-square (e.g. 37x22), and 50x50 grids all generate clues correctly.
- [x] Grids are stored row-major in a `Uint8Array`, and the module has no React imports.

### M3. Line solver

**Story:** As a developer, I want a fast line solver that reports exactly which cells it can't determine, so that the app can judge puzzles and point creators at problem areas.

**Description:** Implement the per-line dynamic-programming pass, cell possibility bitmasks, and the dirty-line queue. The solver returns a status (solved, stuck, or contradiction), the undetermined cells, and a trace of rounds and deductions for later difficulty rating.

**Acceptance criteria:**

- [x] At least five known line-solvable puzzles (including a 50x50) come back fully solved and match their solutions.
- [x] A 2x2 grid with a diagonal pair is reported as stuck, with all four cells undetermined.
- [x] Clues that admit no solution return a contradiction status instead of crashing or looping.
- [x] A 50x50 puzzle solves in under 50 ms on a typical laptop, measured in a benchmark test.
- [x] The trace records the number of rounds and deductions per round.

### M4. Image pipeline

**Story:** As a developer, I want a pure image-to-grid pipeline, so that any image becomes a grid predictably and can be tested without a browser UI.

**Description:** Implement decoding with orientation correction, flattening transparency onto white, capping the working copy at 2048 px, area-average downscaling, grayscale, brightness and contrast, Otsu thresholding, invert, and speck cleanup. Each step is its own pure function.

**Acceptance criteria:**

- [ ] A black square centred on white converts to a filled block of the expected size at several grid widths.
- [ ] A large checkerboard downscaled to a much smaller grid produces mid-gray cell values rather than aliasing patterns, which proves area averaging.
- [ ] Otsu picks a cutoff between the two peaks of a two-tone test image.
- [ ] Invert produces the exact complement of the grid.
- [ ] Cleanup removes isolated filled cells and fills single-cell holes, and leaves 2-cell runs alone.
- [ ] A transparent PNG converts as if placed on white, and a rotated phone photo (EXIF orientation) converts upright.

## Phase 2 — Creator

### M5. Minimal creator

**Story:** As a creator, I want to drop in an image and immediately see it as a nonogram grid, so that I can judge whether the image will make a good puzzle.

**Description:** Build the first creator screen: a file picker with drag-and-drop, a width slider, a cutoff slider with an Auto button, an Invert toggle, and a canvas preview showing the grid with its row and column clues. At this stage the whole image is used, with no crop.

**Acceptance criteria:**

- [ ] Dropping a supported image, or choosing one with the file picker, shows a grid preview within 1 second.
- [ ] Moving the width slider (5–50) or the cutoff slider updates the preview while dragging, without visible lag.
- [ ] The cutoff starts at the Otsu value, and Auto restores it after manual changes.
- [ ] Invert swaps filled and empty cells in the preview and the clues.
- [ ] Clues are readable at 50x50, with clue areas sized to the longest clue.
- [ ] An unsupported file (for example HEIC or a PDF) shows a clear message suggesting JPEG or PNG.

### M6. Solver worker and verdict

**Story:** As a creator, I want to see at a glance whether my grid is a valid puzzle, and where it's ambiguous, so that I know whether I can publish it or need to fix it.

**Description:** Move the line solver into a Web Worker. Each check carries a job id, slider changes are debounced, and stale results are discarded. Show a verdict badge (Valid or Not line-solvable for now) and tint the undetermined cells on the preview, with a count.

**Acceptance criteria:**

- [ ] The verdict badge updates within about 300 ms after the user stops moving a slider.
- [ ] Dragging sliders on a 50x50 grid never freezes the page; the solver runs off the main thread.
- [ ] A result from an older job never overwrites a newer one.
- [ ] Undetermined cells are tinted on the preview, with a count such as "37 cells undetermined".
- [ ] A known line-solvable test image shows Valid, and a known ambiguous one shows the tinted region.

### M7. Crop and sizing

**Story:** As a creator, I want to crop to my subject and choose the puzzle size, so that the picture stays recognizable at small grid sizes.

**Description:** Add a crop box over the source image, a lock-to-square toggle, and preset size buttons. Height is derived from the crop shape and clamped to 5–50, and the width maximum shrinks when needed. Add brightness and contrast sliders.

**Acceptance criteria:**

- [ ] Dragging or resizing the crop box updates the grid preview live.
- [ ] Height = round(width × crop height ÷ crop width), always between 5 and 50.
- [ ] For a very tall crop, the width slider's maximum drops so that height never exceeds 50; for a very wide crop, height never drops below 5.
- [ ] Lock to square keeps the crop at 1:1, and each preset (10, 15, 20, 25, 30, 40, 50) sets the width and turns the lock on.
- [ ] Brightness and contrast sliders change the preview and are included in the settings that later get saved.

### M8. Manual editing

**Story:** As a creator, I want to fix individual cells by hand, so that I can clean up details and resolve ambiguity myself.

**Description:** Let the creator click to toggle cells and drag to paint on the preview. Edits are stored as overrides applied after the pipeline, and creator-side undo and redo are added.

**Acceptance criteria:**

- [ ] Clicking a cell toggles it, and dragging paints every cell crossed with the value of the first cell's new state.
- [ ] Edits survive changes to cutoff, brightness, contrast, and invert.
- [ ] Changing the grid size or crop asks for confirmation before clearing edits.
- [ ] Undo and redo work for edits (Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z), with at least 100 steps.
- [ ] The verdict and tinted cells update after each edit, and edited cells are visually marked.

## Phase 3 — Solvability and repair

### M9. Deep check

**Story:** As a creator, I want to know *why* a puzzle failed — truly ambiguous, or unique but requiring guesses — so that I can decide whether to fix it or accept it.

**Description:** When the line solver gets stuck, run a backtracking search in the worker for a second solution that differs from the image, with a 3-second time limit. Show one of the four verdicts from the spec: Valid, Needs guessing, Ambiguous, or Inconclusive.

**Acceptance criteria:**

- [ ] The deep check runs automatically only when the line solver is stuck, and never blocks the UI.
- [ ] A known ambiguous puzzle shows Ambiguous, with the cells that differ between the two solutions highlighted.
- [ ] A known unique puzzle that is not line-solvable shows Needs guessing.
- [ ] A search that hits the time limit shows Inconclusive rather than a wrong answer.
- [ ] Changing a setting mid-search cancels the running search.
- [ ] Any verdict other than Valid shows a warning on export, but export stays possible.

### M10. Suggest nearby settings

**Story:** As a creator whose puzzle fails, I want the app to find nearby settings that pass, so that I can fix it in one click without guesswork.

**Description:** After settings have been still for about 500 ms and the puzzle fails, the worker scans cutoff ±30 in steps of 2 and width ±3 (within crop and size limits). It line-solves each combination and offers up to three passing options closest to the current settings.

**Acceptance criteria:**

- [ ] Suggestions appear only when the current puzzle is not Valid.
- [ ] Each suggestion shows its cutoff and width, and clicking it applies those settings with a Valid result.
- [ ] Suggestions are ordered by closeness to the current settings.
- [ ] When nothing in range passes, the panel says so and points to auto-fix.
- [ ] The scan can be cancelled, and it restarts when settings change.
- [ ] At least one of the failing sample images gets a passing suggestion.

### M11. Auto-fix

**Story:** As a creator, I want a one-click fix that makes my puzzle valid with as few visible changes as possible, so that I don't have to hunt for the problem cells myself.

**Description:** Implement the greedy flip loop from the spec. Candidates come from undetermined cells and their neighbors, ranked by closeness to the cutoff. Each round keeps the flip that determines the most cells, within a budget of 5% of cells. Flipped cells become manual edits marked as auto-fixed.

**Acceptance criteria:**

- [ ] Clicking Auto-fix shows progress and can be cancelled; cancelling leaves the grid unchanged.
- [ ] On success, the verdict becomes Valid, and the result reports how many cells were flipped.
- [ ] Flipped cells are marked in the preview, and each one can be reverted individually.
- [ ] One undo step reverts the whole auto-fix.
- [ ] When the budget runs out or no flip helps, the app reports partial progress and keeps the improvements.
- [ ] Most failing sample images pass after auto-fix with fewer than 2% of cells flipped.

## Phase 4 — Output

### M12. Image export and project files

**Story:** As a creator, I want to export my puzzle as an image and save my work as a project file, so that I can post puzzles online and come back later to edit them.

**Description:** Build the shared SVG renderer (blank puzzle and solution variants), PNG export at 1x, 2x, and 4x, and save/load of a versioned JSON project file. The project file holds the puzzle, crop, settings, manual edits, title, and optionally a downscaled copy of the source image.

**Acceptance criteria:**

- [ ] SVG export opens correctly in a browser and in a vector editor, with clues, grid, and bold lines every 5 cells.
- [ ] PNG export at each scale is sharp and matches the SVG.
- [ ] Saving and then loading a project restores the creator exactly: crop, settings, edits, title, and verdict.
- [ ] The "include source image" toggle defaults to on; with it off, loading still restores the grid and shows that the source is unavailable for re-cropping.
- [ ] Loading a file with an unknown version or invalid structure shows a clear error and changes nothing.

### M13. Print view

**Story:** As a creator, I want a clean printable puzzle with a separate solution page, so that I can hand out puzzles on paper or save them as a PDF.

**Description:** Add a print route with `@media print` styles. Page 1 has the title, difficulty (once it exists), and blank grid with clues; page 2 has the solution. Offer Letter and A4, portrait and landscape, and auto-fit the cell size to the page.

**Acceptance criteria:**

- [ ] Printing (or Save as PDF) produces exactly two pages: puzzle, then solution.
- [ ] A 50x50 puzzle fits on one Letter or A4 page (landscape allowed), with clues at least 7 pt.
- [ ] Bold rules appear every 5 cells, and the clue areas never overlap the grid.
- [ ] Changing paper size or orientation updates the preview before printing.
- [ ] No app UI (buttons, sliders, navigation) appears on the printed pages.

## Phase 5 — Play and sharing

### M14. Basic play mode

**Story:** As a player, I want to solve a puzzle right in the browser with mouse, keyboard, or touch, so that I don't need to print it.

**Description:** Build the play view: a canvas board with clues, fill and X marking, drag painting locked to a row or column, undo and redo, a Check button, keyboard controls, and a Fill/X mode toggle for touch screens. The creator gets a "Play this puzzle" button that opens it.

**Acceptance criteria:**

- [ ] Left-click fills a cell, right-click marks X, and clicking again clears it.
- [ ] Dragging paints along the row or column where the drag started, even if the pointer drifts diagonally.
- [ ] On touch screens, tapping uses the current Fill/X mode, and the page doesn't scroll or zoom while painting.
- [ ] Arrow keys move a visible cursor, Space fills, and X marks.
- [ ] Undo and redo cover every move, including whole drag strokes as one step.
- [ ] Check reports the number of wrong filled cells and can highlight them; X marks are never counted as wrong.
- [ ] A correctly completed grid shows a solved message.
- [ ] A 15x15 puzzle can be solved start to finish with mouse, keyboard, and on a phone.

### M15. Shareable URL

**Story:** As a creator, I want to share a puzzle as a link, so that friends can play it instantly without files or accounts.

**Description:** Encode the solution in the URL fragment (format byte, width, height, packed bits, light XOR scramble, base64url). Opening a link with `#p=…` goes straight to play mode, with clues rebuilt from the decoded solution. This completes v1.

**Acceptance criteria:**

- [ ] A Share button copies the link to the clipboard and confirms it.
- [ ] A 50x50 link is about 420 characters, and the puzzle data sits after `#`, so it isn't sent to the server.
- [ ] Opening the link in a fresh browser (no saved state) opens play mode with the correct puzzle.
- [ ] Encoding then decoding round-trips exactly for all sizes from 5x5 to 50x50, including non-square grids (unit tests).
- [ ] A corrupted or truncated link shows a friendly error with a link to the creator, never a blank page.
- [ ] The solution isn't readable by eye from the link.

## Phase 6 — Polish

### M16. Creator extras

**Story:** As a creator, I want a difficulty estimate, good starting examples, and a way to compare the grid with the original, so that I can make puzzles that are both fun and faithful to the picture.

**Description:** Add a difficulty badge (Easy / Medium / Hard / Expert) computed from the line solver's trace, 4–6 bundled sample images with a tips panel, and a compare view showing the original crop beside the grid, with an overlay toggle.

**Acceptance criteria:**

- [ ] Every Valid puzzle shows a difficulty badge labelled as an estimate; non-Valid puzzles show none.
- [ ] Across the sample set, ratings rise with puzzle size and complexity, judged by solving them yourself, and the thresholds are tuned to match.
- [ ] The difficulty appears in the print view and the JSON project file.
- [ ] A first-time visitor with no image sees the sample images and can load one with one click.
- [ ] The tips panel covers contrast, plain backgrounds, and cropping tight.
- [ ] Compare view shows the crop and the grid side by side, and the overlay places the grid at 50% opacity, aligned with the photo.
- [ ] All bundled images are owned by you or public domain, with their source noted in the repo.

### M17. Comfort play

**Story:** As a player, I want the conveniences of a real puzzle app, so that large puzzles are pleasant to solve, especially on a phone.

**Description:** Add six independent features, each shippable on its own: pinch-zoom and pan, greying out completed clues, row and column highlight, a timer, autosaved progress, and a win animation. Ship pinch-zoom first, since it's required for large boards on phones.

**Acceptance criteria:**

- [ ] **Zoom and pan:** pinch-zoom and two-finger pan work on phones, and one-finger drags still paint. A 50x50 puzzle is playable on a phone.
- [ ] **Clue grey-out:** a clue number greys out when its run is complete in that line, and returns to normal if the run is broken.
- [ ] **Highlight:** the row and column under the cursor or keyboard focus are highlighted.
- [ ] **Timer:** starts on the first move, pauses when the tab is hidden, and stops when the puzzle is solved.
- [ ] **Autosave:** progress (cells, X marks, timer) is saved to `localStorage` under a hash of the puzzle and restored when the same link or puzzle reopens, with a Reset option.
- [ ] **Win animation:** plays once on completion, is skippable, and respects the reduced-motion setting.
