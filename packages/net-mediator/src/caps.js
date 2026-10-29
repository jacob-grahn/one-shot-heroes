/** Caps that protect machines and the TURN bill. Anti-cheat is intentionally out of scope. */

export const CAPS = Object.freeze({
  bytesPerSecond: 64 * 1024,
  maxEntities: 400,
  spawnPerSecond: 30,
  maxKeys: 16,
  maxString: 128,
  maxDepth: 4,
  maxCustomBytes: 1024,
  maxSnapshotBytes: 64 * 1024,
  joinPerSecond: 4,
});
