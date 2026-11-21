/** Host spawn bucket. One token per spawn, credited from the game tick, refused below one. */

/** @param {any} s */
export function readSpawnBudget(s) {
  const room = roomOf(s);
  const tick = s.tick;
  const bag = s.spawnBucket;
  if (!bag) return room.burst;
  const tokens = tick > bag.tick ? refilled(bag, tick, room) : bag.tokens;
  return Math.floor(tokens);
}

/** @param {any} s */
export function takeSpawnToken(s) {
  const room = roomOf(s);
  const tick = s.tick;
  const bag = s.spawnBucket || (s.spawnBucket = { tokens: room.burst, tick });
  if (tick > bag.tick) {
    bag.tokens = refilled(bag, tick, room);
    bag.tick = tick;
  }
  if (bag.tokens < 1) {
    s.stats.spawnRefused = (s.stats.spawnRefused || 0) + 1;
    return false;
  }
  bag.tokens -= 1;
  return true;
}

/** @param {any} s */
function roomOf(s) {
  return {
    burst: s.manifest.spawnBurst,
    rate: s.manifest.spawnPerSecond,
    hz: s.manifest.tickHz || 20,
  };
}

/** @param {{ tokens: number, tick: number }} bag @param {number} tick @param {{ burst: number, rate: number, hz: number }} room */
function refilled(bag, tick, room) {
  return Math.min(room.burst, bag.tokens + ((tick - bag.tick) * room.rate) / room.hz);
}
