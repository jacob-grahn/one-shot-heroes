import assert from "node:assert/strict";
import test from "node:test";
import { createNetwork } from "@osh/net-sim";

test("reliable messages arrive once and in order under loss, reorder, and duplication", () => {
  const net = createNetwork({
    seed: 9,
    latency: 15,
    jitter: 8,
    loss: 0.35,
    reorder: 0.8,
    reorderMs: 50,
    duplicate: 0.5,
  });
  const a = net.endpoint("a");
  const b = net.endpoint("b");
  const got = [];
  b.onMessage((from, bytes, reliable) => got.push([from, reliable, bytes[0]]));
  a.send("b", Uint8Array.of(1), true);
  a.send("b", Uint8Array.of(2), true);
  a.send("b", Uint8Array.of(3), true);
  for (let i = 0; i < 40 && got.length < 3; i++) net.advance(20);
  assert.deepEqual(
    got.map((row) => row[2]),
    [1, 2, 3],
  );
  assert.equal(
    got.every((row) => row[0] === "a" && row[1] === true),
    true,
  );
});

test("unreliable datagrams can be lost or duplicated", () => {
  const dropped = createNetwork({ seed: 1, loss: 1, latency: 0 });
  const sink = [];
  const dst = dropped.endpoint("dst");
  const src = dropped.endpoint("src");
  dst.onMessage((_from, bytes) => sink.push(bytes[0]));
  src.send("dst", Uint8Array.of(7), false);
  dropped.advance(10);
  assert.deepEqual(sink, []);

  const duped = createNetwork({ seed: 1, loss: 0, latency: 0, duplicate: 1, dupMs: 5 });
  const out = [];
  const d = duped.endpoint("d");
  const s = duped.endpoint("s");
  d.onMessage((_from, bytes) => out.push(bytes[0]));
  s.send("d", Uint8Array.of(4), false);
  duped.advance(10);
  assert.deepEqual(out, [4, 4]);
});

test("a reliable duplicate is delivered once", () => {
  const net = createNetwork({ seed: 2, loss: 0, latency: 0, duplicate: 1, dupMs: 3 });
  const got = [];
  const b = net.endpoint("b");
  const a = net.endpoint("a");
  b.onMessage((_from, bytes) => got.push(bytes[0]));
  a.send("b", Uint8Array.of(5), true);
  net.advance(20);
  assert.deepEqual(got, [5]);
});

test("peer leave notifies the other endpoint", () => {
  const net = createNetwork({ seed: 1 });
  const a = net.endpoint("a");
  const b = net.endpoint("b");
  const left = [];
  b.onPeerLeave((id) => left.push(id));
  a.close();
  assert.deepEqual(left, ["a"]);
});
