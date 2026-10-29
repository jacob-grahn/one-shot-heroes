/** Seeded RNG for the simulated network. A zero seed is remapped so the stream still moves. */

/** @param {number} seed */
export function mulberry32(seed) {
  let state = seed >>> 0;
  if (state === 0) state = 1;
  return function rand() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
