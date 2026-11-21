/** Host spawn bucket. Same rule as the mediator: one token per spawn, refuse below one. */

/** @param {any} s */
export function takeSpawnToken(s) {
  const now = s.now();
  const room = {
    burst: s.manifest.spawnBurst,
    rate: s.manifest.spawnPerSecond,
    tickHz: s.manifest.tickHz,
  };
  const bag = s.spawnBucket || (s.spawnBucket = { tokens: room.burst, at: now });
  refill(bag, now, room);
  if (bag.tokens < 1) {
    s.stats.spawnRefused = (s.stats.spawnRefused || 0) + 1;
    return false;
  }
  bag.tokens -= 1;
  return true;
}

/** @param {{ tokens: number, at: number }} bag @param {number} now @param {{ burst: number, rate: number, tickHz: number }} room */
function refill(bag, now, room) {
  const gap = now - bag.at;
  if (gap < 500 / (room.tickHz || 20)) return;
  bag.tokens = Math.min(room.burst, bag.tokens + (gap / 1000) * room.rate);
  bag.at = now;
}
