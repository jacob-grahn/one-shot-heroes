/** Compact cel encoding (RLE + base64), shared with the autosave worker. */
import { fail } from './validate.js';

/* ---------- compact cel encoding (shared with the autosave worker) ---------- */
export function rleEncode(a) {
  const out = new Uint8Array(a.length * 2); let o = 0, i = 0;
  while (i < a.length) { const v = a[i]; let n = 1; while (i + n < a.length && a[i + n] === v && n < 256) n++; out[o++] = n - 1; out[o++] = v; i += n; }
  return out.subarray(0, o);
}
export function bytesToB64(u) { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
export function encodeCel(a) { return 'r:' + bytesToB64(rleEncode(a)); }
function decodeRle(s, n) {
  const out = new Uint8Array(n);
  let b; try { b = atob(s.slice(2)); } catch (e) { fail('bad_cel', 'cel is not valid base64'); }
  if (b.length % 2) fail('bad_cel', 'cel RLE has odd length');
  let p = 0;
  for (let i = 0; i < b.length; i += 2) { const run = b.charCodeAt(i) + 1; if (p + run > n) fail('bad_cel', 'cel RLE overflows'); out.fill(b.charCodeAt(i + 1), p, p + run); p += run; }
  if (p !== n) fail('bad_cel', 'cel RLE has wrong pixel count');
  return out;
}
/** v1: rows of 2-hex-digit indices. */
function decodeHexRows(s, n, w) {
  const out = new Uint8Array(n);
  if (s.length !== n / w) fail('bad_cel', 'cel has wrong row count');
  s.forEach((row, y) => { if (typeof row !== 'string' || row.length !== w * 2 || !/^[0-9a-f]*$/i.test(row)) fail('bad_cel', 'cel row ' + y + ' malformed'); for (let x = 0; x < w; x++) out[y * w + x] = parseInt(row.substr(x * 2, 2), 16); });
  return out;
}
export function decodeCel(s, n, w) {
  if (typeof s === 'string' && s.startsWith('r:')) return decodeRle(s, n);
  if (Array.isArray(s)) return decodeHexRows(s, n, w);
  fail('bad_cel', 'cel must be an RLE string or hex rows');
}
