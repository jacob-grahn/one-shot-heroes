/** Read-only render views. Dev mode throws on writes; production freezes them. */

/** @param {unknown} value @param {boolean} dev */
export function readOnly(value, dev) {
  const copy = cloneView(value, 0);
  return dev ? proxy(copy) : freeze(copy);
}

/** @param {unknown} value @param {number} depth */
function cloneView(value, depth) {
  if (isText(value)) return textBox(/** @type {{ text: string }} */ (value).text);
  if (depth > 8 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => cloneView(item, depth + 1));
  const out = Object.create(null);
  for (const key of Object.keys(value))
    out[key] = cloneView(/** @type {any} */ (value)[key], depth + 1);
  return out;
}

/** Decoded strings are null-prototype copies in a render view unless toString is restored. */
function isText(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const box = /** @type {{ userContent?: boolean, text?: unknown }} */ (value);
  return box.userContent === true && typeof box.text === "string" && Object.keys(box).length === 2;
}

/** @param {string} text */
function textBox(text) {
  const box = { text: String(text), userContent: true };
  Object.defineProperty(box, "toString", {
    value() {
      return box.text;
    },
  });
  Object.defineProperty(box, "valueOf", {
    value() {
      return box.text;
    },
  });
  return box;
}

/** @param {any} value */
function proxy(value) {
  if (!value || typeof value !== "object") return value;
  if (isText(value)) return value;
  const inner = Array.isArray(value) ? value.map(proxy) : proxyObj(value);
  return new Proxy(inner, HANDLER);
}

/** @param {Record<string, unknown>} value */
function proxyObj(value) {
  const out = Object.create(null);
  for (const key of Object.keys(value)) out[key] = proxy(value[key]);
  return out;
}

const HANDLER = {
  set() {
    throw new Error("render state is read-only");
  },
  deleteProperty() {
    throw new Error("render state is read-only");
  },
  defineProperty() {
    throw new Error("render state is read-only");
  },
  setPrototypeOf() {
    throw new Error("render state is read-only");
  },
};

/** @param {any} value */
function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) freeze(value[key]);
  return value;
}
