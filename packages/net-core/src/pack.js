/** Fill a byte budget in priority order. Forced entities may spill into extra packets. */

/** @param {any[]} items @param {(group: any[]) => boolean} fits */
export function takeBatches(items, fits) {
  const batches = [];
  let cur = [];
  for (const item of items) {
    if (cur.length && !fits(cur.concat([item]))) {
      batches.push(cur);
      cur = [];
    }
    if (!fits([item])) return { batches, overflow: item };
    cur.push(item);
  }
  if (cur.length) batches.push(cur);
  return { batches, overflow: null };
}

/**
 * First packet takes whatever fits, highest priority first.
 * Later packets exist only so a dirty entity of age >= K still goes out.
 * @param {any[]} items
 * @param {number} k
 * @param {(group: any[]) => boolean} fits
 */
export function packBudget(items, k, fits) {
  const first = [];
  const rest = [];
  for (const item of items) {
    if (fits(first.concat([item]))) first.push(item);
    else rest.push(item);
  }
  const packets = first.length ? [first] : [];
  let extra = [];
  for (const item of rest) {
    if (item.age < k) continue;
    extra = pushExtra(packets, extra, item, fits);
  }
  if (extra.length) packets.push(extra);
  return packets;
}

/** @param {any[][]} packets @param {any[]} extra @param {any} item @param {(group: any[]) => boolean} fits */
function pushExtra(packets, extra, item, fits) {
  if (fits(extra.concat([item]))) return extra.concat([item]);
  if (extra.length) packets.push(extra);
  if (!fits([item])) throw new Error("entity exceeds byte budget");
  return [item];
}
