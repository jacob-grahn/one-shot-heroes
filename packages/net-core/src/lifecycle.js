/** Session end and join notices. */

/** @param {any} s @param {string} reason */
export function finish(s, reason) {
  if (!s.ended) {
    s.ended = true;
    s.reason = reason;
  } else if (!s.reason) s.reason = reason;
  fireEnd(s);
}

/** @param {any} s @param {any} info */
export function fireJoin(s, info) {
  for (const fn of s.joiners || []) fn(info || {});
}

/** @param {any} s */
export function fireEnd(s) {
  if (!s.ended || s.endFired) return;
  s.endFired = true;
  for (const fn of s.enders || []) fn(s.reason || "");
}

