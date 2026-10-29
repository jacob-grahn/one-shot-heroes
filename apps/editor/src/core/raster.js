/** Rasterizers: pure; iterate only the visible part of the canvas. */

export function linePts(x0, y0, x1, y1) {
  const pts = []; let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy;
  for (;;) { pts.push([x0, y0]); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  return pts;
}
export function stamp(x, y, size) { // brush square: size1 = 1px, size2 = 2x2 (x..x+1), size3 = 3x3 centered
  if (size <= 1) return [[x, y]];
  const out = [], o = size === 2 ? 0 : -1;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) out.push([x + i + o, y + j + o]);
  return out;
}
/** The line from s ({x0, y0, x1, y1}) along its major axis p and minor axis q. */
function lineAxes(s) {
  const xMajor = Math.abs(s.x1 - s.x0) >= Math.abs(s.y1 - s.y0);
  const p0 = xMajor ? s.x0 : s.y0, p1 = xMajor ? s.x1 : s.y1, q0 = xMajor ? s.y0 : s.x0, q1 = xMajor ? s.y1 : s.x1;
  return { xMajor, p0, q0, A: Math.abs(p1 - p0), B: Math.abs(q1 - q0), sp: p0 < p1 ? 1 : -1, sq: q0 < q1 ? 1 : -1 };
}
const kRange = (c0, s, lo, hi) => s > 0 ? [lo - c0, hi - c0] : [c0 - hi, c0 - lo];
/** k range from the major axis (exact), then from the minor axis (float estimate widened by one minor step, filtered
 *  by the caller; the loop stays bounded by the major-axis window). */
function kWindow(L, size, m) {
  const pMax = (L.xMajor ? size.width : size.height) + m - 1, qMax = (L.xMajor ? size.height : size.width) + m - 1;
  let [kLo, kHi] = kRange(L.p0, L.sp, -m, pMax); kLo = Math.max(0, kLo); kHi = Math.min(L.A, kHi);
  if (L.B > 0 && L.A > 0) { const [a, b] = kRange(L.q0, L.sq, -m, qMax); kLo = Math.max(kLo, Math.floor((a - 1) * L.A / L.B) - 1); kHi = Math.min(kHi, Math.ceil((b + 1) * L.A / L.B) + 1); }
  return [kLo, kHi];
}
/** Pixels of the Bresenham line s = {x0, y0, x1, y1} that fall within `m` px of a canvas of size {width, height}.
 *  Uses the exact closed form of linePts (minor = floor((2·k·B + A) / 2A) along the major axis), so a line that is
 *  clipped walks the very same stair-step as the unclipped line; cost is O(visible pixels) even for ±1e9 endpoints. */
export function clippedLinePts(s, size, m = 4) {
  const w = size.width, h = size.height;
  const inBox = (x, y) => x >= -m && y >= -m && x < w + m && y < h + m;
  if (inBox(s.x0, s.y0) && inBox(s.x1, s.y1)) return linePts(s.x0, s.y0, s.x1, s.y1);
  const L = lineAxes(s), [kLo, kHi] = kWindow(L, size, m);
  const out = [], bA = BigInt(L.A), bB = BigInt(L.B);
  for (let k = kLo; k <= kHi; k++) {
    const off = L.A === 0 ? 0 : Number((2n * BigInt(k) * bB + bA) / (2n * bA)); // non-negative, so BigInt division == floor
    const p = L.p0 + L.sp * k, q = L.q0 + L.sq * off, x = L.xMajor ? p : q, y = L.xMajor ? q : p;
    if (inBox(x, y)) out.push([x, y]);
  }
  return out;
}
/** Rectangle s = {x0, y0, x1, y1} (corners inclusive), clipped to size {width, height}. */
export function rectPts(s, filled, size) {
  const w = size.width, h = size.height;
  const ax = Math.min(s.x0, s.x1), bx = Math.max(s.x0, s.x1), ay = Math.min(s.y0, s.y1), by = Math.max(s.y0, s.y1), pts = [];
  for (let y = Math.max(ay, 0); y <= Math.min(by, h - 1); y++) for (let x = Math.max(ax, 0); x <= Math.min(bx, w - 1); x++)
    if (filled || x === ax || x === bx || y === ay || y === by) pts.push([x, y]);
  return pts;
}
/** Ellipse inscribed in s = {x0, y0, x1, y1}, clipped to size {width, height}. */
export function ellipsePts(s, filled, size) {
  const w = size.width, h = size.height;
  const ax = Math.min(s.x0, s.x1), bx = Math.max(s.x0, s.x1), ay = Math.min(s.y0, s.y1), by = Math.max(s.y0, s.y1);
  const ew = bx - ax + 1, eh = by - ay + 1, cx = ax + ew / 2, cy = ay + eh / 2, rx = ew / 2, ry = eh / 2;
  const tol = 1.0 + 0.5 / Math.max(rx, ry) ** 1.5;
  const inside = (x, y) => x >= ax && x <= bx && y >= ay && y <= by && ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= tol;
  const pts = [];
  for (let y = Math.max(ay, 0); y <= Math.min(by, h - 1); y++) for (let x = Math.max(ax, 0); x <= Math.min(bx, w - 1); x++) {
    if (!inside(x, y)) continue;
    if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) pts.push([x, y]);
  }
  return pts;
}
export function snap45(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx > ady * 2) return [x1, y0];
  if (ady > adx * 2) return [x0, y1];
  const m = Math.max(adx, ady); return [x0 + Math.sign(dx) * m, y0 + Math.sign(dy) * m];
}
export function squareEnd(x0, y0, x1, y1) { const m = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); return [x0 + (x1 >= x0 ? 1 : -1) * m, y0 + (y1 >= y0 ? 1 : -1) * m]; }

