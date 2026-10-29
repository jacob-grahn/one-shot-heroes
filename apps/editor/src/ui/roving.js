/** Roving-tabindex widgets: rebuild without losing focus, arrow-key navigation. */

/** Rebuild a widget's DOM without losing keyboard focus: the element with the same data-fk gets focus back (OSH-09).
 *  Items with class "rv" form one roving tab stop: only the current one (curKey) is tabbable. */
export function rebuildKeepingFocus(box, build, curKey) {
  const ae = /** @type {HTMLElement | null} */ (document.activeElement), had = ae && box.contains(ae) && ae.dataset ? ae.dataset.fk : null;
  build();
  const rv = [...box.querySelectorAll('.rv')], cur = rv.find(x => x.dataset.fk === had) || rv.find(x => x.dataset.fk === curKey) || rv[0];
  rv.forEach(x => { x.tabIndex = x === cur ? 0 : -1; });
  if (had) { const t = box.querySelector(`[data-fk="${had}"]`); if (t) t.focus({ preventScroll: false }); }
}
/** 2-D group (data-row / data-col): index of the item the key moves to (-1 if none), or null when the key is not a move. */
function gridTarget(key, t, items) {
  const r = +t.dataset.row, c = +t.dataset.col, find = (rr, cc) => items.findIndex(x => +x.dataset.row === rr && +x.dataset.col === cc);
  const moves = { ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1], ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], Home: [r, 0] };
  if (Object.hasOwn(moves, key)) return find(...moves[key]);
  if (key !== 'End') return null;
  const row = items.filter(x => +x.dataset.row === r); return items.indexOf(row[row.length - 1]);
}
/** 1-D group, cols items per row: index the key moves to, or null when the key is not a move. */
function listTarget(key, i, n, cols) {
  const moves = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: 0, End: n - 1 };
  return Object.hasOwn(moves, key) ? moves[key] : null;
}
/** Enter / Space activate, F2 renames. Returns true when the key was handled. */
function activateKeys(e, t) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat && t.activate) t.activate(e); return true; }
  if (e.key === 'F2' && t.rename) { e.preventDefault(); t.rename(); return true; }
  return false;
}
const isGroupItem = (e, t) => t.classList && t.classList.contains('rv') && !(e.ctrlKey || e.metaKey || e.altKey);
/** Keyboard for a roving group: arrows move (cols per row, or by data-row/data-col), Enter/Space activate, F2 renames. */
export function rovingKeys(box, opts = {}) {
  box.addEventListener('keydown', e => {
    const t = e.target; if (!isGroupItem(e, t)) return;
    const items = [...box.querySelectorAll('.rv')], i = items.indexOf(t); if (i < 0) return;
    if (activateKeys(e, t)) return;
    const j = opts.grid ? gridTarget(e.key, t, items) : listTarget(e.key, i, items.length, opts.cols ? opts.cols() : 1);
    if (j === null) return;
    e.preventDefault(); // arrows inside a group never fall through to frame navigation / nudging
    if (j >= 0 && j < items.length) { items.forEach(x => { x.tabIndex = -1; }); items[j].tabIndex = 0; items[j].focus(); }
  });
}
