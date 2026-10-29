/** Priority packing by byte size. Large sets use a partial select, not a full sort. */

const OVERHEAD = 20;

/** @param {{ pri: number, id: number, age: number, size: number }[]} items @param {number} k @param {number} budget */
export function planPackets(items, k, budget) {
  const cap = fitCap(items, k, budget);
  const pool = items.length > cap ? partialTop(items, cap) : items.slice();
  pool.sort(byPri);
  return greedy(pool, k, budget);
}

/** @param {{ pri: number, id: number }} a @param {{ pri: number, id: number }} b */
function byPri(a, b) {
  return b.pri - a.pri || a.id - b.id;
}

/** @param {{ size: number, age: number }[]} items @param {number} k @param {number} budget */
function fitCap(items, k, budget) {
  let min = 1e9;
  let forced = 0;
  for (const item of items) {
    if (item.size < min) min = item.size;
    if (item.age >= k) forced += 1;
  }
  const fit = Math.ceil((budget - OVERHEAD) / Math.max(1, min));
  return Math.min(items.length, Math.max(fit, forced));
}

/** @param {any[]} sorted @param {number} k @param {number} budget */
function greedy(sorted, k, budget) {
  const bag = { first: [], rest: [], used: OVERHEAD, budget };
  for (const item of sorted) place(bag, item);
  const packets = bag.first.length ? [bag.first] : [];
  spill(packets, bag.rest, k, budget);
  return packets;
}

/** @param {{ first: any[], rest: any[], used: number, budget: number }} bag @param {any} item */
function place(bag, item) {
  if (bag.used + item.size <= bag.budget) {
    bag.first.push(item);
    bag.used += item.size;
  } else bag.rest.push(item);
}

/** @param {any[][]} packets @param {any[]} rest @param {number} k @param {number} budget */
function spill(packets, rest, k, budget) {
  let extra = [];
  let used = OVERHEAD;
  for (const item of rest) {
    if (item.age < k) continue;
    if (item.size + OVERHEAD > budget) throw new Error("entity exceeds byte budget");
    if (used + item.size > budget) {
      packets.push(extra);
      extra = [];
      used = OVERHEAD;
    }
    extra.push(item);
    used += item.size;
  }
  if (extra.length) packets.push(extra);
}

/** Keep the `cap` highest-priority items. Root of the heap is the worst of those. */
export function partialTop(items, cap) {
  const heap = [];
  for (let i = 0; i < items.length; i++) offer(heap, items[i], cap);
  return heap;
}

/** @param {any[]} heap @param {any} item @param {number} cap */
function offer(heap, item, cap) {
  if (heap.length < cap) {
    heap.push(item);
    up(heap, heap.length - 1);
    return;
  }
  if (!worse(heap[0], item)) return;
  heap[0] = item;
  down(heap, 0);
}

/** @param {any} a @param {any} b */
function worse(a, b) {
  if (a.pri !== b.pri) return a.pri < b.pri;
  return a.id > b.id;
}

/** @param {any[]} heap @param {number} i */
function up(heap, i) {
  let n = i;
  while (n > 0) {
    const p = (n - 1) >> 1;
    if (!worse(heap[n], heap[p])) break;
    swap(heap, n, p);
    n = p;
  }
}

/** @param {any[]} heap @param {number} i */
function down(heap, i) {
  let n = i;
  const len = heap.length;
  for (;;) {
    const next = worstChild(heap, n, len);
    if (next === n) break;
    swap(heap, n, next);
    n = next;
  }
}

/** @param {any[]} heap @param {number} i @param {number} len */
function worstChild(heap, i, len) {
  let m = i;
  const l = i * 2 + 1;
  const r = l + 1;
  if (l < len && worse(heap[l], heap[m])) m = l;
  if (r < len && worse(heap[r], heap[m])) m = r;
  return m;
}

/** @param {any[]} heap @param {number} i @param {number} j */
function swap(heap, i, j) {
  const tmp = heap[i];
  heap[i] = heap[j];
  heap[j] = tmp;
}
