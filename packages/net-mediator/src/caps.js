/** Caps that protect machines and the TURN bill. Anti-cheat is intentionally out of scope. */

/**
 * @typedef {{
 *   bytesPerSecond: number,
 *   maxEntities: number,
 *   spawnPerSecond: number,
 *   maxKeys: number,
 *   maxString: number,
 *   maxName: number,
 *   maxDepth: number,
 *   maxCustomBytes: number,
 *   maxEventBytes: number,
 *   maxSnapshotBytes: number,
 *   joinPerSecond: number
 * }} CapTable
 */

/** @type {Readonly<CapTable>} */
export const CAPS = Object.freeze({
  // Per peer, per direction. Seven peers at this cap cover the ~163 KiB/s host uplink.
  bytesPerSecond: 64 * 1024,
  // Same default as defineManifest.maxEntities. Pass manifest to createMediator to copy it.
  maxEntities: 400,
  // Sustained rate. A single tick may burst up to maxEntities.
  spawnPerSecond: 30,
  maxKeys: 16,
  maxString: 128,
  maxName: 32,
  maxDepth: 4,
  maxCustomBytes: 1024,
  maxEventBytes: 1024,
  maxSnapshotBytes: 64 * 1024,
  joinPerSecond: 8,
});
