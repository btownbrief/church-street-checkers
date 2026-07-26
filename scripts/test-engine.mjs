// CHURCH STREET CHECKERS — engine + bot checks. Plain Node, no test framework.
// Run with:  node scripts/test-engine.mjs

import {
  SIZE, EMPTY, RED, BLACK, RED_MAN, BLACK_MAN, RED_KING, BLACK_KING,
  ownerOf, isKing, isDark, countPieces,
  createInitialState, legalMoves, applyMove, getStatus,
} from '../js/engine.js';
import { chooseMove } from '../js/bot.js';

let passed = 0;

function assert(condition, label) {
  if (!condition) {
    console.error(`✗ FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${label}`);
}

/** An empty board with `turn` to move — for crafting positions by hand. */
function emptyState(turn) {
  const grid = [];
  for (let r = 0; r < SIZE; r++) grid.push(new Array(SIZE).fill(EMPTY));
  return { grid, turn };
}

function place(state, pieces) {
  for (const [row, col, cell] of pieces) state.grid[row][col] = cell;
  return state;
}

const pathKey = (move) => move.path.map((p) => `${p.row},${p.col}`).join('>');

/** The legal move whose path visits exactly these [row, col] squares. */
function findMove(moves, squares) {
  const want = squares.map(([r, c]) => `${r},${c}`).join('>');
  return moves.find((m) => pathKey(m) === want);
}

function throws(fn) {
  try {
    fn();
  } catch {
    return true;
  }
  return false;
}

/* ---------------------------------------------------------- fresh board */

{
  const s = createInitialState();
  const st = getStatus(s);
  assert(!st.over && st.turn === RED && st.winner === null, 'fresh board: red to move, nobody has won');
  assert(countPieces(s, RED) === 12 && countPieces(s, BLACK) === 12, 'fresh board: 12 pieces a side');
  let onDark = true;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (s.grid[r][c] !== EMPTY && !isDark(r, c)) onDark = false;
    }
  }
  assert(onDark, 'every piece starts on a dark (brick) square');
  const moves = legalMoves(s);
  assert(moves.length === 7, 'fresh board: red has exactly 7 opening moves');
  assert(moves.every((m) => m.captures.length === 0 && m.path.length === 2), 'opening moves are all quiet single steps');
}

/* ---------------------------------------------------------- purity + JSON */

{
  // State must survive a JSON round trip — that's the multiplayer plan.
  let s = createInitialState();
  s = applyMove(s, legalMoves(s)[0]);
  s = JSON.parse(JSON.stringify(s));
  const moves = legalMoves(s);
  assert(moves.length > 0 && s.turn === BLACK, 'state survives JSON.stringify → parse → resume');
  const s2 = applyMove(s, moves[0]);
  assert(s2.turn === RED, 'resumed state keeps playing normally');
}

{
  // applyMove must never mutate its input.
  const before = createInitialState();
  const snapshot = JSON.stringify(before);
  applyMove(before, legalMoves(before)[0]);
  assert(JSON.stringify(before) === snapshot, 'applyMove returns a new state, never mutates');
}

/* ---------------------------------------------------------- forced captures */

{
  // Red man at (2,2) can jump the black man at (3,3); red also has a man at
  // (2,6) with quiet moves available. The jump is the ONLY legal move.
  const s = place(emptyState(RED), [
    [2, 2, RED_MAN],
    [3, 3, BLACK_MAN],
    [2, 6, RED_MAN],
    [7, 7, BLACK_MAN], // spare black piece so the game isn't already over
  ]);
  const moves = legalMoves(s);
  assert(moves.length === 1 && moves[0].captures.length === 1, 'when a jump exists, it is the only legal move');
  assert(findMove(moves, [[2, 2], [4, 4]]) !== undefined, 'the jump goes over the enemy to the empty square beyond');
  assert(
    throws(() => applyMove(s, { path: [{ row: 2, col: 6 }, { row: 3, col: 7 }], captures: [] })),
    'a quiet move is rejected while a capture exists'
  );
  const after = applyMove(s, moves[0]);
  assert(after.grid[3][3] === EMPTY && after.grid[4][4] === RED_MAN, 'the jumped piece comes off the board');
}

/* ---------------------------------------------------------- multi-jump chains */

{
  // Red man at (2,2); black men at (3,3), (5,5) and (5,3). After the first
  // jump to (4,4) there are TWO ways onward — the player picks, but stopping
  // mid-chain is illegal.
  const s = place(emptyState(RED), [
    [2, 2, RED_MAN],
    [3, 3, BLACK_MAN],
    [5, 5, BLACK_MAN],
    [5, 3, BLACK_MAN],
  ]);
  const moves = legalMoves(s);
  assert(moves.length === 2 && moves.every((m) => m.captures.length === 2), 'a multi-jump must continue: only full chains are legal');
  assert(
    findMove(moves, [[2, 2], [4, 4], [6, 6]]) !== undefined &&
    findMove(moves, [[2, 2], [4, 4], [6, 2]]) !== undefined,
    'the player may choose between capture chains'
  );
  assert(
    throws(() => applyMove(s, { path: [{ row: 2, col: 2 }, { row: 4, col: 4 }], captures: [{ row: 3, col: 3 }] })),
    'stopping a jump chain early is rejected'
  );
  const after = applyMove(s, findMove(moves, [[2, 2], [4, 4], [6, 6]]));
  assert(
    after.grid[3][3] === EMPTY && after.grid[5][5] === EMPTY && after.grid[5][3] === BLACK_MAN,
    'the chosen chain removes exactly the pieces it jumped'
  );
}

/* ---------------------------------------------------------- crowning */

{
  // Red man at (5,1) jumps the black man at (6,2), lands on the far rank at
  // (7,3) and is crowned. A second black man at (6,4) sits ready to be
  // jumped onward — but crowning ENDS the chain.
  const s = place(emptyState(RED), [
    [5, 1, RED_MAN],
    [6, 2, BLACK_MAN],
    [6, 4, BLACK_MAN],
  ]);
  const moves = legalMoves(s);
  assert(moves.length === 1 && moves[0].captures.length === 1, 'crowning ends the capture chain immediately');
  assert(findMove(moves, [[5, 1], [7, 3]]) !== undefined, 'the crowning jump lands on the far rank');
  const after = applyMove(s, moves[0]);
  assert(after.grid[7][3] === RED_KING, 'a man reaching the far rank becomes a King');
  assert(after.grid[6][4] === BLACK_MAN && after.turn === BLACK, 'play passes to the other side after crowning');
}

{
  // A quiet step onto the far rank crowns too.
  const s = place(emptyState(BLACK), [
    [1, 1, BLACK_MAN],
    [5, 5, RED_MAN], // spare red piece so the game isn't already over
  ]);
  const after = applyMove(s, findMove(legalMoves(s), [[1, 1], [0, 0]]));
  assert(after.grid[0][0] === BLACK_KING, 'a quiet move onto the far rank also crowns');
}

/* ---------------------------------------------------------- kings */

{
  // A lone red king mid-board steps in all four diagonal directions.
  const s = place(emptyState(RED), [
    [4, 4, RED_KING],
    [0, 0, BLACK_KING], // far away, not interfering
  ]);
  const moves = legalMoves(s);
  const dests = new Set(moves.map((m) => `${m.path[1].row},${m.path[1].col}`));
  assert(moves.length === 4, 'a king has all four diagonal steps');
  assert(
    dests.has('3,3') && dests.has('3,5') && dests.has('5,3') && dests.has('5,5'),
    'king steps: forward and backward both ways'
  );
}

{
  // Kings capture backward: red king at (4,4) jumps the black man BEHIND it.
  const s = place(emptyState(RED), [
    [4, 4, RED_KING],
    [3, 3, BLACK_MAN],
  ]);
  const moves = legalMoves(s);
  assert(moves.length === 1 && findMove(moves, [[4, 4], [2, 2]]) !== undefined, 'a king captures backward');
}

{
  // Men never move backward: a red man's step toward row 0 is illegal.
  const s = place(emptyState(RED), [
    [4, 4, RED_MAN],
    [0, 0, BLACK_KING],
  ]);
  assert(
    throws(() => applyMove(s, { path: [{ row: 4, col: 4 }, { row: 3, col: 3 }], captures: [] })),
    'a man cannot step backward'
  );
}

/* ---------------------------------------------------------- losing */

{
  // Blocked: red's lone man at (0,0) is walled in by black at (1,1) and
  // (2,2) — no step, no jump. Red loses with pieces still on the board.
  const s = place(emptyState(RED), [
    [0, 0, RED_MAN],
    [1, 1, BLACK_MAN],
    [2, 2, BLACK_KING],
  ]);
  const st = getStatus(s);
  assert(legalMoves(s).length === 0, 'a walled-in side has no legal moves');
  assert(st.over && st.winner === BLACK && st.reason === 'blocked', 'no legal moves loses the game');
}

{
  // Captured out: no red pieces at all.
  const s = place(emptyState(RED), [[5, 5, BLACK_MAN]]);
  const st = getStatus(s);
  assert(st.over && st.winner === BLACK && st.reason === 'captured', 'no pieces left loses the game');
}

/* ---------------------------------------------------------- random playouts */

{
  // 40 games of uniformly random legal moves (capped at 200 plies each):
  // piece counts never rise, every applied move is accepted, and any finished
  // game ends with a sane status. Shakes out corner cases by brute force.
  let finished = 0;
  for (let g = 0; g < 40; g++) {
    let s = createInitialState();
    let pieces = 24;
    for (let ply = 0; ply < 200; ply++) {
      const moves = legalMoves(s);
      if (moves.length === 0) {
        const st = getStatus(s);
        if (!st.over || st.winner !== (s.turn === RED ? BLACK : RED)) {
          assert(false, 'random playouts: finished games report the right winner');
        }
        finished++;
        break;
      }
      s = applyMove(s, moves[Math.floor(Math.random() * moves.length)]);
      const nowPieces = countPieces(s, RED) + countPieces(s, BLACK);
      if (nowPieces > pieces) assert(false, 'random playouts: piece counts never increase');
      pieces = nowPieces;
    }
  }
  assert(true, `random playouts: 40 games clean (${finished} played to a finish)`);
}

/* ---------------------------------------------------------- Marketplace Master */

{
  // Black to move, two capture options: a black man can nibble one red piece,
  // or the black king can run a double jump that clears red off the board.
  // The Master must take the winning chain.
  const s = place(emptyState(BLACK), [
    [5, 5, BLACK_KING],
    [4, 4, RED_MAN],
    [2, 2, RED_MAN],
    [5, 3, BLACK_MAN],
  ]);
  const options = legalMoves(s);
  assert(options.length >= 2, 'crafted position: the Master genuinely has a choice');
  const t0 = performance.now();
  const move = chooseMove(s, 'master');
  const ms = performance.now() - t0;
  assert(move.captures.length === 2, 'Master takes the winning capture chain');
  const st = getStatus(applyMove(s, move));
  assert(st.over && st.winner === BLACK, 'and that chain wins the game on the spot');
  console.log(`  (Master decided in ${ms.toFixed(0)}ms)`);
}

{
  // A deliberately crowded 16-piece midgame with 11 quiet choices. The
  // deadline must still bound the synchronous search on a wide position.
  const s = place(emptyState(RED), [
    [0, 0, RED_MAN],
    [0, 2, RED_MAN],
    [0, 4, RED_MAN],
    [0, 6, RED_MAN],
    [1, 5, RED_MAN],
    [1, 7, RED_MAN],
    [2, 0, RED_MAN],
    [4, 4, BLACK_MAN],
    [4, 6, RED_MAN],
    [5, 3, RED_MAN],
    [6, 0, BLACK_MAN],
    [6, 2, BLACK_MAN],
    [6, 6, BLACK_MAN],
    [7, 1, BLACK_MAN],
    [7, 3, BLACK_MAN],
    [7, 5, BLACK_MAN],
  ]);
  const options = legalMoves(s);
  const t0 = performance.now();
  const move = chooseMove(s, 'master');
  const ms = performance.now() - t0;
  assert(
    options.some((m) => pathKey(m) === pathKey(move)) && ms < 2_000,
    'Master returns a legal move from a dense midgame in under 2 seconds'
  );
  console.log(`  (Dense-midgame reply took ${ms.toFixed(0)}ms)`);
}

{
  // Speed check from the opening, the widest quiet position it will face
  // early on. Target ≈500ms; the floor pass is depth 4.
  const s = applyMove(createInitialState(), legalMoves(createInitialState())[0]);
  const t0 = performance.now();
  const move = chooseMove(s, 'master');
  const ms = performance.now() - t0;
  assert(legalMoves(s).some((m) => pathKey(m) === pathKey(move)), 'Master replies with a legal move');
  console.log(`  (Master's opening reply took ${ms.toFixed(0)}ms — target ≈500ms)`);
  assert(ms < 800, 'Master moves fast enough');
}

{
  // The Master should flatten the Stroller far more often than not.
  // 6 full games, alternating colors; the Stroller must not win a single one
  // (letting the odd unfinished long game slide).
  let masterWins = 0;
  let strollerWins = 0;
  for (let g = 0; g < 6; g++) {
    const masterPlays = g % 2 === 0 ? RED : BLACK;
    let s = createInitialState();
    for (let ply = 0; ply < 240; ply++) {
      const st = getStatus(s);
      if (st.over) {
        if (st.winner === masterPlays) masterWins++;
        else strollerWins++;
        break;
      }
      s = applyMove(s, chooseMove(s, s.turn === masterPlays ? 'master' : 'stroller'));
    }
  }
  console.log(`  (Master ${masterWins} — ${strollerWins} Stroller over 6 games)`);
  assert(strollerWins === 0 && masterWins >= 4, 'Master dominates the Stroller across 6 games');
}

/* ---------------------------------------------------------- Stroller */

{
  // Stroller sanity: always legal, and takes a game-ending capture.
  const s = place(emptyState(BLACK), [
    [5, 5, BLACK_KING],
    [4, 4, RED_MAN],
    [2, 2, RED_MAN],
    [5, 3, BLACK_MAN],
  ]);
  const move = chooseMove(s, 'stroller');
  assert(getStatus(applyMove(s, move)).over, 'Stroller takes a game-ending capture');
  for (let i = 0; i < 50; i++) {
    const fresh = createInitialState();
    const m = chooseMove(fresh, 'stroller');
    if (!legalMoves(fresh).some((lm) => pathKey(lm) === pathKey(m))) {
      assert(false, 'Stroller only plays legal moves');
    }
  }
  assert(true, 'Stroller only plays legal moves (50 fresh openings)');
}

console.log(`\n🧱 All ${passed} checks passed. See you on the bricks.`);
