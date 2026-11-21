/** Errors raised while encoding or decoding a sync packet. */

export class WireError extends Error {
  /**
   * @param {string} code
   * @param {string} [message]
   */
  constructor(code, message) {
    super(message || code);
    this.code = code;
    this.name = "WireError";
  }
}

/** @param {string} code @param {string} [message] */
export function fail(code, message) {
  throw new WireError(code, message);
}
