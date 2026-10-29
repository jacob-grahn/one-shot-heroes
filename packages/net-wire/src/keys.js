/** Reject prototype keys and flag decoded strings as user content. */

import { BAD_KEYS } from "./defaults.js";
import { fail } from "./error.js";

/** @param {string} key */
export function assertKey(key) {
  if (BAD_KEYS.has(key)) fail("bad_key", "forbidden key");
}

/**
 * A decoded string. Shells must treat `.text` as untrusted user content.
 * @param {string} text
 */
export function userText(text) {
  return { text: String(text), userContent: true };
}

/** @param {unknown} v */
export function isUserText(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const box = /** @type {{ userContent?: boolean, text?: unknown }} */ (v);
  return box.userContent === true && typeof box.text === "string" && Object.keys(box).length === 2;
}

/** @param {unknown} v */
export function asPlain(v) {
  if (isUserText(v)) return /** @type {{ text: string }} */ (v).text;
  return v;
}
