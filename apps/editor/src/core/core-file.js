/** Core: saving and loading the file format (mixed into Core; `this` is Core). */
import { canonJSON, decodeDoc, encodeDoc } from '@osh/format/document';
import { AUTHORS, FORMAT, FORMAT_VERSION, LIMITS } from '@osh/format/limits';
import { OpError, fail, guardKeys, intArg, isPlainObj } from '@osh/format/validate';
import { FPS } from '@osh/timing';

/** Parse (if text) and check the header of an untrusted save; returns the data object. */
function checkSave(data, maxOps) {
  data = parseSave(data);
  if (!isPlainObj(data)) fail('bad_format', 'Not a One Shot Heroes sprite (expected a JSON object)'); // OSH-21: say what is wrong
  if (data.format === undefined) fail('bad_format', 'Not a One Shot Heroes sprite (format missing)');
  if (data.format !== FORMAT) fail('bad_format', 'Not a One Shot Heroes sprite (format ' + JSON.stringify(String(data.format).slice(0, 40)) + ', expected "' + FORMAT + '")');
  if (data.base === undefined && data.document === undefined) fail('bad_format', 'Not a One Shot Heroes sprite (no document data)');
  guardKeys(data); // reject __proto__/constructor/prototype anywhere in the file, even in parts we would ignore
  checkVersionAndOps(data, maxOps);
  return data;
}
function checkVersionAndOps(data, maxOps) {
  if (data.version !== 1 && data.version !== 2 && data.version !== undefined) fail('bad_format', 'unsupported version ' + data.version);
  if (data.ops !== undefined && (!Array.isArray(data.ops) || data.ops.length > Math.max(LIMITS.maxOps, maxOps))) fail('bad_format', 'ops must be an array (≤' + LIMITS.maxOps + ')');
}
function parseSave(data) {
  if (typeof data !== 'string') return data;
  if (data.length > 256 * 1024 * 1024) fail('too_big', 'file too large');
  try { return JSON.parse(data); } catch (e) { fail('bad_json', 'not valid JSON'); }
}
/** Safety net: replay must reproduce what was on screen (skipped for an empty log: base is the doc). */
function checkReplay(core, data) {
  if (data.document === undefined || data.base === undefined || !(data.ops || []).length) return;
  const a = encodeDoc(core.doc), b = encodeDoc(decodeDoc(data.document));
  if (canonJSON(a) !== canonJSON(b)) fail('replay_mismatch', 'op log replay does not reproduce the saved document');
}

/** Mixin: `this` is the composed host object. @type {Record<string, any>} */
export const fileMethods = {
  save() {
    return { format: FORMAT, version: FORMAT_VERSION, fps: FPS, savedAt: new Date().toISOString(), provenance: this.provenance(), provenanceUnknown: this.baseUnknown,
      document: encodeDoc(this.doc), base: this.base, ops: this.log.map(e => e.op), cursor: this.cursor };
  },
  /** Load an untrusted save. Validates everything; on any error the current document is left untouched. */
  load(data) {
    data = checkSave(data, this.maxOps);
    const prev = { doc: this.doc, base: this.base, log: this.log, cursor: this.cursor, seq: this.seq, folded: this.folded, baseUnknown: this.baseUnknown };
    let replayErr = null;
    try { this.replaySave(data); } catch (err) { replayErr = err; }
    if (replayErr) this.loadSnapshot(data, replayErr, prev);
    this.emit('reset', null);
    return { replayed: !replayErr, warning: replayErr ? replayErr.message : null };
  },
  /** Rebuild from data.base and replay data.ops up to data.cursor. */
  replaySave(data) {
    const baseDoc = decodeDoc(data.base);
    this.doc = baseDoc; this.base = encodeDoc(baseDoc); this.log = []; this.cursor = 0; this.seq = 0; this.folded = 0;
    this.baseUnknown = !!data.provenanceUnknown;
    for (const raw of data.ops || []) this.replayOne(raw);
    const target = data.cursor === undefined ? this.log.length : intArg(data.cursor, 'cursor', 0, this.log.length);
    while (this.cursor > target) { this.cursor--; this.revert(this.log[this.cursor].inv); }
    checkReplay(this, data);
  },
  replayOne(raw) {
    if (!isPlainObj(raw) || !AUTHORS.includes(raw.author)) fail('bad_op', 'op with missing/unknown author');
    const ts = Number.isFinite(raw.ts) ? raw.ts : 0, o = this.sanitize(raw, raw.author, true);
    const inv = this.exec(o); o.seq = ++this.seq; o.ts = ts; this.log.push({ op: o, inv }); this.cursor++;
  },
  /** Replay failed: fall back to the flattened snapshot, but provenance becomes unknown (or restore prev and throw). */
  loadSnapshot(data, replayErr, prev) {
    try {
      const d = decodeDoc(data.document);
      this.doc = d; this.base = encodeDoc(d); this.log = []; this.cursor = 0; this.seq = 0; this.folded = 0; this.baseUnknown = true;
      console.warn('op log replay failed; loaded snapshot with unknown provenance:', replayErr.message);
    } catch (err2) { Object.assign(this, prev); const e = data.document === undefined ? replayErr : err2; throw new OpError(e.code || 'bad_doc', 'cannot load: ' + e.message); }
  },
};
