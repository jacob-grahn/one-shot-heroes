/**
 * Late-bound calls from lower-level modules up to the modules that own them (keeps the import graph acyclic).
 * Each entry is registered once by its owner at module load; calling an unregistered hook throws.
 */

const unset = name => () => { throw new Error('hook not registered: ' + name); };
export const hooks = {
  /** @type {() => void} coalesced panel refresh (ui/refresh.js) */
  refresh: unset('refresh'),
  /** @type {() => void} immediate panel refresh (ui/refresh.js) */
  refreshNow: unset('refreshNow'),
  /** @type {() => void} timeline redraw (ui/timeline.js) */
  renderTimeline: unset('renderTimeline'),
  /** @type {any} the multi-tab editor lock (persist/editor-lock.js) */
  editorLock: null,
};
