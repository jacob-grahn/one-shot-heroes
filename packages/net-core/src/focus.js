/** Spatial-grid relevance and optional focus. Mode "none" is uniform. */

/** @param {number} value @param {number} cell */
export function cellIndex(value, cell) {
  return Math.floor(value / cell);
}

/** Chebyshev distance in grid cells. Used for game and avatar focus, not for mode none. */
export function cellDistance(a, b, cell) {
  const dx = Math.abs(cellIndex(a.x, cell) - cellIndex(b.x, cell));
  const dy = Math.abs(cellIndex(a.y, cell) - cellIndex(b.y, cell));
  return Math.max(dx, dy);
}

/** @param {string} mode @param {{ x: number, y: number }} point @param {{ x: number, y: number } | null} focus @param {number} cell */
export function relevance(mode, point, focus, cell) {
  if (mode === "none" || !focus) return 1;
  return 1 / (1 + cellDistance(point, focus, cell));
}

/** @param {{ x: number, y: number }} origin @param {{ x: number, y: number }} hint @param {number} radius */
export function clampFocus(origin, hint, radius) {
  const dx = hint.x - origin.x;
  const dy = hint.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= radius || dist === 0) return { x: hint.x, y: hint.y };
  const scale = radius / dist;
  return { x: origin.x + dx * scale, y: origin.y + dy * scale };
}

/** @param {{ x: number, y: number } | null} avatar @param {{ x: number, y: number } | undefined} hint @param {number} radius */
export function avatarFocus(avatar, hint, radius) {
  if (!avatar) return { x: 0, y: 0 };
  if (!hint) return { x: avatar.x, y: avatar.y };
  return clampFocus(avatar, hint, radius);
}
