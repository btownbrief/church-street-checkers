// Online-rooms wiring test: drives the real vendored client (js/rooms.js)
// against the local shim (scripts/rooms-shim.mjs) as two simulated phones,
// then plays a full online game through the real engine. No network, no
// Supabase — the SQL file has its own referee tests; this proves OUR side.
//
//   node scripts/test-rooms.mjs

import { createRooms } from './rooms-shim.mjs';
import {
  createInitialState, legalMoves, applyMove, getStatus, RED, BLACK,
} from '../js/engine.js';

const GAME = 'church-street-checkers';

/* ------------------------------------------------- two-phone environment */

const stores = new Map();
let current = 'A';
globalThis.localStorage = {
  getItem: (k) => (stores.get(current).has(k) ? stores.get(current).get(k) : null),
  setItem: (k, v) => stores.get(current).set(k, String(v)),
  removeItem: (k) => stores.get(current).delete(k),
};
function device(d) {
  if (!stores.has(d)) stores.set(d, new Map());
  current = d;
}
device('A');
device('B');

let passed = 0;
function t(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ok — ${label}`);
}
async function expectCode(promise, code, label) {
  try {
    await promise;
    t(false, `${label} (no error thrown)`);
  } catch (e) {
    t(e && e.code === code, `${label} (got ${e && e.code})`);
  }
}

const shim = createRooms();
globalThis.BTOWN_ROOMS_URL = 'http://rooms.test';
globalThis.fetch = async (url, options = {}) => {
  const name = String(url).match(/\/rest\/v1\/rpc\/(\w+)$/)?.[1];
  if (!name || !shim.rpcs[name]) {
    return new Response(JSON.stringify({ message: 'not a room rpc' }), { status: 404 });
  }
  try {
    const body = shim.rpcs[name](JSON.parse(options.body || '{}')) ?? {};
    return new Response(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), {
      status: error.rpc ? 400 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
const { OnlineMatch, savedSession } = await import('../js/rooms.js');

/* ------------------------------------------------------------ the tests */

// create + join
device('A');
const host = await OnlineMatch.create({
  game: GAME, name: 'Red Table', state: createInitialState(), seats: 2,
});
t(/^[A-Z2-9]{4}$/.test(host.code) && host.seat === 0 && host.status === 'waiting', 'host creates room, seat 0 (red)');
t(savedSession(GAME)?.roomId === host.roomId, 'host session saved');

device('B');
await expectCode(OnlineMatch.join({ game: GAME, code: 'ZZZZ', name: 'X' }), 'not_found', 'bad code rejected');
await expectCode(OnlineMatch.join({ game: 'four-in-a-rowboat', code: host.code, name: 'X' }), 'wrong_game', 'wrong game rejected');
const guest = await OnlineMatch.join({
  game: GAME, code: ` ${host.code.toLowerCase()} `, name: 'Black Iron',
});
t(guest.seat === 1 && guest.status === 'playing', 'guest joins (sloppy code ok), seat 1 (black), game starts');
t(guest.opponents().length === 1 && guest.opponents()[0].name === 'Red Table', 'guest sees host name');

device('A');
await host._fetch();
t(host.status === 'playing' && host.opponents()[0].name === 'Black Iron', 'host poll sees game start');

// referee: push, sync, conflict
const firstMove = legalMoves(host.state)[0];
const sA = applyMove(host.state, firstMove);
await host.push(sA);
t(host.version === 1 && sA.turn === BLACK, 'host pushes red move, version 1');

device('B');
await guest._fetch();
t(JSON.stringify(guest.state) === JSON.stringify(sA), 'guest poll receives red move');
const secondMove = legalMoves(guest.state)[0];
await guest.push(applyMove(guest.state, secondMove));
t(guest.version === 2 && guest.state.turn === RED, 'guest pushes black reply, version 2');

device('A');
const staleState = applyMove(sA, legalMoves(sA)[0]);
await expectCode(host.push(staleState), 'version_conflict', 'stale push rejected');
t(host.version === 2 && JSON.stringify(host.state) === JSON.stringify(guest.state), 'conflict refetches the truth');

// Full random game through the engine. A fixed PRNG keeps the run repeatable.
let seed = 1;
function randomIndex(n) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % n;
}

device('A'); await host._fetch();
device('B'); await guest._fetch();
const phones = {
  [RED]: { match: host, device: 'A' },
  [BLACK]: { match: guest, device: 'B' },
};
let plies = 2;
const MAX_PLIES = 400;
while (!getStatus(host.state).over && plies < MAX_PLIES) {
  const mover = phones[host.state.turn];
  device(mover.device);
  await mover.match._fetch();
  const choices = legalMoves(mover.match.state);
  const next = applyMove(mover.match.state, choices[randomIndex(choices.length)]);
  await mover.match.push(next, { over: getStatus(next).over });
  plies++;

  device('A'); await host._fetch();
  device('B'); await guest._fetch();
  if (JSON.stringify(host.state) !== JSON.stringify(guest.state)) {
    console.error(`FAIL: phones diverged after ply ${plies}`);
    process.exit(1);
  }
}

const ended = getStatus(host.state).over;
t(JSON.stringify(host.state) === JSON.stringify(guest.state), 'end states are JSON-identical');
if (ended) {
  t(host.status === 'over' && guest.status === 'over', `full online game ends after ${plies} plies`);
} else {
  t(plies === MAX_PLIES, `random game reaches ${MAX_PLIES}-ply cap with phones still synced`);
}

// rematch: either phone resets a finished room
if (ended) {
  device('B');
  const previousVersion = guest.version;
  await guest.push(createInitialState(), {});
  t(guest.status === 'playing' && guest.version === previousVersion + 1, 'rematch position accepted');
}

// resume after a refresh
device('A');
const resumed = await OnlineMatch.resume({ game: GAME });
t(resumed.roomId === host.roomId && resumed.seat === 0, 'resume reattaches host to seat 0');

// leave: other side sees the flag, session cleared
await resumed.leave();
t(savedSession(GAME) === null, 'leave clears the session');
device('B');
await guest._fetch();
t(guest.status === 'over' && guest.opponents()[0].left === true, 'guest sees host left');

// full room turns a third phone away
device('A');
const h2 = await OnlineMatch.create({ game: GAME, name: 'A', state: createInitialState() });
device('B');
await OnlineMatch.join({ game: GAME, code: h2.code, name: 'B' });
device('C');
await expectCode(OnlineMatch.join({ game: GAME, code: h2.code, name: 'C' }), 'room_started', 'third phone turned away');

// backend not installed → clean 'not_ready'
{
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: 'not installed' }), { status: 404 });
  const fresh = await import('../js/rooms.js?not-ready');
  await expectCode(
    fresh.OnlineMatch.create({ game: GAME, name: 'A', state: {} }),
    'not_ready', 'missing backend reads as not_ready');
}

console.log(`\nALL ROOMS TESTS PASSED (${passed} checks, ${plies} game plies)`);
process.exit(0);
