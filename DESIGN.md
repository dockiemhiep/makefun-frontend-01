# Tote

A tote board for make.fun: the place where the prize money, the price of entry and the clock are posted for everyone to read at a glance.

The people using it are builders choosing where to spend an evening. They ask three things of every bounty — how much is in the pot, what it costs to enter, how long is left — then want the terms, the standings and the people behind the entries without losing their place on the board.

## Direction

Racing form meets price sticker. Newsprint ground, ink rules, square corners, hard offset shadows. Money is always on a yellow ticket and nothing else is yellow, so the eye finds every pot on the page before it reads a word. Red is spent only on urgency (under 24 hours left); green only on "open". Type is the system sans at heavy weights for names and numbers, with monospace capitals for the small labels that name a column or a figure.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#f3f0e6` | page ground, the board pane |
| `--card` | `#fffefa` | the reading pane, raised blocks |
| `--ink` | `#11110f` | text, 2px rules, the top bar |
| `--tag` | `#ffd60a` | money tickets, the selected row, prize ranks |
| `--hot` | `#d7301a` | clocks under 24 hours, focus rings |
| `--go` | `#0a7a3c` | the "Open" status |
| `--mute` | `#66645b` | labels and secondary text |
| `--hair` | `#d6d1c0` | row dividers |

Spacing steps are 4, 8, 12, 16, 24 and 32 px. Rules are 2px ink; row dividers are 1px hairlines. The only shadow is a 3px hard offset in ink. Controls are 40px tall. Figures are tabular everywhere.

## Layout

On a wide screen the page is two panes under a 52px ink bar, each scrolling on its own. On the board's address the board takes the wide pane and the bounty closing next is posted beside it as a ticket; on every other address the board folds into a 340px rail and the page being read takes the room. The rail keeps all four facts per row and marks the bounty that is open.

On a phone there is one pane per address: the board at `#/`, the page elsewhere. Panes are size containers, so the board's rows fold from a five-column form into two-line rows by their own width, wherever they sit.

## Components

`.tag` money ticket (`.big` for the pot) · `.status` open / opens soon / entries closed / finished · `.until` ticking clock · `.tabs` joined ink tabs · `.field` search and select · `.btn` · `.stats` ruled figure strip · `.kv` dates · `.grid` tables with monospace heads · `.rank` chips (yellow for paid places) · `.avatar` · `.pager` · `.empty` · `.prose`.

## States

Every view has loading, empty, failed-with-retry and not-found states. An unknown value shows a dash, never a zero. Status is always written in words and never carried by color alone. Focus is a 3px red outline; a skip link leads past the bar; motion is limited to the loading bar and is removed under reduced-motion.
