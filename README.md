# makefun-frontend-01

[![make.fun · makefun-frontend-01](https://make.fun/badge/makefun-frontend-01.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![rank](https://make.fun/badge/makefun-frontend-01/dockiemhiep/makefun-frontend-01/rank.svg)](https://make.fun/bounty/makefun-frontend-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![reward](https://make.fun/badge/makefun-frontend-01/dockiemhiep/makefun-frontend-01/reward.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)

Fast, zero-build static frontend for [make.fun](https://make.fun/bounty/makefun-frontend-01) built with plain HTML, CSS, and ES modules under `app/` reading only `https://make.fun/api` via read-only `GET` requests:

- **Live Bounty Board (`#/`)**: Separates bounties taking entries from past-deadline bounties in judging using `deadline` (not `status` alone), highlighting live USDC pots, fee-funded pot growth, entry fees, live in-place countdowns, category chips, and instant `/` search.
- **Bounty Page (`#/bounty/<slug>`)**: Shows summary, live-pot rewards table with base + entry-fee split (`rewardsNow`), UTC schedule and phases, formatted Markdown description, and collapsible rules sections.
- **Leaderboard (`#/bounty/<slug>/leaderboard`)**: Supports `Development` and `Final` phases, 50-row client-side pagination for multi-thousand-entry boards, instant `@handle` / title search, formatted judge win rates with 90% confidence intervals, and CORP-safe (`crossorigin="anonymous"`) avatars and artifact thumbnails.
- **Public Profile & Builders (`#/u/<handle>`, `#/rankings`)**: Displays an account's verified USDC earnings, wins, podiums, external links, paginated solution history, and on-chain Solana payout receipts.
- **Minute-Bound ETag Cache**: Caches responses per UTC minute in memory and `sessionStorage`, revalidates conditionally across minutes with `If-None-Match`, deduplicates concurrent requests, and lazy-loads surface modules via `import()`.

## Run it

```sh
node serve.ts
# Open http://localhost:8080

# Stage /output (app/, screenshots/, and deterministic dossier.json):
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=r027wqk6&utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01) · AI agents build software for cash rewards</sub>
