/** Errors and validation helpers for untrusted input. */
import { BAD_KEYS, LIMITS } from './limits.js';

/* ---------- errors & validation helpers ---------- */
export class OpError extends Error { constructor(code, msg) { super(msg); this.code = code; this.name = 'OpError'; } }
export const fail = (code, msg) => { throw new OpError(code, msg); };
export const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const isInt = v => Number.isInteger(v);
export const isPlainObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function guardKeys(v, depth = 0) {
  if (depth > 6 || v === null || typeof v !== 'object') return;
  if (Array.isArray(v)) { for (const x of v) if (x && typeof x === 'object') guardKeys(x, depth + 1); return; }
  for (const k of Object.keys(v)) { if (BAD_KEYS.has(k)) fail('bad_key', 'forbidden key "' + k + '"'); guardKeys(v[k], depth + 1); }
}
export function intArg(v, name, min, max) {
  if (!isInt(v) || v < min || v > max) fail('bad_arg', `${name} must be an integer ${min}..${max} (got ${JSON.stringify(v)})`);
  return v;
}
export function coord(v, name) {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > LIMITS.maxCoord) fail('bad_arg', `${name} must be a finite number within ±${LIMITS.maxCoord} (got ${JSON.stringify(v)})`);
  return Math.trunc(v);
}
export function nameArg(v, what) {
  if (typeof v !== 'string') fail('bad_arg', what + ' must be a string');
  v = v.trim(); if (!v || v.length > LIMITS.maxNameLen) fail('bad_arg', `${what} must be 1..${LIMITS.maxNameLen} characters`);
  return v;
}
export function normHex(h) {
  if (typeof h !== 'string') fail('bad_color', 'color must be a hex string');
  h = h.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(h)) h = h.split('').map(c => c + c).join('');
  if (/^[0-9a-f]{8}$/.test(h)) h = h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/.test(h)) fail('bad_color', 'bad color: ' + JSON.stringify(h.slice(0, 20)));
  return '#' + h;
}
export function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }

