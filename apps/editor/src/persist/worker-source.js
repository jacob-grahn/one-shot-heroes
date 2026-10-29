/** IndexedDB helpers and the autosave worker source (also run inside the worker). */
import { bytesToB64, encodeCel, rleEncode } from '@osh/format/cel-codec';

/* IndexedDB helpers (also used inside the worker) */
export function idbOpen() { return new Promise((res, rej) => { const r = indexedDB.open('osh-pixel-editor', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error || new Error('IndexedDB open failed')); }); }
export function idbReq(mode, fn) { return idbOpen().then(db => new Promise((res, rej) => { const tx = db.transaction('kv', mode), st = tx.objectStore('kv'), r = fn(st); let val; if (r) r.onsuccess = () => { val = r.result; }; tx.oncomplete = () => { db.close(); res(val); }; tx.onerror = () => { db.close(); rej(tx.error || new Error('IndexedDB error')); }; tx.onabort = () => { db.close(); rej(tx.error || new Error('IndexedDB write aborted (quota?)')); }; })); }
export function buildAutosaveRecord(p) {
  const cels = {}, tags = {}; for (const [k, a] of p.cels) cels[k] = encodeCel(a);
  for (const [k, t] of p.tags || []) if (t.some(v => v)) tags[k] = encodeCel(t);
  return JSON.stringify({ format: p.format, version: p.version, fps: p.fps, savedAt: new Date().toISOString(), name: p.name,
    provenanceUnknown: p.provenanceUnknown, document: Object.assign({}, p.meta, { cels, tags }), base: p.base, ops: p.ops, cursor: p.cursor, journalToken: p.journalToken });
}
export function autosaveWorkerMain() {
  self.onmessage = async e => {
    const { id, payload } = e.data, t0 = performance.now();
    try { const json = buildAutosaveRecord(payload); await idbReq('readwrite', st => st.put(json, 'autosave')); self.postMessage({ id, ok: true, bytes: json.length, ms: performance.now() - t0 }); }
    catch (err) { self.postMessage({ id, ok: false, error: String((err && err.message) || err) }); }
  };
}
export const WORKER_SOURCE = [rleEncode, bytesToB64, encodeCel, idbOpen, idbReq, buildAutosaveRecord, autosaveWorkerMain].map(f => f.toString()).join('\n') + '\n' + autosaveWorkerMain.name + '();';

