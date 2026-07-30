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

## Online play (the rooms layer)

`js/rooms.js` is the fleet's vendored online-multiplayer client — the
CANONICAL copy lives in `four-in-a-rowboat`; copy it here verbatim. It talks
to the shared Supabase rooms backend (btownbrief.github.io/supabase/
rooms-2026-07-30.sql): a room is a 4-letter code + the entire engine state as
opaque JSON + a version number. After your move you push the new state with
the version you last saw; everyone else polls. All rules stay in engine.js —
rooms.js knows nothing about any game. Host sits in seat 0 (red); the joiner
is seat 1 (black). If the backend SQL isn't installed yet, clients get a
clean `not_ready` error and the UI says online play isn't switched on.

`scripts/rooms-shim.mjs` is a faithful local stand-in for the backend; its
canonical copy also lives in `four-in-a-rowboat`.
`scripts/test-rooms.mjs` drives the real client + engine through a full
online game against it, so the whole flow is testable offline.

## Before you finish

Run `node scripts/test-engine.mjs` — it must pass. If you touched rooms.js,
main.js's online section, or the shim, also run `node scripts/test-rooms.mjs`.
If you touched the engine or the bots, keep the Master's move time well under
500ms (the test prints it). If you touched the UI, playtest a full game at a
phone-sized viewport — including a multi-jump and a crowning — or clearly say
you couldn't and what you inspected instead. Say what you verified.
