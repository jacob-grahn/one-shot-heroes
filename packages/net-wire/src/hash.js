/** Stable stringify and FNV-1a. The handshake compares this digest, not a crypto hash. */

/** @param {unknown} v */
export function stable(v) {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return stableObj(/** @type {Record<string, unknown>} */ (v));
  return JSON.stringify(v);
}

/** @param {Record<string, unknown>} v */
function stableObj(v) {
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
}

/** @param {string} str */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
