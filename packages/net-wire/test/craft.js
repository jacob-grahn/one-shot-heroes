import { PROTOCOL, createWriter } from "@osh/net-wire";

/** A spawn whose custom key is hostile. The encoder refuses to build this. */
export function badKey(key) {
  const body = createWriter();
  body.u32(1);
  body.u8(1);
  body.bytes(new TextEncoder().encode("e"));
  body.u32(0);
  body.u32(0);
  body.u8(64);
  body.u8(1);
  body.u8(key.length);
  body.bytes(new TextEncoder().encode(key));
  body.u8(2);
  body.i32(1);
  const payload = body.finish();
  const packet = createWriter();
  packet.u8(PROTOCOL);
  packet.u8(0);
  packet.u32(1);
  packet.u16(1);
  packet.u16(0);
  packet.u32(0);
  packet.u8(1);
  packet.u8(4);
  packet.u16(payload.length);
  packet.bytes(payload);
  return packet.finish();
}
