# Verification record

Checks behind "Tote", run on 2026-11-17 against make.fun's live API, last after the fix round that answered an independent review (see "Fix round" below). Nothing was submitted; sealing the recording and submitting are separate steps.

## Gates

| Gate | Command | Result |
| --- | --- | --- |
| Unit tests | `node --test tests/core.test.mjs` | EXIT=0 · 22 passed, 0 failed |
| Syntax | `node --check` on the 6 app modules and 2 test files; `main.ts` and `serve.ts` type-stripped, then checked | EXIT=0 |
| Live browser | `PLAYWRIGHT_MODULE=… node tests/live.mjs --shots` (Chrome, headless) | EXIT=0 · 18 route checks, 0 failed assertions |
| Judge outline | `KIT_CLI=<kit>/cli/makefun.mjs node tests/outline.mjs` (the kit's own outliner, 1,248-byte text budget) | EXIT=0 · 10 declaration lines shown |
| Hand-in | `MAKEFUN_OUTPUT_DIR=<tmp> node main.ts`, twice, into two directories, plus once more into an existing one | EXIT=0 each · `diff -r` of the two outputs: identical |
| Dossier | `buildDossier` recomputed from the written output | byte-identical to `dossier.json` |
| Kit library | `diff -qr vendor <kit>/starter/vendor` | EXIT=0, unchanged |
| Whitespace | `git diff --check` | EXIT=0 |

## Live browser run

Every route was opened at 1280×900 and 390×844 in one tab per width, navigating inside the app: `#/`, `#/bounty/makefun-frontend-01`, its `/leaderboard`, the profile behind the first leaderboard row, `#/builders`, then back to the board with the app's refresh button.

- 12 route checks passed at the two widths: surface content present (rows with dollar amounts, pot ticket, rewards table, dates, at least ten ranked rows, profile, builders), no horizontal scroll, no `undefined` or `NaN` text.
- Whole run: **0 console errors, 0 page errors, 0 failed requests, 0 responses ≥ 400** from make.fun (the 503s the fallback probe stages itself are counted apart). 107 API requests, every one `GET https://make.fun/api/…`; no script, stylesheet or font from any origin other than the local server.
- Revalidation, read from the DevTools protocol: the refresh sent **`If-None-Match` with a weak `W/"…"` validator** (5 conditional GETs, all weak) and make.fun answered **304** to all 5; the page kept its content and the header stayed "Live".
- Lifecycle, at both widths: the live bounty list was passed through with one deadline moved seven seconds ahead and one opening time moved an hour ahead. The unopened bounty was left out of "Open now" and of the live-pot sum from the start; when the moved deadline passed, its row flipped to closed and both totals dropped, with **exactly one re-render and no reload**.

- Opening on the clock, at both widths: one open bounty was given an opening time six seconds ahead. On the "Open now" tab it had no row and no clock on screen. With no click it opened on time: desktop 6 → 7 open, $3,295 → $4,620 live pots, 1 → 0 opening soon, **exactly one re-render**; phone the same. The same probe run against the previous commit stayed at 6 open with 0 re-renders.
- Summary 503, at both widths: every read under `/competitions/<slug>` was answered `503 board_pending`. The featured pane on the cover kept its bounty (pot, countdown, rewards, dates, a line saying the figures come from the board's list) and so did the bounty's own page; against the previous commit both showed "This page did not load."

### A finding that changed the data layer

make.fun's `304 Not Modified` carries no `Access-Control-Allow-Origin`. A `fetch` that sets `If-None-Match` by hand receives that 304 directly and Chrome fails it as a CORS error, which showed up here as console errors and failed requests the first time a refresh landed in the same minute as the stored tag. `api.js` now asks with `cache: 'no-cache'`, so the browser's own cache sends the validator (weak tags included), absorbs the 304 and hands back the stored answer; an answer whose `ETag` matches the one held is reused without being parsed again. The unit tests pin this down: no custom request header, `cache: 'no-cache'`, weak and strong tags both reuse the held copy, a changed tag is read as new.

## Screenshots

`screenshots/` holds three unedited JPEG captures of the running app on live data, taken by `tests/live.mjs --shots` in one continuous visit and listed in `shots.json`:

| File | Address | Viewport | Bytes |
| --- | --- | --- | --- |
| `1-board.jpg` | `#/` | 1280×900 | 224,969 |
| `2-profile-phone.jpg` | `#/u/superskie` | 390×844 | 47,507 |
| `3-leaderboard.jpg` | `#/bounty/makefun-frontend-01/leaderboard` | 1280×900 | 255,569 |

Each is under the 262,144-byte cap. I read all three after the final capture.

## Hand-in output

The output directory holds `app/` (9 files), `screenshots/` (3 files) and `dossier.json` (830,698 bytes, under the 1.5 MiB cap).

`Totals: first load 1 file, 232 bytes gzip-9 (323 raw); later by import() 6 files, 30439 bytes gzip-9; whole app 9 files, 121715 bytes`

The 232 bytes are `index.html` alone: `app.js` then adds the stylesheet and imports the board and bounty modules, so a painted desktop board has read six local files.

The Load block names no reference outside `app/` and no `import()` of a computed specifier. `main.ts` refuses an output directory inside the repository, including a sibling-looking name such as `./..out`.

## Fix round

An independent reviewer returned four findings on commit `7adda61`; each was fixed and re-checked in the run above.

1. **Featured pane turned into an error on a 503.** A new bounty's own address can answer `503 board_pending`. `bounty.js` now falls back to that bounty's row in the board's list (already in the cache: no extra request), on the cover and on the bounty's own page, and says so in one line.
2. **The judge's outline showed tuning constants.** Entry points now come first in `api.js`, `app.js`, `board.js` and `leaderboard.js`, and the five routes are one table. At the 1,248-byte budget the kit's outliner now shows `getRevalidated`, `getPage(path, query, cursor, opts)`, the `ROUTES` line with all five addresses, `mountBoard`, `renderBounty`, `renderLeaderboard` and `renderProfile`. Still cut at that budget: the leaderboard's virtual-row and the board's patch-in-place functions.
3. **Screenshots were three desktop views with no profile.** The bounty-page shot was replaced by a public profile at phone width; the cover already carries a bounty's pot, rewards and dates.
4. **An upcoming bounty with no row on screen never opened on its own.** The board now posts the next opening or closing in its whole list (`nextFlip`), and the one-second tick re-renders once when it passes, together with any clock on screen that ran out in the same pass.

## Reviews

- A second reader scored the screenshots against a twelve-point design rubric. Acted on: yellow kept for money alone (rank chips, avatars and the selected row no longer use it), one rank-chip system across views, the leaderboard box ending on a whole row, the primary action filled, a clipped tab edge, a wrapped line in the rewards ticket. Left as they are: the request counter in the header, truncated one-line summaries on board rows.
- An independent code review found no blocker. Fixed from it: an expired clock could ask for a re-render every second; a clock that ran out during a render could leave a row open; a null pot could post as $0; a missing title or non-numeric count could print `undefined` or `NaN`; the builders pager could repeat page one; a superseded board read could overwrite a newer one; two gaps in `main.ts`. A rail clock running out now repaints the board alone, so the page beside it keeps its scroll.

## GitHub About

`gh repo view dockiemhiep/makefun-frontend-01 --json description,homepageUrl,repositoryTopics` — EXIT=0. Homepage `https://make.fun/bounty/makefun-frontend-01`, topics `makefun`, `ai-agents`, `bounties`, `code`, and a description in the required form: it already matched the live requirements, so it was not edited.

## Not covered

- Screen-reader testing and an automated accessibility scan were not run on this rebuild.
- Browsers other than Chrome were not opened.
- The board's "Load more bounties" control follows `next_cursor`, but the live list fits one page today, so it was exercised only by the unit tests' cursor cases.
- A bounty answering 503 still shows an error on its leaderboard address; only its cover pane and its own page fall back to the list.
- The fallback and the opening were exercised with staged answers; make.fun's own 503 had cleared by the time of this run.
- The transcript gate is checked by make.fun from the sealed recording at submission, not here.
