// CHURCH STREET CHECKERS — the two computer opponents.
//
// This module only talks to the engine through its public API (legalMoves,
// applyMove, getStatus, and the exported constants) plus reading the plain
// state object. No rule logic lives here — if the engine says a move is
// legal, it's legal (and the engine already enforces mandatory captures).
//
//   STROLLER — out for a creemee, glances one move ahead, wanders. Blunders
//              on purpose often enough that a kid can beat the Stroller.
//   MARKETPLACE MASTER — negamax with alpha-beta pruning, iteratively
//              deepened from 4 to 11 plies under a time budget, plus a
//              capture-extension search so it never stops counting mid-trade.
//              Depth 4 always completes; a move lands in well under 500ms.

import {
  SIZE, RED, BLACK, RED_MAN, BLACK_MAN, RED_KING, BLACK_KING,
  ownerOf, isKing, opponentOf, legalMoves, applyMove, getStatus, countPieces,
} from './engine.js';

const WIN_SCORE = 1_000_000;
const MIN_DEPTH = 4; // this cheap floor pass always runs to completion
const MAX_DEPTH = 11;
const TIME_BUDGET_MS = 350;

/** Pick a move for the side to move. level: 'stroller' | 'master'. */
export function chooseMove(state, level) {
  const moves = legalMoves(state);
  if (moves.length === 0) throw new Error('No legal moves — the game is over.');
  if (moves.length === 1) return moves[0]; // forced (usually a mandatory jump)
  return level === 'master' ? masterMove(state, moves) : strollerMove(state, moves);
}

/* ------------------------------------------------------------- Stroller */

function strollerMove(state, moves) {
  // Even a daydreamer takes a move that ends the game on the spot.
  const winNow = moves.find((m) => getStatus(applyMove(state, m)).over);
  if (winNow) return winNow;

  // A quarter of the time, pure window-shopping: any legal move at all.
  // This is the whole reason a kid can beat the Stroller.
  if (Math.random() < 0.25) return moves[Math.floor(Math.random() * moves.length)];

  // Otherwise a 1-ply glance: don't hand over pieces, drift forward a bit.
  const me = state.turn;
  let best = [];
  let bestScore = -Infinity;
  for (const move of moves) {
    const next = applyMove(state, move);
    const replies = legalMoves(next);
    const givesAway = replies.length > 0 && replies[0].captures.length > 0
      ? Math.max(...replies.map((r) => r.captures.length))
      : 0;
    const dest = move.path[move.path.length - 1];
    const forward = me === RED ? dest.row : SIZE - 1 - dest.row;
    const score = move.captures.length * 12 - givesAway * 10 + forward + Math.random() * 3;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = [move];
    } else if (Math.abs(score - bestScore) <= 1e-9) {
      best.push(move);
    }
  }
  return best[Math.floor(Math.random() * best.length)];
}

/* ------------------------------------------------------------- Master */

// Search bookkeeping for the time budget. The clock lives here in bot.js —
// the engine itself stays clock-free and pure.
let deadline = 0;
let abortable = false;
let aborted = false;
let nodeCount = 0;

function now() {
  return (typeof performance !== 'undefined' ? performance : Date).now();
}

function masterMove(state, moves) {
  let ordered = orderMoves(state, moves);
  deadline = now() + TIME_BUDGET_MS;
  let bestMove = ordered[0];
  for (let depth = MIN_DEPTH; depth <= MAX_DEPTH; depth++) {
    abortable = depth > MIN_DEPTH; // the floor pass must finish
    aborted = false;
    nodeCount = 0;
    const move = rootSearch(state, ordered, depth);
    if (aborted) break; // out of time mid-pass: keep the previous depth's answer
    bestMove = move;
    ordered = [move, ...ordered.filter((candidate) => candidate !== move)];
    if (now() >= deadline) break;
  }
  return bestMove;
}

function rootSearch(state, ordered, depth) {
  let bestMove = ordered[0];
  let alpha = -Infinity;
  for (const move of ordered) {
    const score = -negamax(applyMove(state, move), depth - 1, -Infinity, -alpha);
    if (aborted) break;
    if (score > alpha) {
      alpha = score;
      bestMove = move;
    }
  }
  return bestMove;
}

// Score from the perspective of the side to move in `state`. When the depth
// runs out in the middle of a forced-capture melee, keep searching until the
// dust settles — captures shrink the board, so the extension always ends.
function negamax(state, depth, alpha, beta) {
  if (abortable && (++nodeCount & 255) === 0 && now() >= deadline) {
    aborted = true;
  }
  if (aborted) return 0; // value is discarded once aborted

  const moves = legalMoves(state);
  if (moves.length === 0) {
    // The side to move has no moves: it lost. Add depth so nearer wins
    // (and farther losses) score better.
    return -(WIN_SCORE + Math.max(depth, 0));
  }
  if (depth <= 0 && moves[0].captures.length === 0) {
    return evaluate(state);
  }

  for (const move of orderMoves(state, moves)) {
    const score = -negamax(applyMove(state, move), depth - 1, -beta, -alpha);
    if (aborted) return 0;
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// Biggest captures first, then crowning moves — good ordering is what makes
// alpha-beta pruning fast.
function orderMoves(state, moves) {
  const player = state.turn;
  const crownRow = player === RED ? SIZE - 1 : 0;
  return moves
    .map((move) => {
      const from = move.path[0];
      const dest = move.path[move.path.length - 1];
      const crowns = !isKing(state.grid[from.row][from.col]) && dest.row === crownRow;
      return { move, key: move.captures.length * 10 + (crowns ? 5 : 0) };
    })
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.move);
}

// Static evaluation from the point of view of the side to move.
// Material rules everything; the positional terms nudge men forward, keep a
// couple of guards home, and pull the winning side in for the finish.
function evaluate(state) {
  const me = state.turn;
  let score = 0;
  let myMen = 0;
  let theirMen = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = state.grid[r][c];
      const owner = ownerOf(cell);
      if (owner === 0) continue;
      let value = isKing(cell) ? 160 : 100;
      if (!isKing(cell)) {
        value += (owner === RED ? r : SIZE - 1 - r) * 2; // marching toward the crown
        if (r === (owner === RED ? 0 : SIZE - 1)) value += 4; // back-rank guard
      }
      if (r >= 2 && r <= 5 && c >= 2 && c <= 5) value += 3; // the middle of the block
      if (owner === me) {
        score += value;
        myMen++;
      } else {
        score -= value;
        theirMen++;
      }
    }
  }
  // Ahead on material? Trading down sharpens the win — reward emptier boards.
  if (score > 60) score += (24 - myMen - theirMen) * 2;
  else if (score < -60) score -= (24 - myMen - theirMen) * 2;
  return score;
}
