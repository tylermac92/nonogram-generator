# M15 Implementation Plan — Shareable URL

Plan for the fifteenth user story in `docs/user-stories.md`:

> As a creator, I want to share a puzzle as a link, so that friends can play it instantly without files or accounts.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Link format | `<page URL>#p=<payload>`. The payload is base64url (no padding) of these bytes: format `1`, width, height, the solution packed 8 cells per byte (row-major, first cell in the high bit) and scrambled, then one checksum byte | The spec's format. Everything after `#` stays in the browser, so it never reaches a server |
| Length | A 50x50 is 3 + 313 + 1 = 317 bytes, which is 423 characters of payload and about 426 after `#p=` | "About 420 characters" |
| Scramble | The packed bytes are XORed with a fixed pseudo-random byte stream (xorshift, seeded from width and height). The header and checksum stay plain | Without it, empty or full rows show up as runs like `AAAA` or `____`. It hides the picture from a casual look, and is not security, as the spec says |
| Checksum | One byte over everything before it: `h = ((h ^ byte) × 31) mod 256`, starting at 7. Each step is a one-to-one function of `h`, so any single changed byte always changes the result | "Corrupted or truncated" must be caught. The length check catches truncation; the checksum catches a changed character that would otherwise decode to a different puzzle |
| Decoding | `decodeShare(payload)` checks the alphabet, the format byte (`1`), width and height (5–50), the exact length, and the checksum. It throws on any failure, otherwise returns a `Grid`. `makePuzzle` rebuilds the clues | Every link is outside input, so it is fully checked |
| Title | **Not in the link.** A shared puzzle opens with the heading "Nonogram" | The spec leaves this open. Titles often name the picture ("Cat"), which would give the answer away, and leaving it out keeps links short |
| Routing | `App` reads `location.hash` through `useSyncExternalStore` with a `hashchange` listener. `#p=…` shows `PlayView` on its own; anything else shows the creator. The decode is memoised on the hash | Opening a link goes straight to play. Pasting another link into a tab already on the site works too, because only the fragment changes and the page doesn't reload |
| Play from a link | `PlayView`'s `onClose` becomes optional. Without it, "Back to editor" is replaced by a "Make your own puzzle" link to the page without the fragment | Changing the path drops the fragment, so the browser loads the creator fresh |
| Broken link | One friendly screen: "This puzzle link is broken or incomplete. Ask for a new link, or make your own puzzle." with the same link to the creator. Never a blank page | The criterion |
| Share button | "Share link" next to "Print…" and "Play this puzzle". It encodes the current puzzle (edits included), copies the link with `navigator.clipboard.writeText`, and shows "Link copied." If the clipboard is unavailable or refused (an insecure page, denied permission), it shows the link in a read-only field to copy by hand | "Copies the link and confirms it", plus a working path when the clipboard isn't available |
| Where the code lives | `core/io/share.ts` (`encodeShare`, `decodeShare`) is pure and tested in Node. Routing goes in `App.tsx` | The spec puts URL encoding in `core/io` |

## Prototype results

A Node prototype of this format, run before planning:

- A 50x50 payload is 423 characters.
- Every single-character substitution in four payloads (34,776 links, 5x5 to 50x50) was rejected, or decoded to exactly the original grid (21 of them, in the last character's unused bits).
- Every truncation was rejected.
- The longest run of one repeated character in the empty, full and striped 50x50 payloads is 2.
- The scramble is the same for every puzzle of a given size, so identical rows give identical stretches of text in two links. That doesn't reveal the picture.

## Files

```
src/core/io/share.ts             # encodeShare, decodeShare
src/core/io/share.test.ts        # Node
src/ui/App.tsx                   # hash routing, broken-link screen
src/ui/PlayView.tsx              # onClose optional; "Make your own puzzle" link
src/ui/Creator.tsx               # Share link button, copied / manual-copy message
src/ui/Creator.browser.test.tsx  # share and routing cases
```

## Tests

`share.test.ts` (Node):

| Case | Expected |
| --- | --- |
| Every size from 5x5 to 50x50 (2,116 sizes, square and not), random seeded grids | `decodeShare(encodeShare(grid))` equals the grid |
| A 50x50 | Payload is 423 characters, base64url characters only |
| Truncated: every shorter prefix of a payload | Throws |
| Corrupted: every single-character substitution at every position | Throws, or decodes to exactly the original grid (the last character's unused low bits) |
| Format byte 2; width 4 or 51; characters outside base64url | Throws |
| Readability: an all-empty, an all-filled and a striped 50x50 | No character repeats more than 4 times in a row in the payload |

`Creator.browser.test.tsx`:

| Case | Expected |
| --- | --- |
| Share link on the square image (clipboard stubbed) | `writeText` gets `…#p=<payload>`; "Link copied." appears; decoding the payload gives the creator's grid |
| Clipboard refused | The link appears in a read-only field instead |
| `App` rendered with `#p=<payload>` in the URL | Play view with the right clues and the "Make your own puzzle" link, no creator; solving it shows the solved message |
| `#p=` with a truncated payload | The broken-link screen with its creator link |
| Hash changed to a link while the creator is showing | Play view appears without a reload |

Production check (Playwright on the built app): in a fresh browser context, open a 50x50 link. Play mode must show the right puzzle, and the page request seen by the browser must carry no fragment. A corrupted link must show the broken-link screen.

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| Share copies the link and confirms | Share test |
| A 50x50 link is about 420 characters; data after `#` | Length test (423 + `#p=`); production request check |
| Fresh browser opens play mode with the correct puzzle | `App` routing test; production check in a new context |
| Round-trips for every size 5x5–50x50, non-square too | Node round-trip test |
| Corrupted or truncated link → friendly error with a creator link | Node truncation and corruption tests; broken-link test; production check |
| Solution not readable by eye | Scramble; readability test |

## Out of scope for M15

Titles in links, short links or a link service, QR codes, saving play progress (a later comfort feature), and colour puzzles (a different format byte when they come).

## Risks

- **A one-byte checksum** misses about 1 in 256 random multi-byte corruptions. Every single changed byte is caught, which covers mistyped or damaged characters; heavier damage almost always changes the length as well.
- **Clipboard rules:** browsers allow `writeText` only on secure pages after a click. GitHub Pages is HTTPS, and the manual-copy field covers the rest.
