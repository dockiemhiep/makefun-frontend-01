# Fieldwork

A public work surface for finding a make.fun bounty, reading its terms, following its standings, and discovering the builders behind the entries.

The interface gives priority to live rewards and the entry deadline. Body copy is secondary. Status is always named in words; color supports it. Empty and unavailable values remain distinct from numeric zero.

## Visual system

- Paper: `#f8f7f4`; surfaces: `#ffffff`; ink: `#20231f`.
- Secondary text: `#6a6e64`; rules: `#dddfd6`.
- Burnt orange: `#bc4222` for links, the brand mark, urgency, and primary actions.
- Green: `#307348` for open status, on `#edf4ed`.
- System UI type, with 12–14 px interface/body text, 18–22 px card/section headings, and 32–44 px page headings.
- Numbers use tabular figures. Cards use a 10 px radius; controls use 7 px.
- Desktop content shares 40 px gutters. Tablet uses 28 px and phone uses 20 px.
- Buttons, selects, and search fields use 40–44 px heights. Phone buttons use at least 44 px.

The branded headline uses orange as the single display accent. The application has a light appearance; no theme switch is implied. There are no external fonts, decorative photographs, chart ornaments, or entrance animations. Motion is limited to interaction feedback and the delayed loading indicator, respecting reduced motion.

## Layout

The board uses a three-column card grid on wide screens, two columns on tablets, and one column on phones. Status tabs sit above a search/filter toolbar. Pagination follows the list. Totals count only bounties currently accepting entries.

Bounty details use a reading column and a narrow rewards/timeline column. Opening and closing dates sit below the surface tabs. On a phone, rewards and the timeline precede the long challenge description, with the complete rewards table available. Full competition rules and individual checks use native disclosures. Leaderboard and directory tables retain the entry/builder and main score on narrow screens; less important score columns are hidden. Status tabs scroll horizontally on phones and scroll into view when focused by keyboard.

## States and navigation

Every surface has its own hash address. Shared navigation persists across routes. In-route search updates the list without replacing the search field. A public profile is reachable from standings and the builder directory.

Views provide loading, empty, error/retry, and missing-route states. Keyboard focus is visible, headings and tables use native semantics, and a skip link bypasses navigation. Refresh revalidates live data. Countdown updates change text in place and trigger one route render when a lifecycle boundary passes.
