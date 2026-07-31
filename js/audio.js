// CHURCH STREET CHECKERS — tiny procedural WebAudio sounds. No audio files.
// Everything is synthesized: a brick-tap when a piece slides, a two-note
// gulp for a capture, a little fanfare when a King is crowned.

const LS_MUTED = 'church-street-checkers-muted';

let ctx = null;
let muted = localStorage.getItem(LS_MUTED) === '1';

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', gain = 0.16, slide = 0 } = {}) {
  const a = ac();
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export const sound = {
  get muted() {
    return muted;
  },
  toggleMuted() {
    muted = !muted;
    localStorage.setItem(LS_MUTED, muted ? '1' : '0');
    return muted;
  },
  /** A checker settles on the bricks. */
  step() {
    if (muted) return;
    tone(210, 0, 0.07, { type: 'triangle', gain: 0.16, slide: -70 });
    tone(560, 0, 0.03, { type: 'sine', gain: 0.05 });
  },
  /** A piece gets jumped — each hop in a combo climbs a little higher. */
  capture(hop = 1) {
    if (muted) return;
    const lift = Math.min(Math.max(hop - 1, 0), 4) * 65;
    tone(330 + lift, 0, 0.09, { type: 'square', gain: 0.09, slide: -100 });
    tone(180 + lift, 0.07, 0.13, { type: 'triangle', gain: 0.16, slide: -70 });
  },
  /** King me! */
  crown() {
    if (muted) return;
    [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.2, { type: 'triangle', gain: 0.15 }));
    tone(1047, 0.27, 0.34, { type: 'triangle', gain: 0.12 });
  },
  win() {
    if (muted) return;
    [392, 494, 587, 784].forEach((f, i) => tone(f, i * 0.11, 0.24, { type: 'triangle', gain: 0.18 }));
    tone(784, 0.44, 0.5, { type: 'triangle', gain: 0.14 });
  },
  lose() {
    if (muted) return;
    [330, 262, 196].forEach((f, i) => tone(f, i * 0.14, 0.26, { type: 'triangle', gain: 0.15 }));
  },
};
