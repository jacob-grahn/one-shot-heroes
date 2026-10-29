/** Resolves once boot has finished (restore, lock decision, first render). */

/** @type {(v: boolean) => void} */ export let readyResolve = () => {}; export const ready = new Promise(r => { readyResolve = r; });
