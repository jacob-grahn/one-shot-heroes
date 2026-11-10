/** One-second byte and token windows. */

/** @returns {{ items: { t: number, n: number }[], sum: number }} */
export function bucket() {
  return { items: [], sum: 0 };
}

/** @param {{ items: { t: number, n: number }[], sum: number }} win @param {number} now @param {number} n @param {number} limit */
export function charge(win, now, n, limit) {
  if (!room(win, now, n, limit)) return false;
  win.items.push({ t: now, n });
  win.sum += n;
  return true;
}

/** @param {{ items: { t: number, n: number }[], sum: number }} win @param {number} now @param {number} n @param {number} limit */
export function room(win, now, n, limit) {
  trim(win, now);
  return win.sum + n <= limit;
}

/** @param {{ items: { t: number, n: number }[], sum: number }} win @param {number} now @param {number} n */
export function addBytes(win, now, n) {
  trim(win, now);
  win.items.push({ t: now, n });
  win.sum += n;
}

/** @param {{ items: { t: number, n: number }[], sum: number }} win @param {number} now */
function trim(win, now) {
  while (win.items.length && now - win.items[0].t >= 1000) win.sum -= win.items.shift().n;
}
