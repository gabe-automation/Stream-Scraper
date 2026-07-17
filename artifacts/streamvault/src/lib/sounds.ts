/** Discord-style sound effects generated entirely via Web Audio API — no files needed */

let _ctx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext();
  // Resume if suspended (browser autoplay policy)
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}

function tone(
  freq: number,
  startAt: number,
  duration: number,
  volume = 0.25,
  type: OscillatorType = "sine",
  fadeOut = true,
) {
  const c = ctx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain);
  gain.connect(c.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + startAt);
  gain.gain.setValueAtTime(volume, c.currentTime + startAt);
  if (fadeOut) {
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      c.currentTime + startAt + duration,
    );
  }
  osc.start(c.currentTime + startAt);
  osc.stop(c.currentTime + startAt + duration + 0.01);
}

/** Discord-like ascending join chime */
export function playJoinSound() {
  tone(523.25, 0, 0.12, 0.2);   // C5
  tone(659.25, 0.1, 0.12, 0.2); // E5
  tone(783.99, 0.2, 0.25, 0.2); // G5
}

/** Discord-like descending leave chime */
export function playLeaveSound() {
  tone(783.99, 0, 0.12, 0.15);  // G5
  tone(659.25, 0.1, 0.12, 0.15); // E5
  tone(523.25, 0.2, 0.25, 0.15); // C5
}

/** Soft message ping */
export function playMessageSound() {
  tone(880, 0, 0.07, 0.15, "sine");
  tone(1108, 0.06, 0.1, 0.1, "sine");
}

/** Quick reaction pop */
export function playReactionSound() {
  tone(300, 0, 0.04, 0.2, "triangle");
  tone(600, 0.03, 0.06, 0.15, "triangle");
}

/** Countdown tick (mechanical clock click) */
export function playTickSound() {
  tone(440, 0, 0.05, 0.3, "square");
}

/** Final countdown GO chime */
export function playGoSound() {
  tone(523.25, 0, 0.08, 0.3);
  tone(659.25, 0.06, 0.08, 0.3);
  tone(1046.5, 0.12, 0.3, 0.35);
}

/** Sync confirmed chime */
export function playSyncSound() {
  tone(659.25, 0, 0.08, 0.2);
  tone(783.99, 0.07, 0.08, 0.2);
  tone(987.77, 0.14, 0.2, 0.2);
}
