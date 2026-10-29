/** Storage keys and timing constants for autosave, journal and the multi-tab lock. */

export const LEGACY_AUTOSAVE_KEY = 'osh-pixel-editor:autosave:v1';
export const JOURNAL_KEY = 'osh-pixel-editor:journal:v1'; // synchronous op journal since the last committed autosave (N3)
export const JOURNAL_MAX = 2 * 1024 * 1024;
export const JOURNAL_MAX_OPS = 2000;   // F2: above this many unsaved ops the journal is not rewritten; an immediate autosave covers them
export const HEARTBEAT_KEY = 'osh-pixel-editor:owner:v1', CLAIM_KEY = 'osh-pixel-editor:claim:v1';
export const HEARTBEAT_MS = 1000, HEARTBEAT_STALE_MS = 6000, CLAIM_WAIT_MS = 250, VERIFY_MS = 500, ECHO_MS = 25, BYE_WINDOW_MS = 3000, BYE_GRACE_MS = 300; // F1: stale threshold well above long-task durations
