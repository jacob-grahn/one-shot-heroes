/** Single import surface for @osh/net-wire, so the codec module stays under the fan-in cap. */

export {
  applyState,
  canon,
  checkRecord,
  cloneState,
  decodePacket,
  defaultState,
  defineManifest,
  encodePacket,
  materialize,
  plainClone,
  PROTOCOL,
  quantize,
  sameState,
} from "@osh/net-wire";
