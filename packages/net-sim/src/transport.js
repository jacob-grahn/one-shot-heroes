/**
 * Transport contract shared by the in-process simulator and a future WebRTC wrapper.
 * `send` delivers one datagram to one peer. `reliable` selects the ordered channel;
 * otherwise the datagram may be lost, reordered, or duplicated. Bytes are an opaque payload.
 *
 * @typedef {object} Transport
 * @property {(to: string, bytes: Uint8Array, reliable: boolean) => void} send
 * @property {(handler: (from: string, bytes: Uint8Array, reliable: boolean) => void) => void} onMessage
 * @property {(handler: (peerId: string) => void) => void} [onPeerLeave]
 * @property {() => void} [close]
 */

/** @param {Transport} transport */
export function assertTransport(transport) {
  if (
    !transport ||
    typeof transport.send !== "function" ||
    typeof transport.onMessage !== "function"
  ) {
    throw new Error("transport needs send(to, bytes, reliable) and onMessage(handler)");
  }
  return transport;
}
