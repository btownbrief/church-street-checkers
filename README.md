# CHURCH STREET CHECKERS 🧱🔴⚫

American checkers on the brick paving of Church Street Marketplace:
café-table **red** vs. cast-iron **black**, jumps are mandatory, and a man
who makes it the length of the block gets a crown. A game for
[Btown Games](https://play.btownbrief.com/), the browser arcade of the
[BTown Brief](https://www.btownbrief.com).

**Play it live:** https://play.btownbrief.com/church-street-checkers/

## Modes

- **Pass & play** — two strollers, one phone; the board flips between turns.
- **The Stroller** 🍦 — glances one move ahead, wanders on purpose; beatable
  by a kid.
- **Marketplace Master** 🎩 — minimax with alpha–beta pruning, 7–11 plies
  deep plus a capture-extension search. Moves in well under 500ms and does
  not go easy on you.

## The rules (American checkers)

8×8 board, played on the dark squares, 12 pieces a side. Men move one square
diagonally forward and capture by jumping. **Captures are mandatory** — if a
jump exists you must take one, and a multi-jump must be played to the end
(when several capture chains exist, you pick which; the longest is *not*
required). A man reaching the far rank is crowned King — and crowning ends a
capture chain on the spot. Kings step and jump diagonally in all four
directions (one square, no flying). You lose with no pieces or no legal
moves. There is no draw rule — in a dead-even endgame, settle it over
creemees.

## How it works

Plain static site — no build step, no frameworks, no npm. `index.html` +
`style.css` + ES modules in `js/`:

| file | what it does |
| --- | --- |
| `js/engine.js` | **all** the checkers rules, as pure functions over a plain JSON state object — see the rule below |
| `js/bot.js` | the Stroller and the Marketplace Master; only ever calls the engine's public API |
| `js/main.js` | UI only: renders state, animates jumps and crownings, flips the board, keeps the session tally |
| `js/audio.js` | procedural WebAudio taps and fanfares, no audio files |

Every push to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## The engine rule (the one non-negotiable)

Online multiplayer gets bolted on later by syncing the engine's state object
between phones. That only works if **every** rule lives in `js/engine.js`:

- `createInitialState()`, `legalMoves(state)`, `applyMove(state, move)`
  (returns a NEW state, never mutates), `getStatus(state)`.
- `engine.js` imports nothing and never touches the DOM, timers, `Date`, or
  `Math.random`.
- The whole game survives `JSON.stringify` → `JSON.parse` → resume.

If you add a rule anywhere else, you've broken the multiplayer plan.

## Testing

```bash
node scripts/test-engine.mjs
```

Plain Node, no test framework. Covers forced captures, multi-jump chains,
crowning (including that it ends a chain), king movement, both ways to lose,
state immutability, the JSON round trip, 40 random playouts, and that the
Marketplace Master finds a winning capture fast enough.

## Regenerating the app icon

`icon-180.png` is rendered from `icon.svg`:

```bash
chrome --headless --screenshot=icon-180.png --window-size=180,180 --default-background-color=00000000 "file://$(pwd)/icon.svg"
```
