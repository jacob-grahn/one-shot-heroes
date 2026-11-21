/** Host spawn bucket. One token per spawn, credited from the game tick, refused below one. */

/** @param {any} s */
export function takeSpawnToken(s) {
  const rate = s.manifest.spawnPerSecond;
  const burst = s.manifest.spawnBurst;
  const hz = s.manifest.tickHz || 20;
  const tick = s.tick;
  const bag = s.spawnBucket || (s.spawnBucket = { tokens: burst, tick });
  if (tick > bag.tick) {
    bag.tokens = Math.min(burst, bag.tokens + ((tick - bag.tick) * rate) / hz);
    bag.tick = tick;
  }
  if (bag.tokens < 1) {
    s.stats.spawnRefused = (s.stats.spawnRefused || 0) + 1;
    return false;
  }
  bag.tokens -= 1;
  return true;
}
