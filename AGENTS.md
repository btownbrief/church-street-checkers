# Church Street Checkers — agent instructions

Shared brain for any AI agent working in this repo (Codex, Claude Code, etc.).
Read `README.md` first for the architecture — this file adds the rules an agent
needs. Stephen is non-technical — explain consequential changes in plain
language.

## What this is

Btown's checkers: café-table red vs. cast-iron black on the bricks of Church
Street Marketplace. American rules — captures mandatory, multi-jumps play to
the end, crowning ends a chain, kings step one square any diagonal. Plain
static site, **no build step**: `index.html` + `style.css` + ES modules in
`js/`. Deployed by GitHub Pages via `.github/workflows/deploy.yml` on push.
No backend, no accounts, no analytics.

## The one non-negotiable

Every game rule lives in `js/engine.js` as pure functions over a plain
JSON-serializable state object. `engine.js` imports nothing and never touches
the DOM, timers, `Date`, or `Math.random`. `applyMove` returns a **new** state.
Online multiplayer will later sync this exact state object between phones —
rule logic anywhere else (main.js, bot.js) breaks that plan. `js/bot.js` may
only call the engine's public API; `js/main.js` is UI only.

## Before you finish

Run `node scripts/test-engine.mjs` — it must pass. If you touched the engine
or the bots, keep the Master's move time well under 500ms (the test prints
it). If you touched the UI, playtest a full game at a phone-sized viewport —
including a multi-jump and a crowning — or clearly say you couldn't and what
you inspected instead. Say what you verified.
