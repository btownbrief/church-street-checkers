// CHURCH STREET CHECKERS — UI only. A Btown Games production for the BTown Brief.
//
// This file renders state, animates checkers over the bricks, and dispatches
// moves. Every rule lives in js/engine.js and every bot decision in
// js/bot.js — if you're tempted to check whether a jump is legal here, stop
// and ask legalMoves() instead.

import {
  SIZE, RED, BLACK, ownerOf, isKing, isDark, opponentOf,
  createInitialState, legalMoves, applyMove, getStatus,
} from './engine.js';
import { chooseMove } from './bot.js';
import { sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const menuEl = $('menu');
const gameEl = $('game');
const boardEl = $('board');
const sceneEl = $('boardScene');
const cellsEl = $('cells');
const piecesEl = $('pieces');
const turnChip = $('turnChip');
const forcedChip = $('forcedChip');
const tallyEl = $('tally');
const resultBar = $('resultbar');
const resultText = $('resultText');
const cheerEl = $('cheer');
const cheerBubble = $('cheerBubble');
const announcerEl = $('announcer');
const endCreditEl = $('creditEnd');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const STEP_MS = reducedMotion ? 0 : 240;

/* ------------------------------------------------------------- copy desk */

const BOT_NAMES = { stroller: 'STROLLER', master: 'MASTER' };
const THINKING = {
  stroller: 'THE STROLLER’S LICKING A CREEMEE…',
  master: 'THE MASTER’S PONDERING…',
};
const BOT_WIN_LINES = {
  stroller: 'THE STROLLER MOSEYS PAST YOU',
  master: 'THE MASTER HOLDS COURT',
};
const CHEER_LINES = [
  'Monarch of the Marketplace!',
  'Sweetest jump on Church Street!',
  'The buskers approve. 🎸',
  'Somebody ring the church bells!',
  'Creemees on the loser!',
  'Cleared the bricks like a snowplow!',
];

/* ------------------------------------------------------------- game shell */

let mode = 'pass'; // 'pass' | 'stroller' | 'master'
let state = createInitialState();
let moves = []; // legal moves for the side to move, refreshed each turn
let busy = false; // an animation or bot think is in flight
let botTimer = 0;
let session = 0; // bumped on every new game / exit, cancels stale timers
let tally = { red: 0, black: 0 };
let over = false;

// Step-by-step move picking: `chain` is the squares tapped so far (the
// selected piece first). Complete paths always come from the engine's move
// list — the UI never invents its own.
let chain = [];

// Piece elements, keyed by "row,col" in engine coordinates.
const pieceEls = new Map();

// Build the 64 brick-and-paver cells once. DOM order is display order:
// top row first, and engine row 0 (red's back rank) is the bottom.
const cellEls = new Map();
for (let dispRow = 0; dispRow < SIZE; dispRow++) {
  for (let col = 0; col < SIZE; col++) {
    const row = SIZE - 1 - dispRow;
    const cell = document.createElement('button');
    cell.className = isDark(row, col) ? 'dark' : 'light';
    cell.addEventListener('click', () => onCellTap(row, col));
    cellsEl.appendChild(cell);
    cellEls.set(`${row},${col}`, cell);
  }
}

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => startMatch(btn.dataset.mode));
});
$('menuBtn').addEventListener('click', backToBlock);
$('rematchBtn').addEventListener('click', newGame);
$('mute').addEventListener('click', () => {
  $('mute').textContent = sound.toggleMuted() ? '🔇' : '🔊';
});
$('mute').textContent = sound.muted ? '🔇' : '🔊';

function startMatch(chosen) {
  mode = chosen;
  tally = { red: 0, black: 0 };
  menuEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  newGame();
}

function backToBlock() {
  session++;
  clearTimeout(botTimer);
  busy = false;
  gameEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
}

function newGame() {
  session++;
  clearTimeout(botTimer);
  state = createInitialState(); // red opens every game
  over = false;
  busy = false;
  chain = [];
  boardEl.classList.remove('showdown');
  cellsEl.classList.remove('disabled');
  resultBar.classList.add('hidden');
  cheerEl.classList.add('hidden');
  endCreditEl.classList.add('hidden');
  announcerEl.textContent = '';
  syncPieces();
  renderTally();
  startTurn();
}

function later(ms, fn) {
  const mySession = session;
  return setTimeout(() => {
    if (session === mySession) fn();
  }, ms);
}

/* ------------------------------------------------------------- turns */

function isBotsTurn() {
  return mode !== 'pass' && !over && state.turn === BLACK;
}

// Refresh the move list, the turn chip, the forced-jump glow and the board
// orientation for whoever moves next.
function startTurn() {
  moves = legalMoves(state);
  chain = [];
  clearHighlights();
  renderTurn();
  orientBoard();
  if (isBotsTurn()) scheduleBotMove();
}

function orientBoard() {
  // Pass & play: the board spins so the mover always plays "up" the street.
  const flip = mode === 'pass' && !over && state.turn === BLACK;
  sceneEl.classList.toggle('flipped', flip);
}

function onCellTap(row, col) {
  if (busy || over || isBotsTurn()) return;

  // Mid-jump: the only choices are the chain's continuations.
  if (chain.length > 1) {
    if (nextSquares().has(`${row},${col}`)) stepTo(row, col);
    return;
  }

  const cell = state.grid[row][col];
  if (ownerOf(cell) === state.turn) {
    const sel = chain[0];
    if (sel && sel.row === row && sel.col === col) {
      chain = [];
      clearHighlights();
      markForced();
      return;
    }
    if (moves.some((m) => m.path[0].row === row && m.path[0].col === col)) {
      chain = [{ row, col }];
      showTargets();
    }
    return;
  }

  if (chain.length === 1 && nextSquares().has(`${row},${col}`)) {
    stepTo(row, col);
  } else if (chain.length === 1) {
    chain = [];
    clearHighlights();
    markForced();
  }
}

// Legal moves that begin with the squares tapped so far.
function candidates() {
  return moves.filter(
    (m) => chain.length <= m.path.length &&
      chain.every((p, i) => m.path[i].row === p.row && m.path[i].col === p.col)
  );
}

// Where the chain can go next, as a Set of "row,col".
function nextSquares() {
  const set = new Set();
  for (const m of candidates()) {
    if (m.path.length > chain.length) {
      const p = m.path[chain.length];
      set.add(`${p.row},${p.col}`);
    }
  }
  return set;
}

function stepTo(row, col) {
  const prev = chain[chain.length - 1];
  chain.push({ row, col });
  busy = true;
  clearHighlights();
  animateStep(prev, { row, col }, () => {
    const done = candidates().find((m) => m.path.length === chain.length);
    if (done) {
      commitMove(done);
    } else {
      // Forced to keep jumping with this piece — the engine only lists
      // complete chains, so an unfinished path always has continuations.
      busy = false;
      forcedChip.textContent = '⚡ KEEP JUMPING';
      forcedChip.classList.remove('hidden');
      announcerEl.textContent = `Capture continues from ${squareName({ row, col })}. Keep jumping.`;
      showTargets();
    }
  });
}

/* ------------------------------------------------------------- bot */

function scheduleBotMove() {
  busy = true;
  renderTurn();
  // A short, human-ish pause — even the Master sips a coffee first.
  const pause = 400 + Math.random() * 450;
  botTimer = later(pause, () => {
    const move = chooseMove(state, mode);
    playBotSteps(move, 0);
  });
}

function playBotSteps(move, i) {
  if (i + 1 >= move.path.length) {
    commitMove(move);
    return;
  }
  animateStep(move.path[i], move.path[i + 1], () => playBotSteps(move, i + 1));
}

/* ------------------------------------------------------------- moving pieces */

// Slide the piece one square (a jump zaps the checker it vaulted), then call
// onDone once the little animation has landed.
function animateStep(from, to, onDone) {
  const el = pieceEls.get(`${from.row},${from.col}`);
  pieceEls.delete(`${from.row},${from.col}`);
  pieceEls.set(`${to.row},${to.col}`, el);
  el.classList.add('selected');
  positionEl(el, to.row, to.col);

  const jumped = Math.abs(to.row - from.row) === 2;
  if (jumped) {
    const capKey = `${(from.row + to.row) / 2},${(from.col + to.col) / 2}`;
    const victim = pieceEls.get(capKey);
    pieceEls.delete(capKey);
    if (victim) {
      victim.classList.add('zapped');
      later(350, () => victim.remove());
    }
    sound.capture();
  } else {
    sound.step();
  }
  later(STEP_MS + 40, onDone);
}

// The one place the engine's state actually advances.
function commitMove(move) {
  const mover = state.turn;
  state = applyMove(state, move);
  refreshSquareLabels();

  // Crowned? The engine decides; the UI just notices the new king.
  const dest = move.path[move.path.length - 1];
  const destCell = state.grid[dest.row][dest.col];
  const el = pieceEls.get(`${dest.row},${dest.col}`);
  if (el && isKing(destCell) && !el.classList.contains('king')) {
    el.classList.add('king');
    sound.crown();
  }
  if (el) el.classList.remove('selected');

  const status = getStatus(state);
  busy = false;
  if (status.over) {
    finishGame(status, mover);
  } else {
    startTurn();
  }
  announceMove(move, mover, status);
}

/* ------------------------------------------------------------- rendering */

function positionEl(el, row, col) {
  el.style.left = `${col * 12.5}%`;
  el.style.top = `${(SIZE - 1 - row) * 12.5}%`; // engine row 0 is the bottom
}

function squareName(point) {
  return `${'abcdefgh'[point.col]}${point.row + 1}`;
}

function pieceName(cell) {
  const owner = ownerOf(cell);
  if (owner === 0) return 'empty';
  return `${owner === RED ? 'red' : 'black'} ${isKing(cell) ? 'king' : 'checker'}`;
}

function refreshSquareLabels() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      cellEls.get(`${r},${c}`).setAttribute('aria-label', `${squareName({ row: r, col: c })}, ${pieceName(state.grid[r][c])}`);
    }
  }
}

function syncPieces() {
  piecesEl.innerHTML = '';
  pieceEls.clear();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = state.grid[r][c];
      if (ownerOf(cell) === 0) continue;
      const el = document.createElement('div');
      el.className = `piece ${ownerOf(cell) === RED ? 'red' : 'black'}${isKing(cell) ? ' king' : ''}`;
      positionEl(el, r, c);
      piecesEl.appendChild(el);
      pieceEls.set(`${r},${c}`, el);
    }
  }
  refreshSquareLabels();
}

function announceMove(move, mover, status) {
  const path = move.path.map(squareName).join(' to ');
  const verb = move.captures.length > 0 ? 'captures' : 'moves';
  let announcement = `${mover === RED ? 'Red' : 'Black'} ${verb} ${path}.`;
  if (!status.over && moves.length > 0 && moves[0].captures.length > 0) {
    announcement += ` Forced capture for ${state.turn === RED ? 'Red' : 'Black'}.`;
  }
  announcerEl.textContent = announcement;
}

function clearHighlights() {
  for (const cell of cellEls.values()) cell.classList.remove('target', 'capture-hop', 'from');
  for (const el of pieceEls.values()) el.classList.remove('must', 'selected');
}

// Glow every checker that has a mandatory jump waiting.
function markForced() {
  const forced = moves.length > 0 && moves[0].captures.length > 0;
  const humanUp = !isBotsTurn();
  forcedChip.textContent = '⚡ JUMP’S FORCED';
  forcedChip.classList.toggle('hidden', !(forced && humanUp && !over));
  if (forced && humanUp) {
    for (const m of moves) {
      const el = pieceEls.get(`${m.path[0].row},${m.path[0].col}`);
      if (el) el.classList.add('must');
    }
  }
}

function showTargets() {
  clearHighlights();
  const sel = chain[chain.length - 1];
  const el = pieceEls.get(`${sel.row},${sel.col}`);
  if (el) el.classList.add('selected');
  cellEls.get(`${sel.row},${sel.col}`).classList.add('from');
  const capturing = candidates().some((m) => m.captures.length > 0);
  for (const key of nextSquares()) {
    const cell = cellEls.get(key);
    cell.classList.add('target');
    if (capturing) cell.classList.add('capture-hop');
  }
}

function renderTurn() {
  if (over) {
    turnChip.className = '';
    turnChip.textContent = '';
    forcedChip.classList.add('hidden');
    return;
  }
  const red = state.turn === RED;
  turnChip.className = red ? 'red' : 'black';
  if (mode === 'pass') {
    turnChip.textContent = red ? 'RED’S MOVE' : 'BLACK’S MOVE';
  } else if (red) {
    turnChip.textContent = 'YOUR MOVE';
  } else {
    turnChip.textContent = THINKING[mode];
    turnChip.classList.add('thinking');
  }
  markForced();
}

function renderTally() {
  if (mode === 'pass') {
    tallyEl.innerHTML =
      `<span class="t-red">RED ${tally.red}</span> — ` +
      `<span class="t-black">${tally.black} BLACK</span>`;
  } else {
    tallyEl.innerHTML =
      `<span class="t-red">YOU ${tally.red}</span> — ` +
      `<span class="t-black">${tally.black} ${BOT_NAMES[mode]}</span>`;
  }
}

/* ------------------------------------------------------------- endgame */

function finishGame(status, lastMover) {
  over = true;
  clearTimeout(botTimer);
  cellsEl.classList.add('disabled');
  clearHighlights();
  renderTurn();
  boardEl.classList.add('showdown');
  for (const [key, el] of pieceEls) {
    const [r, c] = key.split(',').map(Number);
    if (ownerOf(state.grid[r][c]) !== status.winner) el.classList.add('dimmed');
  }

  const gridlock = status.reason === 'blocked' ? 'GRIDLOCK! ' : '';
  let text = '';
  let cls = '';
  if (status.winner === RED) {
    tally.red++;
    cls = 'red-win';
    text = gridlock + (mode === 'pass' ? 'RED RUNS THE BRICKS!' : 'YOU RUN THE BRICKS!');
    sound.win();
    celebrate();
  } else {
    tally.black++;
    cls = 'black-win';
    if (mode === 'pass') {
      text = gridlock + 'BLACK RUNS THE BRICKS!';
      sound.win();
      celebrate();
    } else {
      text = gridlock + BOT_WIN_LINES[mode];
      sound.lose();
    }
  }
  void lastMover; // the winner is always the side that just moved

  renderTally();
  resultText.textContent = text;
  resultText.className = cls;
  // Let the final position sink in for a beat before the banner lands.
  later(650, () => {
    resultBar.classList.remove('hidden');
    endCreditEl.classList.remove('hidden');
  });
}

function celebrate() {
  cheerBubble.textContent = CHEER_LINES[Math.floor(Math.random() * CHEER_LINES.length)];
  // Re-trigger the pop-up animation even on back-to-back wins.
  cheerEl.classList.add('hidden');
  void cheerEl.offsetWidth;
  cheerEl.classList.remove('hidden');
}
