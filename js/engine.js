// CHURCH STREET CHECKERS — pure American checkers rules. A Btown Games production.
//
// THE ONE NON-NEGOTIABLE: everything in this file is a pure function over a
// plain JSON-serializable state object. No DOM, no timers, no Date, no
// Math.random, no imports. Online multiplayer will later sync this exact
// state object between phones, so any rule logic outside this file breaks
// that plan. The whole game must survive JSON.stringify → JSON.parse → resume.
//
// State shape: { grid, turn }
//   grid — 8 rows × 8 cols; row 0 is RED's back rank (the BOTTOM of the board
//          as red sees it). Cells hold 0 (empty) or a piece code below.
//          Play happens on the dark squares: (row + col) % 2 === 0.
//   turn — whose move it is next, 1 (red) or 2 (black)
//
// A move is { path, captures }:
//   path     — the squares the piece visits, [{ row, col }, ...], start first.
//              A quiet move has 2 entries; a multi-jump has one per landing.
//   captures — the enemy squares jumped over, in order ([] for a quiet move).
//
// The rules encoded here (American checkers, a.k.a. English draughts):
//   · men move one square diagonally forward; kings any diagonal direction
//   · captures jump an adjacent enemy into the empty square beyond
//   · CAPTURES ARE MANDATORY — if any jump exists, quiet moves are illegal
//   · a multi-jump must be continued to its end; when several capture
//     sequences exist the player picks which (longest is NOT required)
//   · a man reaching the far rank is crowned, and crowning ENDS the chain
//   · you lose with no pieces or no legal moves; there is no draw rule

export const SIZE = 8;
export const EMPTY = 0;
export const RED = 1; // player ids — red opens
export const BLACK = 2;
// Cell codes. ownerOf/isKing below decode them.
export const RED_MAN = 1;
export const BLACK_MAN = 2;
export const RED_KING = 3;
export const BLACK_KING = 4;

/** Which player a cell's piece belongs to: RED, BLACK, or 0 for empty. */
export function ownerOf(cell) {
  if (cell === RED_MAN || cell === RED_KING) return RED;
  if (cell === BLACK_MAN || cell === BLACK_KING) return BLACK;
  return 0;
}

export function isKing(cell) {
  return cell === RED_KING || cell === BLACK_KING;
}

export function opponentOf(player) {
  return player === RED ? BLACK : RED;
}

/** True for the brick squares the game is played on. */
export function isDark(row, col) {
  return (row + col) % 2 === 0;
}

/** How many pieces `player` has on the board. */
export function countPieces(state, player) {
  let n = 0;
  for (const rowCells of state.grid) {
    for (const cell of rowCells) if (ownerOf(cell) === player) n++;
  }
  return n;
}

/** A fresh board: 12 men a side on the dark squares. Red opens by default. */
export function createInitialState(firstPlayer = RED) {
  if (firstPlayer !== RED && firstPlayer !== BLACK) {
    throw new Error(`First player must be ${RED} (red) or ${BLACK} (black).`);
  }
  const grid = [];
  for (let r = 0; r < SIZE; r++) {
    const rowCells = [];
    for (let c = 0; c < SIZE; c++) {
      let cell = EMPTY;
      if (isDark(r, c)) {
        if (r <= 2) cell = RED_MAN;
        else if (r >= 5) cell = BLACK_MAN;
      }
      rowCells.push(cell);
    }
    grid.push(rowCells);
  }
  return { grid, turn: firstPlayer };
}

// Diagonal directions a piece may head in. Red men climb toward row 7,
// black men descend toward row 0, kings go anywhere.
function directionsFor(cell) {
  if (isKing(cell)) return [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  return ownerOf(cell) === RED ? [[1, 1], [1, -1]] : [[-1, 1], [-1, -1]];
}

function crowningRow(player) {
  return player === RED ? SIZE - 1 : 0;
}

function onBoard(row, col) {
  return row >= 0 && row < SIZE && col >= 0 && col < SIZE;
}

function cloneGrid(grid) {
  return grid.map((rowCells) => rowCells.slice());
}

/**
 * Every legal move for the side to move. If any capture exists, ONLY captures
 * are returned (they're mandatory), each as a complete jump chain — a chain
 * stops only when no further jump exists or the piece is crowned mid-chain.
 * An empty array means the side to move has lost.
 */
export function legalMoves(state) {
  const { grid, turn } = state;
  const jumps = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (ownerOf(grid[r][c]) === turn) {
        collectJumps(grid, r, c, [{ row: r, col: c }], [], jumps);
      }
    }
  }
  if (jumps.length > 0) return jumps;

  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = grid[r][c];
      if (ownerOf(cell) !== turn) continue;
      for (const [dr, dc] of directionsFor(cell)) {
        const nr = r + dr;
        const nc = c + dc;
        if (onBoard(nr, nc) && grid[nr][nc] === EMPTY) {
          moves.push({ path: [{ row: r, col: c }, { row: nr, col: nc }], captures: [] });
        }
      }
    }
  }
  return moves;
}

// Depth-first search for complete jump chains from (row, col). Jumped pieces
// come off the working grid immediately, so a chain can never take the same
// piece twice or land on a square it already emptied.
function collectJumps(grid, row, col, path, captures, out) {
  const cell = grid[row][col];
  const player = ownerOf(cell);
  const enemy = opponentOf(player);
  let extended = false;
  for (const [dr, dc] of directionsFor(cell)) {
    const midR = row + dr;
    const midC = col + dc;
    const landR = row + 2 * dr;
    const landC = col + 2 * dc;
    if (!onBoard(landR, landC)) continue;
    if (ownerOf(grid[midR][midC]) !== enemy) continue;
    if (grid[landR][landC] !== EMPTY) continue;

    extended = true;
    const nextPath = [...path, { row: landR, col: landC }];
    const nextCaptures = [...captures, { row: midR, col: midC }];
    const crowned = !isKing(cell) && landR === crowningRow(player);
    if (crowned) {
      // Crowning ends the chain immediately — no jumping onward as a new king.
      out.push({ path: nextPath, captures: nextCaptures });
      continue;
    }
    const nextGrid = cloneGrid(grid);
    nextGrid[row][col] = EMPTY;
    nextGrid[midR][midC] = EMPTY;
    nextGrid[landR][landC] = cell;
    const before = out.length;
    collectJumps(nextGrid, landR, landC, nextPath, nextCaptures, out);
    if (out.length === before) {
      // No further jump from the landing square — the chain ends here.
      out.push({ path: nextPath, captures: nextCaptures });
    }
  }
  return extended;
}

function samePath(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((p, i) => p && p.row === b[i].row && p.col === b[i].col);
}

/**
 * Play `move` (matched against legalMoves by its path). Returns a NEW state —
 * the input state is never mutated. Throws if the move is illegal, including
 * a quiet move when a capture exists or a jump chain cut short.
 */
export function applyMove(state, move) {
  if (!move || !Array.isArray(move.path) || move.path.length < 2) {
    throw new Error('A move needs a path of at least two squares.');
  }
  const legal = legalMoves(state);
  const match = legal.find((m) => samePath(m.path, move.path));
  if (!match) {
    if (legal.length === 0) {
      throw new Error('The game is over — no legal moves remain.');
    }
    if (legal[0].captures.length > 0) {
      throw new Error('Captures are mandatory on Church Street — take the jump, and take it all the way.');
    }
    throw new Error('That move is not legal from here.');
  }

  const grid = cloneGrid(state.grid);
  const from = match.path[0];
  const to = match.path[match.path.length - 1];
  const cell = grid[from.row][from.col];
  grid[from.row][from.col] = EMPTY;
  for (const cap of match.captures) grid[cap.row][cap.col] = EMPTY;
  const crowned = !isKing(cell) && to.row === crowningRow(state.turn);
  grid[to.row][to.col] = crowned ? (state.turn === RED ? RED_KING : BLACK_KING) : cell;
  return { grid, turn: opponentOf(state.turn) };
}

/**
 * Where the game stands:
 *   { over, turn, winner, reason }
 *   over   — true once the side to move has no legal moves
 *   turn   — whose move is next (1|2), or null when over
 *   winner — 1|2, or null while play continues
 *   reason — 'captured' (no pieces left) | 'blocked' (pieces but no moves) | null
 */
export function getStatus(state) {
  if (legalMoves(state).length > 0) {
    return { over: false, turn: state.turn, winner: null, reason: null };
  }
  return {
    over: true,
    turn: null,
    winner: opponentOf(state.turn),
    reason: countPieces(state, state.turn) === 0 ? 'captured' : 'blocked',
  };
}
