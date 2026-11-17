# Verification record

Verification completed on 2026-11-17. No entry was submitted. Submission and sealing the recordings remain separate actions.

## Live API contracts

Read the current [OpenAPI](https://make.fun/api/openapi.json), relevant [agent documentation](https://make.fun/llms.txt), and [competition requirements](https://make.fun/api/competitions/makefun-frontend-01/requirements). The requirements still prescribe the README badges/About, strict recordings and run record, and the entry deadline **2026-11-17T12:30:00.000Z**.

Verified real GET responses for the board, bounty detail, requirements, leaderboard, rankings, and public profile. Corrected these assumptions:

- Leaderboard `values` are keyed objects; columns use `title` and `source`. Judge win rates and their intervals are millionths, now displayed as percentages.
- Profiles and rankings expose snake_case `record` fields, `image`/`avatar` pictures, and profile links. Solutions use `entered_at`, `placement`, and `prize_usd`.
- Bounty details request `submissions=summary`, avoiding an unused full submission list. Rewards use the requirements' live payout curve.

## Live Chrome verification

`PLAYWRIGHT_MODULE=/Users/conan/gstack/node_modules/playwright/index.mjs node tests/live.mjs` — **EXIT=0**. Final run: **2026-11-17T02:13:55.723Z**, Chrome **157.0.8103.79**.

- Board, bounty overview, bounty leaderboard, and linked public profile passed at **1280×900** and **390×844**.
- Real score, reward-row, deadline, solution-date, and profile-record assertions passed. There were **0 console/page errors**, **0 failed requests or HTTP errors**, and **12 live API GET requests**, including avatar images.
- The three submitted screenshots are real, unedited browser JPEG captures at 1280×900: `1-board.jpg` (95,036 bytes), `2-bounty.jpg` (123,101 bytes), `3-leaderboard.jpg` (84,431 bytes). Each is below 256 KiB. They replace every starter image.
- Captures wait for visible images and settled frames. An intermediate phone capture showed a duplicate-header compositor artifact after a full-page desktop capture; removing that intervening resize and recapturing resolved it. DOM checks also confirmed one header.
- Reviewed all three submitted screenshots and supplementary phone/profile captures directly. A fresh independent reader confirmed the final captures have no material visual defects. Dates now sit near the heading; phones put rewards before the long challenge description; full rules use a native disclosure.

Supplementary browser QA (`/tmp/makefun-interaction-qa.mjs`) — **EXIT=0**:

- **25** route/width checks: all four required surfaces plus builders at **320, 390, 768, 1024, and 1440 px**. No horizontal page overflow.
- Keyboard: skip link, `/` search, Tab navigation with a visible 3 px focus ring, bounty/profile links, Space/Enter rules disclosure, leaderboard next/previous, builder directory cursor through page four, and handle lookup all passed. All five status tabs remain reachable; keyboard focus scrolls the phone status strip into view.
- **10 axe-core 4.14.1 scans**, all five surfaces at 1440 and 390 px, reported **0 violations** for WCAG A/AA, 2.1 AA, and 2.2 AA tags. This is automated and keyboard evidence, not a screen-reader certification. The intentional light theme was also checked with a dark OS preference and reduced motion enabled.
- Layout probes were reviewed with the screenshots. Their header brand/button size differences and typography match the existing system; clipped-label findings were screen-reader-only labels. The long API-authored challenge paragraph is preserved. The horizontally scrolling phone status strip is intentional.

Local supplementary evidence: `/var/folders/qr/trtsj2fs55g9_28nhn6rlbgh0000gn/T/makefun-live-vq85Ky` and `/var/folders/qr/trtsj2fs55g9_28nhn6rlbgh0000gn/T/makefun-interaction-7BmDel`. Only the three intended JPEGs are packaged.

## Package and regression checks

- `node --test tests/core.test.mjs` — **EXIT=0**, **8 passed**. Covers opening/deadline boundaries and totals, missing/zero values, live judge units, avatar CORS/source fields, description escaping, ETag revalidation/fresh reuse/deduplication, and opaque cursors. Both new regressions failed before their fixes.
- Syntax checks of all app JS modules, both tests, `main.ts`, and `serve.ts` — **EXIT=0**, **10 files**. TypeScript was stripped with Node's `stripTypeScriptTypes` before `node --check`; raw `node --check serve.ts` does not handle its type annotations. No repository lint/typecheck configuration exists.
- `diff -qr vendor ../makefun-frontend-01-kit/starter/vendor` — **EXIT=0**. The kit vendor files are unchanged.
- `git diff --check` — **EXIT=0**.
- `main.ts` ran with two separate temporary `MAKEFUN_OUTPUT_DIR` directories — both **EXIT=0**. Each output contained only `app/`, `screenshots/`, and `dossier.json`. Both dossiers matched each other and a fresh `buildDossier` recomputation byte for byte.
- Dossier: **478,504 bytes**, SHA-256 `4dc274a396d69ebc0f2b815413b2a39fd8f7d05125b4c2c8898f1f43f538a777`. First load: **6 files, 15,732 bytes gzip-9 / 50,624 raw**; later modules: **2 files, 7,347 bytes gzip-9**; whole app: **9 files / 71,960 bytes**. These are dossier byte counts, not browser performance measurements.

## GitHub About

`gh repo view dockiemhiep/makefun-frontend-01 --json description,homepageUrl,repositoryTopics` — **EXIT=0**. The existing values already match the live requirements, so no edit was needed:

- Description: Zero-build static client with minute-bound ETag caching, deadline-verified bounty board, live-pot rewards tables, paginated leaderboards, and builder profiles. Built by an AI agent for make.fun's “Build the best make.fun frontend” bounty, $500 in USDC plus entry fees.
- Homepage: `https://make.fun/bounty/makefun-frontend-01`
- Topics: `makefun`, `ai-agents`, `bounties`, `code`.

The README keeps all three prescribed badges and its filled referral link; the MIT license remains in place.

## Recording continuity and local server

Previous recording `01a1e70f-11f4-701a-9eb3-9144f551f59d` built the implementation but could not reach the network, bind TCP, or launch Chrome. This recorded session completed that verification and the API fixes.

`serve.ts` now accepts validated `PORT` configuration (CLI takes precedence), permits port zero, and prints the actual bound address. Live QA used `PORT=0` through that server, including the final run at `127.0.0.1:53630`. This is a functional change to the previously unchanged counted starter file. Test servers and browsers are closed after use; temporary evidence is retained outside the repository. The transcript gate itself is checked by make.fun from sealed recordings at submission, not by these local tests.
