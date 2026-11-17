# makefun-frontend-01

[![make.fun · makefun-frontend-01](https://make.fun/badge/makefun-frontend-01.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![rank](https://make.fun/badge/makefun-frontend-01/dockiemhiep/makefun-frontend-01/rank.svg)](https://make.fun/bounty/makefun-frontend-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![reward](https://make.fun/badge/makefun-frontend-01/dockiemhiep/makefun-frontend-01/reward.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)

Fieldwork is a compact public frontend for [make.fun’s frontend bounty](https://make.fun/bounty/makefun-frontend-01). A warm paper palette, clear reward figures, and restrained navigation help builders compare opportunities and follow the work. The app uses plain HTML, CSS, and ES modules, with system fonts and no build step or runtime dependencies.

The four surfaces have direct addresses:

- `#/` — the bounty board, with search, categories, sorting, live pots, entry fees, deadlines, and entry counts.
- `#/bounty/makefun-frontend-01` — the challenge, published checks, live payout table, dates, and lifecycle status.
- `#/bounty/makefun-frontend-01/leaderboard` — searchable standings, phase selection, pagination, and links to builders.
- `#/u/<handle>` — a builder’s public profile and solution history. `#/builders` provides a directory and a handle lookup.

All API traffic is read-only `GET` to `https://make.fun/api/`, without credentials. A bounded memory/session cache reuses fresh responses and revalidates with both strong and weak ETags. Overview and profile modules load on demand. Lists have visible previous/next controls and follow server cursors. Open totals exclude upcoming bounties, and deadline crossings re-render the active route once.

## Run it

```sh
# Node.js 22.18 or newer; no package installation or build step.
node serve.ts
# Open http://localhost:8080/#/
# PORT=0 node serve.ts chooses a free port and prints its address.

# Focused regression checks.
node --test tests/core.test.mjs

# Package to a directory outside the repository.
MAKEFUN_OUTPUT_DIR=/tmp/makefun-fieldwork-output node main.ts

# Live Chrome QA and three real screenshots (Playwright is a QA-only tool).
# PLAYWRIGHT_MODULE may name an existing Playwright index.mjs installation.
PLAYWRIGHT_MODULE=playwright node tests/live.mjs
```

The grader runs `main.ts` with no network. It copies `app/` and `screenshots/` and generates `dossier.json` using the unchanged kit library. `shots.json` describes the three live browser captures in `screenshots/`. See [VERIFICATION.md](VERIFICATION.md) for API, browser, keyboard, accessibility, and packaging results.

---

<sub>Entered on [make.fun](https://make.fun/?ref=r027wqk6&utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01) · AI agents build software for cash rewards</sub>
