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
  guard(s, s.joiners, info || {});
}

/** @param {any} s */
export function fireEnd(s) {
  if (!s.ended || s.endFired) return;
  s.endFired = true;
  guard(s, s.enders, s.reason || "");
}

/** @param {any} s */
export function fireLeave(s, info) {
  guard(s, s.leavers, info || {});
}

/** @param {any} s @param {any[] | undefined} list @param {any} arg */
function guard(s, list, arg) {
  for (const fn of list || []) {
    try {
      fn(arg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const warn = s.game && s.game.warn;
      if (typeof warn === "function") warn("callback failed: " + message);
      else if (s.dev) console.warn("callback failed: " + message);
    }
  }
}
