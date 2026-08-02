// CHURCH STREET CHECKERS — UI only. A Btown Games production for the BTown Brief.
//
// This file renders state, animates checkers over the bricks, and dispatches
// moves. Every rule lives in js/engine.js and every bot decision in
// js/bot.js — if you're tempted to check whether a jump is legal here, stop
// and ask legalMoves() instead.

import {
  SIZE, RED, BLACK, ownerOf, isKing, isDark, opponentOf, countPieces,
  createInitialState, legalMoves, applyMove, getStatus,
} from './engine.js';
import { chooseMove } from './bot.js';
import { sound } from './audio.js';
import { OnlineMatch, savedSession, clearSession, getName } from './rooms.js';

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
const momentBanner = $('momentBanner');
const effectLayer = $('effectLayer');
const redMaterial = $('redMaterial');
const blackMaterial = $('blackMaterial');
const redCount = $('redCount');
const blackCount = $('blackCount');
const redTray = $('redTray');
const blackTray = $('blackTray');
const endCreditEl = $('creditEnd');
const menuBtn = $('menuBtn');
const rematchBtn = $('rematchBtn');
const onlinePanel = $('onlinePanel');
const opTitle = $('opTitle');
const opName = $('opName');
const opCodeWrap = $('opCodeWrap');
const opCode = $('opCode');
const opError = $('opError');
const lobbyEl = $('lobby');
const lobbyCode = $('lobbyCode');
const rejoinBtn = $('rejoinBtn');

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
const BOT_GLOAT_LINES = {
  stroller: [
    'Creemee break — then best two out of three?',
    'A lucky stroll down the bricks!',
    'Scoop says that one was delicious.',
  ],
  master: [
    'The Master tips his hat. Rematch?',
    'Every brick has a lesson.',
    'The table remains under new management.',
  ],
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

let mode = 'pass'; // 'pass' | 'stroller' | 'master' | 'online'
let state = createInitialState();
let moves = []; // legal moves for the side to move, refreshed each turn
let busy = false; // an animation or bot think is in flight
let botTimer = 0;
let session = 0; // bumped on every new game / exit, cancels stale timers
let tally = { red: 0, black: 0 };
let over = false;
let online = null; // { match, myPlayer } while at an online table
let onlinePushPending = false;
let resultRecorded = false;
let liveCounts = { red: 12, black: 12 };
let momentTimer = 0;
let nudgeTimer = 0;
let crownBeatTimer = 0;
const countBumpTimers = { red: 0, black: 0 };
const effectNodes = new Set();
let remoteEffectsReady = !document.hidden;
let visibilityTimer = 0;

document.addEventListener('visibilitychange', () => {
  clearTimeout(visibilityTimer);
  remoteEffectsReady = false;
  if (!document.hidden) {
    visibilityTimer = setTimeout(() => {
      remoteEffectsReady = true;
    }, 750);
  }
});

// Step-by-step move picking: `chain` is the squares tapped so far (the
// selected piece first). Complete paths always come from the engine's move
// list — the UI never invents its own.
let chain = [];

// Piece elements, keyed by "row,col" in engine coordinates.
const pieceEls = new Map();

// Build the 64 brick-and-paver cells once. DOM order is display order:
// top row first, and engine row 0 (red's back rank) is the bottom.
const cellEls = new Map();
const cellPos = new Map(); // reverse lookup for the square under a pointer
for (let dispRow = 0; dispRow < SIZE; dispRow++) {
  for (let col = 0; col < SIZE; col++) {
    const row = SIZE - 1 - dispRow;
    const cell = document.createElement('button');
    cell.className = isDark(row, col) ? 'dark' : 'light';
    cell.addEventListener('click', () => onCellTap(row, col));
    cell.addEventListener('pointerdown', (e) => onCellPointerDown(row, col, e));
    cellsEl.appendChild(cell);
    cellEls.set(`${row},${col}`, cell);
    cellPos.set(cell, { row, col });
  }
}

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => startMatch(btn.dataset.mode));
});
menuBtn.addEventListener('click', backToBlock);
rematchBtn.addEventListener('click', rematch);
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
  if (online) {
    // Leaving mid-game ends the table for both phones — ask for a second tap.
    if (menuBtn.dataset.armed !== '1') {
      menuBtn.dataset.armed = '1';
      menuBtn.textContent = '⬅ LEAVE TABLE?';
      setTimeout(() => {
        menuBtn.dataset.armed = '';
        menuBtn.textContent = '⬅ THE BLOCK';
      }, 2500);
      return;
    }
    online.match.leave(); // fire and forget; stops polling + clears session
    online = null;
    onlinePushPending = false;
    menuBtn.dataset.armed = '';
    menuBtn.textContent = '⬅ THE BLOCK';
  }
  session++;
  clearTimeout(botTimer);
  clearTimeout(flipTimer);
  flipping = false;
  cancelDrag();
  clearEffects();
  busy = false;
  gameEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
  refreshRejoin();
}

function rematch() {
  if (online) {
    onlineRematch();
  } else {
    newGame();
  }
}

function newGame() {
  session++;
  clearTimeout(botTimer);
  clearTimeout(flipTimer);
  flipping = false;
  cancelDrag();
  state = createInitialState(); // red opens every game
  over = false;
  resultRecorded = false;
  busy = false;
  chain = [];
  clearEffects();
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
  return mode !== 'pass' && mode !== 'online' && !over && state.turn === BLACK;
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

// A checker grabbed while the board spins would run away from the pointer.
const FLIP_MS = reducedMotion ? 0 : 620;
let flipping = false;
let flipTimer = 0;

function orientBoard() {
  // Pass & play: the board spins so the mover always plays "up" the street.
  // Online: this phone has one fixed seat, so black stays flipped all game.
  const flip = mode === 'online'
    ? online.myPlayer === BLACK
    : mode === 'pass' && !over && state.turn === BLACK;
  if (sceneEl.classList.contains('flipped') === flip) return;
  sceneEl.classList.toggle('flipped', flip);
  if (!FLIP_MS) return;
  flipping = true;
  markMovable();
  clearTimeout(flipTimer);
  flipTimer = setTimeout(() => {
    flipping = false;
    markMovable();
  }, FLIP_MS);
}

function onCellTap(row, col) {
  if (busy || over || isBotsTurn()) return;
  if (online && (
    onlinePushPending ||
    state.turn !== online.myPlayer ||
    online.match.status !== 'playing'
  )) return;

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

/* ------------------------------------------------------------- dragging */

// A press becomes a drag only after moving far enough that it is clearly not
// a tap. Drop lookup uses the actual cell under the pointer, so the same code
// works when pass & play has rotated the board.
const DRAG_SLOP = 6;
let drag = null;
let hoverCell = null;

function canDragFrom(row, col) {
  if (busy || over || flipping || isBotsTurn()) return false;
  if (online && (
    onlinePushPending ||
    state.turn !== online.myPlayer ||
    online.match.status !== 'playing'
  )) return false;
  if (chain.length > 1) {
    const current = chain[chain.length - 1];
    return current.row === row && current.col === col;
  }
  return moves.some((m) => m.path[0].row === row && m.path[0].col === col);
}

function cellUnder(x, y) {
  return cellPos.get(document.elementFromPoint(x, y)) || null;
}

function onCellPointerDown(row, col, event) {
  if (event.button > 0) return;
  if (drag) cancelDrag();
  if (!canDragFrom(row, col)) return;
  const el = pieceEls.get(`${row},${col}`);
  if (!el) return;
  drag = {
    id: event.pointerId,
    el,
    from: { row, col },
    x: event.clientX,
    y: event.clientY,
    moved: false,
  };
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragEnd);
}

function onDragMove(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < DRAG_SLOP) return;
    drag.moved = true;
    if (chain.length <= 1) chain = [drag.from];
    showTargets();
    drag.el.classList.add('dragging');
  }
  const direction = sceneEl.classList.contains('flipped') ? -1 : 1;
  drag.el.style.setProperty('--dx', `${dx * direction}px`);
  drag.el.style.setProperty('--dy', `${dy * direction}px`);
  setHover(cellUnder(event.clientX, event.clientY));
}

function onDragEnd(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const finished = drag;
  endDrag();
  if (!finished.moved) return;
  const to = event.type === 'pointerup'
    ? cellUnder(event.clientX, event.clientY)
    : null;
  if (to && nextSquares().has(`${to.row},${to.col}`)) {
    finished.el.style.transition = 'none';
    finished.el.classList.remove('dragging');
    clearDragOffset(finished.el);
    void finished.el.offsetWidth;
    finished.el.style.transition = '';
    stepTo(to.row, to.col);
  } else {
    finished.el.classList.remove('dragging');
    finished.el.classList.add('snapback');
    clearDragOffset(finished.el);
    later(220, () => finished.el.classList.remove('snapback'));
  }
}

function clearDragOffset(el) {
  el.style.removeProperty('--dx');
  el.style.removeProperty('--dy');
}

function cancelDrag() {
  if (!drag) return;
  const el = drag.el;
  endDrag();
  el.classList.remove('dragging', 'snapback');
  clearDragOffset(el);
}

function endDrag() {
  setHover(null);
  drag = null;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragEnd);
}

function setHover(pos) {
  const next = pos && nextSquares().has(`${pos.row},${pos.col}`)
    ? cellEls.get(`${pos.row},${pos.col}`)
    : null;
  if (next === hoverCell) return;
  if (hoverCell) hoverCell.classList.remove('drop');
  if (next) next.classList.add('drop');
  hoverCell = next;
}

function markMovable() {
  for (const [key, cell] of cellEls) {
    const [row, col] = key.split(',').map(Number);
    cell.classList.toggle('movable', pieceEls.has(key) && canDragFrom(row, col));
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
  const done = candidates().find((m) => m.path.length === chain.length);
  const hopIndex = chain.length - 1;
  busy = true;
  clearHighlights();
  animateStep(prev, { row, col }, {
    hopIndex,
    finalHop: Boolean(done),
  }, () => {
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
  const hopIndex = move.captures.length > 0 ? i + 1 : 0;
  animateStep(move.path[i], move.path[i + 1], {
    hopIndex,
    finalHop: i + 2 === move.path.length,
  }, () => playBotSteps(move, i + 1));
}

/* ------------------------------------------------------------- moving pieces */

// Slide the piece one square (a jump zaps the checker it vaulted), then call
// onDone once the little animation has landed.
function animateStep(from, to, { hopIndex = 0, finalHop = false }, onDone) {
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
      const victimPlayer = victim.classList.contains('red') ? RED : BLACK;
      const flew = flyCapturedPiece(victim.getBoundingClientRect(), victimPlayer);
      liveCounts[victimPlayer === RED ? 'red' : 'black']--;
      renderMaterial(victimPlayer);
      victim.classList.add(flew ? 'flown' : 'zapped');
      later(350, () => victim.remove());
    }
    sound.capture(hopIndex);
    if (hopIndex >= 2) showCombo(hopIndex, finalHop);
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
  let crowned = false;
  if (el && isKing(destCell) && !el.classList.contains('king')) {
    crowned = true;
    el.classList.add('king');
    sound.crown();
    showCrowning(dest);
  }
  if (el) el.classList.remove('selected');

  const status = getStatus(state);
  if (online) void pushOnline();
  busy = false;
  if (status.over) {
    finishGame(status, mover);
  } else {
    startTurn();
  }
  announceMove(move, mover, status, crowned);
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
  syncMaterial();
  refreshSquareLabels();
}

function announceMove(move, mover, status, crowned = false) {
  const path = move.path.map(squareName).join(' to ');
  const verb = move.captures.length > 0 ? 'captures' : 'moves';
  let announcement = `${mover === RED ? 'Red' : 'Black'} ${verb} ${path}.`;
  if (move.captures.length > 1) {
    announcement += ` ${comboLabel(move.captures.length).replace(/!$/, '').toLowerCase()}.`;
  }
  if (crowned) announcement += ' Kinged.';
  if (move.captures.length > 0) {
    const victim = opponentOf(mover);
    const remaining = liveCounts[victim === RED ? 'red' : 'black'];
    announcement += ` ${victim === RED ? 'Red' : 'Black'} has ${remaining} ${remaining === 1 ? 'piece' : 'pieces'} left.`;
  }
  if (!status.over && moves.length > 0 && moves[0].captures.length > 0) {
    announcement += ` Forced capture for ${state.turn === RED ? 'Red' : 'Black'}.`;
  }
  announcerEl.textContent = announcement;
}

function syncMaterial() {
  liveCounts = {
    red: countPieces(state, RED),
    black: countPieces(state, BLACK),
  };
  renderMaterial();
}

function renderMaterial(bumpPlayer = 0) {
  const redCaptured = 12 - liveCounts.red;
  const blackCaptured = 12 - liveCounts.black;
  redCount.textContent = liveCounts.red;
  blackCount.textContent = liveCounts.black;
  redMaterial.setAttribute('aria-label', `Red: ${liveCounts.red} pieces remaining, ${redCaptured} captured`);
  blackMaterial.setAttribute('aria-label', `Black: ${liveCounts.black} pieces remaining, ${blackCaptured} captured`);
  redTray.innerHTML = '<i class="tray-piece red"></i>'.repeat(Math.max(0, redCaptured));
  blackTray.innerHTML = '<i class="tray-piece black"></i>'.repeat(Math.max(0, blackCaptured));

  if (!bumpPlayer) return;
  const key = bumpPlayer === RED ? 'red' : 'black';
  const countEl = bumpPlayer === RED ? redCount : blackCount;
  clearTimeout(countBumpTimers[key]);
  countEl.classList.remove('bump');
  void countEl.offsetWidth;
  countEl.classList.add('bump');
  countBumpTimers[key] = later(280, () => countEl.classList.remove('bump'));
}

function flyCapturedPiece(fromRect, victimPlayer) {
  if (reducedMotion) return false;
  const tray = victimPlayer === RED ? redTray : blackTray;
  const target = tray.getBoundingClientRect();
  const fly = document.createElement('div');
  fly.className = `capture-fly ${victimPlayer === RED ? 'red' : 'black'}`;
  fly.style.left = `${fromRect.left}px`;
  fly.style.top = `${fromRect.top}px`;
  fly.style.width = `${fromRect.width}px`;
  fly.style.height = `${fromRect.height}px`;
  document.body.appendChild(fly);
  effectNodes.add(fly);
  if (typeof fly.animate !== 'function') {
    effectNodes.delete(fly);
    fly.remove();
    return false;
  }

  const dx = target.left + target.width / 2 - (fromRect.left + fromRect.width / 2);
  const dy = target.top + target.height / 2 - (fromRect.top + fromRect.height / 2);
  const flight = fly.animate([
    { transform: 'translate(0, 0) scale(1) rotate(0)', opacity: 1 },
    { transform: `translate(${dx}px, ${dy}px) scale(.32) rotate(150deg)`, opacity: 0.9 },
  ], {
    duration: 420,
    easing: 'cubic-bezier(.2,.8,.3,1)',
    fill: 'forwards',
  });
  const remove = () => {
    effectNodes.delete(fly);
    fly.remove();
  };
  flight.onfinish = remove;
  flight.oncancel = remove;
  return true;
}

function comboLabel(hopIndex) {
  if (hopIndex === 2) return 'DOUBLE JUMP!';
  if (hopIndex === 3) return 'TRIPLE JUMP!';
  return `${hopIndex}× JUMP!`;
}

function showCombo(hopIndex, finalHop) {
  showMoment(comboLabel(hopIndex), 'combo', 760);
  if (!finalHop || reducedMotion) return;
  clearTimeout(nudgeTimer);
  boardEl.classList.remove('combo-nudge');
  void boardEl.offsetWidth;
  boardEl.classList.add('combo-nudge');
  nudgeTimer = later(260, () => boardEl.classList.remove('combo-nudge'));
}

function showCrowning(point) {
  showMoment('👑 KINGED!', 'crown', 1100);
  crownBurst(point);
  if (reducedMotion) return;
  clearTimeout(crownBeatTimer);
  boardEl.classList.remove('crown-beat');
  void boardEl.offsetWidth;
  boardEl.classList.add('crown-beat');
  crownBeatTimer = later(650, () => boardEl.classList.remove('crown-beat'));
}

function showMoment(text, kind, duration) {
  clearTimeout(momentTimer);
  momentBanner.textContent = text;
  momentBanner.className = `moment-banner ${kind}`;
  void momentBanner.offsetWidth;
  momentTimer = later(duration, () => momentBanner.classList.add('hidden'));
}

function crownBurst(point) {
  const burst = document.createElement('div');
  burst.className = 'crown-burst';
  burst.style.left = `${(point.col + 0.5) * 12.5}%`;
  burst.style.top = `${(SIZE - 1 - point.row + 0.5) * 12.5}%`;
  for (let i = 0; i < 16; i++) {
    const spark = document.createElement('i');
    const angle = (Math.PI * 2 * i) / 16;
    const distance = 34 + (i % 3) * 8;
    spark.style.setProperty('--spark-x', `${Math.cos(angle) * distance}px`);
    spark.style.setProperty('--spark-y', `${Math.sin(angle) * distance}px`);
    spark.style.setProperty('--spark-delay', `${(i % 4) * 18}ms`);
    burst.appendChild(spark);
  }
  effectLayer.appendChild(burst);
  effectNodes.add(burst);
  later(850, () => {
    effectNodes.delete(burst);
    burst.remove();
  });
}

function clearEffects() {
  clearTimeout(momentTimer);
  clearTimeout(nudgeTimer);
  clearTimeout(crownBeatTimer);
  clearTimeout(countBumpTimers.red);
  clearTimeout(countBumpTimers.black);
  momentBanner.className = 'hidden';
  boardEl.classList.remove('combo-nudge', 'crown-beat');
  redCount.classList.remove('bump');
  blackCount.classList.remove('bump');
  for (const node of effectNodes) node.remove();
  effectNodes.clear();
}

function clearHighlights() {
  hoverCell = null;
  for (const cell of cellEls.values()) cell.classList.remove('target', 'capture-hop', 'from', 'drop');
  for (const el of pieceEls.values()) el.classList.remove('must', 'selected');
}

// Glow every checker that has a mandatory jump waiting.
function markForced() {
  const forced = moves.length > 0 && moves[0].captures.length > 0;
  const humanUp = !isBotsTurn() && (!online || (
    state.turn === online.myPlayer &&
    online.match.status === 'playing' &&
    !onlinePushPending
  ));
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
  markMovable();
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
    markMovable();
    return;
  }
  const red = state.turn === RED;
  turnChip.className = red ? 'red' : 'black';
  if (mode === 'pass') {
    turnChip.textContent = red ? 'RED’S MOVE' : 'BLACK’S MOVE';
  } else if (mode === 'online') {
    if (state.turn === online.myPlayer && online.match.status === 'playing') {
      turnChip.textContent = onlinePushPending ? 'SENDING YOUR MOVE…' : 'YOUR MOVE';
      if (onlinePushPending) turnChip.classList.add('thinking');
    } else {
      const opp = online.match.opponents()[0] || {};
      turnChip.textContent = opp.away
        ? `${(opp.name || 'YOUR PAL').toUpperCase()} STEPPED AWAY…`
        : `WAITING ON ${(opp.name || 'YOUR PAL').toUpperCase()}…`;
      turnChip.classList.add('thinking');
    }
  } else if (red) {
    turnChip.textContent = 'YOUR MOVE';
  } else {
    turnChip.textContent = THINKING[mode];
    turnChip.classList.add('thinking');
  }
  markForced();
  markMovable();
}

function renderTally() {
  if (mode === 'pass') {
    tallyEl.innerHTML =
      `<span class="t-red">RED ${tally.red}</span> — ` +
      `<span class="t-black">${tally.black} BLACK</span>`;
  } else if (mode === 'online') {
    const opp = online.match.opponents()[0] || {};
    const mine = online.myPlayer === RED ? 'red' : 'black';
    const theirs = online.myPlayer === RED ? 'black' : 'red';
    tallyEl.innerHTML =
      `<span class="t-${mine}">YOU ${tally[mine]}</span> — ` +
      `<span class="t-${theirs}">${tally[theirs]} ${esc((opp.name || 'PAL').toUpperCase())}</span>`;
  } else {
    tallyEl.innerHTML =
      `<span class="t-red">YOU ${tally.red}</span> — ` +
      `<span class="t-black">${tally.black} ${BOT_NAMES[mode]}</span>`;
  }
}

// Opponent names come from the network — never let them into innerHTML raw.
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/* ------------------------------------------------------------- endgame */

function finishGame(status, lastMover, { effects = true } = {}) {
  over = true;
  clearTimeout(botTimer);
  cancelDrag();
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
  if (mode === 'online') {
    const opp = online.match.opponents()[0] || {};
    const winnerKey = status.winner === RED ? 'red' : 'black';
    const iWon = status.winner === online.myPlayer;
    if (!resultRecorded) tally[winnerKey]++;
    cls = status.winner === RED ? 'red-win' : 'black-win';
    if (iWon) {
      text = gridlock + 'YOU RUN THE BRICKS!';
      if (effects) {
        sound.win();
        celebrate();
      }
    } else {
      text = gridlock + `${(opp.name || 'YOUR PAL').toUpperCase()} RUNS THE BRICKS`;
      if (effects) sound.lose();
    }
  } else if (status.winner === RED) {
    if (!resultRecorded) tally.red++;
    cls = 'red-win';
    text = gridlock + (mode === 'pass' ? 'RED RUNS THE BRICKS!' : 'YOU RUN THE BRICKS!');
    if (effects) {
      sound.win();
      celebrate();
    }
  } else {
    if (!resultRecorded) tally.black++;
    cls = 'black-win';
    if (mode === 'pass') {
      text = gridlock + 'BLACK RUNS THE BRICKS!';
      if (effects) {
        sound.win();
        celebrate();
      }
    } else {
      text = gridlock + BOT_WIN_LINES[mode];
      if (effects) {
        sound.lose();
        celebrate(BOT_GLOAT_LINES[mode]);
      }
    }
  }
  resultRecorded = true;
  void lastMover; // the winner is always the side that just moved

  renderTally();
  resultText.textContent = text;
  resultText.className = cls;
  // Let the final position sink in for a beat before the banner lands.
  later(effects ? 650 : 0, () => {
    resultBar.classList.remove('hidden');
    endCreditEl.classList.remove('hidden');
  });
}

function celebrate(lines = CHEER_LINES) {
  cheerBubble.textContent = lines[Math.floor(Math.random() * lines.length)];
  // Re-trigger the pop-up animation even on back-to-back wins.
  cheerEl.classList.add('hidden');
  void cheerEl.offsetWidth;
  cheerEl.classList.remove('hidden');
}

/* ------------------------------------------------------------- online play */
// Two phones, one shared engine state, refereed by the rooms layer
// (js/rooms.js → Supabase). Host sits in seat 0 and plays red; the friend
// who joins with the 4-letter code is black. Every rule still lives in
// engine.js — this section only ferries state and repaints what arrives.

const GAME = 'church-street-checkers';
let panelIntent = 'host';
let pollErrors = 0;

$('hostBtn').addEventListener('click', () => openPanel('host'));
$('joinBtn').addEventListener('click', () => openPanel('join'));
$('opCancel').addEventListener('click', closePanel);
$('opGo').addEventListener('click', onlineGo);
$('lobbyCancel').addEventListener('click', cancelLobby);
rejoinBtn.addEventListener('click', rejoinTable);
opCode.addEventListener('input', () => {
  opCode.value = opCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
[opName, opCode].forEach((el) => el.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') onlineGo();
}));

function openPanel(intent) {
  panelIntent = intent;
  opTitle.textContent = intent === 'host' ? 'START A TABLE' : 'JOIN A TABLE';
  $('opGo').textContent = intent === 'host' ? 'GET A CODE' : 'STEP UP';
  opCodeWrap.classList.toggle('hidden', intent === 'host');
  opError.classList.add('hidden');
  opName.value = opName.value || getName();
  onlinePanel.classList.remove('hidden');
  (intent === 'join' && opName.value ? opCode : opName).focus();
}

function closePanel() {
  onlinePanel.classList.add('hidden');
}

const FRIENDLY_ERRORS = {
  not_found: 'No table with that code — double-check the letters.',
  room_full: 'That table already has two players.',
  room_started: 'That game is already moving down the block.',
  not_ready: "Online play isn't switched on yet — check back soon!",
  offline: "Can't reach Church Street — are you online?",
};
function friendly(err) {
  if (err && err.code === 'wrong_game') {
    return `That code is for ${String(err.detail || 'another game').replace(/-/g, ' ')} — head there to use it.`;
  }
  return (err && FRIENDLY_ERRORS[err.code]) || 'Loose brick — please try again.';
}

async function onlineGo() {
  if ($('opGo').disabled) return; // Enter key can't double-submit
  const name = opName.value.trim();
  if (!name) {
    opError.textContent = 'Every player needs a name.';
    opError.classList.remove('hidden');
    opName.focus();
    return;
  }
  const go = $('opGo');
  go.disabled = true;
  opError.classList.add('hidden');
  try {
    if (panelIntent === 'host') {
      const match = await OnlineMatch.create({
        game: GAME, name, state: createInitialState(), seats: 2,
      });
      closePanel();
      openLobby(match);
    } else {
      const code = opCode.value.trim();
      if (code.length !== 4) {
        opError.textContent = 'The table code is 4 letters.';
        opError.classList.remove('hidden');
        opCode.focus();
        return;
      }
      const match = await OnlineMatch.join({ game: GAME, code, name });
      closePanel();
      enterOnlineGame(match);
    }
  } catch (err) {
    opError.textContent = friendly(err);
    opError.classList.remove('hidden');
  } finally {
    go.disabled = false;
  }
}

function openLobby(match) {
  if (lobbyEl._match && lobbyEl._match !== match) lobbyEl._match.stop();
  lobbyCode.textContent = match.code;
  lobbyEl.classList.remove('hidden');
  lobbyEl._match = match;
  match.start({
    onStatus: (status) => {
      if (status === 'playing') {
        lobbyEl.classList.add('hidden');
        lobbyEl._match = null;
        enterOnlineGame(match);
      }
    },
    onError: () => {}, // waiting-room hiccups resolve on the next poll
  });
}

function cancelLobby() {
  const match = lobbyEl._match;
  if (match) match.leave();
  lobbyEl._match = null;
  lobbyEl.classList.add('hidden');
  refreshRejoin();
}

async function rejoinTable() {
  rejoinBtn.disabled = true;
  try {
    const match = await OnlineMatch.resume({ game: GAME });
    if (match.status === 'waiting') {
      openLobby(match);
    } else {
      enterOnlineGame(match);
    }
  } catch (err) {
    // Only a room that's truly gone forfeits the session — a flaky
    // connection must not delete the one path back to the game.
    if (err && (err.code === 'not_found' || err.code === 'not_seated' || err.code === 'room_started')) {
      clearSession(GAME);
      refreshRejoin();
    }
  } finally {
    rejoinBtn.disabled = false;
  }
}

function refreshRejoin() {
  const saved = savedSession(GAME);
  rejoinBtn.classList.toggle('hidden', !saved);
  if (saved) rejoinBtn.textContent = `↩ REJOIN YOUR TABLE (${saved.code})`;
}

function enterOnlineGame(match) {
  clearTimeout(botTimer);
  mode = 'online';
  online = { match, myPlayer: match.seat === 0 ? RED : BLACK };
  onlinePushPending = false;
  tally = { red: 0, black: 0 };
  resultRecorded = false;
  pollErrors = 0;
  state = match.state;
  menuEl.classList.add('hidden');
  onlinePanel.classList.add('hidden');
  lobbyEl.classList.add('hidden');
  lobbyEl._match = null;
  gameEl.classList.remove('hidden');
  rebuildBoard();
  match.start({
    onState: onRemoteState,
    onStatus: onRemoteStatus,
    onPresence: onRemotePresence,
    onError: onPollError,
  });
  // A resumed table may already have been abandoned by the other player.
  if (match.status === 'over' && !getStatus(state).over) onRemoteStatus('over');
}

/** Redraw the whole position from shared state (resume, remote move, conflict). */
function rebuildBoard({ transition = null, previousState = null } = {}) {
  session++; // cancels any local move animation that shared truth superseded
  clearTimeout(botTimer);
  clearTimeout(flipTimer);
  flipping = false;
  cancelDrag();
  clearEffects();
  busy = false;
  chain = [];
  over = false;
  boardEl.classList.remove('showdown');
  cellsEl.classList.remove('disabled');
  resultBar.classList.add('hidden');
  rematchBtn.classList.remove('hidden');
  cheerEl.classList.add('hidden');
  endCreditEl.classList.add('hidden');
  announcerEl.textContent = '';
  syncPieces();
  renderTally();
  const status = getStatus(state);
  if (status.over) {
    finishGame(status, status.winner, { effects: Boolean(transition) && !resultRecorded });
  } else {
    startTurn();
  }
  if (transition && previousState) presentConfirmedMove(transition, previousState, status);
}

function onRemoteState(newState) {
  // Repaint from shared truth, then present only a move we can prove changed
  // the confirmed state. Hydration and duplicate polls stay silent.
  const previousState = state;
  const transition = confirmedMoveBetween(previousState, newState);
  if (!statesMatch(previousState, newState) && statesMatch(createInitialState(), newState)) {
    resultRecorded = false;
  }
  onlinePushPending = false;
  state = newState;
  rebuildBoard({
    transition: remoteEffectsReady && pollErrors === 0 ? transition : null,
    previousState,
  });
}

function confirmedMoveBetween(previousState, nextState) {
  if (!previousState || previousState.turn === nextState.turn) return null;
  for (const move of legalMoves(previousState)) {
    if (statesMatch(applyMove(previousState, move), nextState)) return move;
  }
  return null;
}

function statesMatch(a, b) {
  if (!a || !b || a.turn !== b.turn) return false;
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (a.grid[row][col] !== b.grid[row][col]) return false;
    }
  }
  return true;
}

function presentConfirmedMove(move, previousState, status) {
  const mover = previousState.turn;
  if (move.captures.length > 0) {
    const victim = opponentOf(mover);
    renderMaterial(victim);
    for (const point of move.captures) {
      flyCapturedPiece(cellEls.get(`${point.row},${point.col}`).getBoundingClientRect(), victim);
    }
    sound.capture(move.captures.length);
    if (move.captures.length > 1) showCombo(move.captures.length, true);
  }
  const start = move.path[0];
  const dest = move.path[move.path.length - 1];
  const crowned = !isKing(previousState.grid[start.row][start.col]) &&
    isKing(state.grid[dest.row][dest.col]);
  if (crowned) {
    sound.crown();
    showCrowning(dest);
  }
  announceMove(move, mover, status, crowned);
}

function onRemoteStatus(status) {
  if (status !== 'over') return;
  const opp = online && online.match.opponents()[0];
  if (opp && opp.left && !getStatus(state).over) {
    session++;
    clearTimeout(flipTimer);
    flipping = false;
    cancelDrag();
    clearEffects();
    over = true;
    busy = false;
    onlinePushPending = false;
    cellsEl.classList.add('disabled');
    clearHighlights();
    turnChip.className = '';
    turnChip.textContent = '';
    forcedChip.classList.add('hidden');
    resultText.textContent = `${(opp.name || 'YOUR PAL').toUpperCase()} LEFT THE BLOCK`;
    resultText.className = '';
    rematchBtn.classList.add('hidden');
    resultBar.classList.remove('hidden');
    endCreditEl.classList.remove('hidden');
  }
}

function onRemotePresence(opponents) {
  pollErrors = 0; // this callback only fires on a successful poll
  const opp = opponents[0];
  if (opp && opp.left) rematchBtn.classList.add('hidden');
  if (!busy && pollErrors === 0) {
    renderTally();
    renderTurn();
  }
}

function onPollError(err) {
  if (err && err.code === 'not_found') {
    session++;
    clearTimeout(flipTimer);
    flipping = false;
    cancelDrag();
    clearEffects();
    online.match.stop();
    clearSession(GAME);
    online = null;
    onlinePushPending = false;
    mode = 'pass';
    gameEl.classList.add('hidden');
    menuEl.classList.remove('hidden');
    refreshRejoin();
    return;
  }
  pollErrors++;
  if (pollErrors >= 3 && !getStatus(state).over) {
    turnChip.className = 'thinking';
    turnChip.textContent = 'LOOSE CONNECTION — HANG TIGHT…';
  }
}

async function pushOnline() {
  if (!online) return;
  const active = online;
  const pushedState = state;
  const status = getStatus(pushedState);
  onlinePushPending = true;
  renderTurn();
  try {
    await active.match.push(pushedState, { over: status.over });
    pollErrors = 0;
    onlinePushPending = false;
    if (!over) renderTurn();
  } catch (err) {
    if (err && err.code === 'version_conflict') {
      onlinePushPending = false;
      // push() refetches first; onState usually already repainted this object.
      if (state !== active.match.state) {
        state = active.match.state;
        rebuildBoard();
      }
      return;
    }
    // One calm retry. Input stays gated until the shared room accepts or
    // rejects this exact engine state.
    setTimeout(async () => {
      if (online !== active) return;
      try {
        await active.match.push(pushedState, { over: status.over });
        pollErrors = 0;
      } catch (retryErr) {
        if (retryErr && retryErr.code === 'version_conflict') {
          if (state !== active.match.state) {
            state = active.match.state;
            rebuildBoard();
          }
        } else {
          // The move never reached the room: return to the last shared truth.
          state = active.match.state;
          rebuildBoard();
          onPollError(retryErr);
        }
      } finally {
        if (online === active) {
          onlinePushPending = false;
          if (!over) renderTurn();
        }
      }
    }, 1500);
  }
}

async function onlineRematch() {
  if (!online || rematchBtn.disabled) return;
  const active = online;
  const fresh = createInitialState(); // American checkers: red always opens
  rematchBtn.disabled = true;
  resultRecorded = false;
  state = fresh;
  rebuildBoard();
  try {
    await active.match.push(fresh, {});
    pollErrors = 0;
    renderTurn();
  } catch (err) {
    if (err && err.code === 'version_conflict') {
      // The other phone reset first — its fresh position is the truth.
      if (state !== active.match.state) {
        state = active.match.state;
        rebuildBoard();
      }
    } else {
      state = active.match.state;
      rebuildBoard();
      onPollError(err);
    }
  } finally {
    rematchBtn.disabled = false;
  }
}

refreshRejoin();

/* ------------------------------------------------- crew-link invites */
// Text a link instead of reading letters aloud: ?join=ABCD opens the join
// panel with the code filled in, then scrubs the URL so refreshes don't
// re-trigger it. Canonical pattern: four-in-a-rowboat (ROOMS-INTEGRATION §6).

$('inviteBtn').addEventListener('click', async () => {
  const code = ($('lobbyCode').textContent || '').trim();
  if (!code) return;
  const url = `${location.origin}${location.pathname}?join=${code}`;
  const text = `🔴 Meet me on the bricks — tap to join my Church Street Checkers game: ${url}`;
  try {
    if (navigator.share && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
      await navigator.share({ text });
    } else {
      await navigator.clipboard.writeText(url);
      $('inviteBtn').textContent = '✓ LINK COPIED';
      setTimeout(() => { $('inviteBtn').textContent = '📲 SEND AN INVITE'; }, 1800);
    }
  } catch { /* share sheet closed */ }
});

(() => {
  const code = new URLSearchParams(location.search).get('join');
  if (!code || !/^[A-Za-z0-9]{4}$/.test(code)) return;
  history.replaceState(null, '', location.pathname);
  openPanel('join');
  $('opCode').value = code.toUpperCase();
})();
