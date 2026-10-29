
/* U1: keyboard pixel cursor. When the canvas gets focus from the keyboard (Tab or script), arrows move a visible cursor,
   Enter/Space apply the current tool there, Backspace erases. Pointer use switches back to mouse behaviour. */
export const KC = { on: false, kbdFocus: false, viaPointer: false, anchor: null, spaceHeld: false, pos: null, posDims: '', run: null }; // pos: last keyboard-cursor pixel (OSH-23), kept across blur
export const clampPx = (v, n) => Math.max(0, Math.min(n - 1, v));
