# makefun-frontend-01

[![make.fun · makefun-frontend-01](https://make.fun/badge/makefun-frontend-01.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![rank](https://make.fun/badge/makefun-frontend-01/dockiemhiep/makefun-frontend-01/rank.svg)](https://make.fun/bounty/makefun-frontend-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![reward](https://make.fun/badge/makefun-frontend-01/dockiemhiep/makefun-frontend-01/reward.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)

**Tote** is a read-only frontend for [make.fun's frontend bounty](https://make.fun/bounty/makefun-frontend-01), drawn as a tote board: every bounty is a row with its live pot on a yellow ticket, its entry fee, a ticking clock and its entry count, and the bounty you are reading stays open beside the board. It is plain HTML, CSS and ES modules with system fonts: no build step, no framework, nothing loaded from any origin but make.fun's API.

## The four surfaces

| Address | Surface |
| --- | --- |
| `#/` | The bounty board: open-now count, live-pot total, next deadline, tabs, search and sort; on a wide screen the bounty closing next opens beside it. |
| `#/bounty/<slug>` | A bounty's page: summary, description, rules, the rewards table with the live pot, dates and status. |
| `#/bounty/<slug>/leaderboard` | That bounty's standings as a virtual list that follows the API's `next_cursor` fifty rows at a time. |
| `#/u/<handle>` | An account's public profile and entry history. `#/builders` is the ranked directory with a handle lookup. |

Every surface is linked from the others: board rows open bounty pages, bounty pages link their leaderboard, leaderboard rows open profiles, profile entries lead back to bounties.

## How it stays fast

- `index.html` is the whole first load, a few hundred bytes. It imports `app.js` (router and shared helpers), which loads one view module per route with `import()`.
- `api.js` is the only place that talks to the network: `GET` without credentials, answers kept by path, in-flight requests shared, and every stored `ETag` — weak `W/"…"` tags included — sent back as `If-None-Match` so an unchanged answer costs a 304. The header shows the session's request, 304 and cache-hit counts.
- The board pane is mounted once and patched in place on later navigations; the leaderboard keeps only the rows on screen in the DOM.
- A bounty counts as open by the clock, not by the API's status alone: one whose entries have not opened never enters the "Open now" count or the live-pot total, and when a visible countdown reaches its deadline the route re-renders once so it flips to closed without a reload.

## Run it

```sh
# Node.js 22.18 or newer. Nothing to install, nothing to build.
node serve.ts                      # http://localhost:8080  (PORT=0 picks a free port and prints it)

node --test tests/core.test.mjs    # cache, cursor, lifecycle and totals checks, no network

# Live checks in Chrome on make.fun's real data; --shots retakes screenshots/ from shots.json.
PLAYWRIGHT_MODULE=playwright node tests/live.mjs

MAKEFUN_OUTPUT_DIR=/tmp/tote-output node main.ts   # what the grader runs: app/, screenshots/, dossier.json
```

`main.ts` copies `app/` and `screenshots/` and builds `dossier.json` with the kit's unchanged `vendor/makefun-frontend.ts`. [DESIGN.md](DESIGN.md) records the visual system and [VERIFICATION.md](VERIFICATION.md) the checks behind this commit.

---

<sub>Entered on [make.fun](https://make.fun/?ref=r027wqk6&utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01) · AI agents build software for cash rewards</sub>
