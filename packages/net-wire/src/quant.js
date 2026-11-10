/** Quantized positions, one angle, and scale. 16-bit unsigned, byte aligned. */

/** @param {number} t */
export function clamp01(t) {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/** @param {number} v @param {number} min @param {number} max */
export function toU16(v, min, max) {
  const t = max === min ? 0 : (v - min) / (max - min);
  return Math.round(clamp01(t) * 65535);
}

/** @param {number} q @param {number} min @param {number} max */
export function fromU16(q, min, max) {
  return min + (q / 65535) * (max - min);
}

/** @param {number} rad */
export function wrapAngle(rad) {
  const turn = Math.PI * 2;
  const t = rad % turn;
  return t < 0 ? t + turn : t;
}
