import { createSession, defineManifest } from "@osh/net-core";
import { createNetwork } from "@osh/net-sim";

const N = 8;
const E = 500;
const TICKS = 100;
const TAG = "x".repeat(140);
const ALT = "y" + "x".repeat(139);
const manifest = defineManifest({
  maxPlayers: N,
  maxEntities: E,
  focus: "none",
  tickHz: 20,
  budget: 1200,
  starvationK: 8,
  custom: { tag: { type: "string", max: 160 } },
});

function bench(mode) {
  customMode = mode;
  flip = 0;
  const net = createNetwork({ seed: 1, latency: 0 });
  const sessions = [];
  for (let i = 0; i < N; i++) {
    const peerId = "p" + i;
    sessions.push(
      createSession({
        manifest,
        game,
        transport: net.endpoint(peerId),
        playerId: i,
        peerId,
        isHost: i === 0,
        hostPeerId: i === 0 ? "" : "p0",
        trace: false,
      }),
    );
  }
  const dt = 1000 / manifest.tickHz;
  for (let i = 0; i < 40 && sessions.some((session, index) => index > 0 && !session.joined); i++) {
    for (const session of sessions) session.step();
    net.advance(dt);
  }
  if (sessions.some((session, index) => index > 0 && !session.joined))
    throw new Error("bench join failed");
  const host = sessions[0];
  for (let i = 0; i < 40; i++) {
    flip ^= 1;
    for (const session of sessions) session.step();
    net.advance(dt);
  }
  const before = host.stats.bytes;
  const phases = { ...host.stats.phases };
  let hostMs = 0;
  for (let i = 0; i < TICKS; i++) {
    flip ^= 1;
    const t = performance.now();
    host.step();
    hostMs += performance.now() - t;
    for (const session of sessions) if (session !== host) session.step();
    net.advance(dt);
  }
  const ms = hostMs / TICKS;
  const phase = (name) => ((host.stats.phases[name] - phases[name]) / TICKS).toFixed(3);
  const bytes = host.stats.bytes - before;
  const perSec = Math.round(bytes / (TICKS / manifest.tickHz));
  const line = [
    `BENCH n=${N} e=${E} budget=${manifest.budget}`,
    `custom=${mode}`,
    `msPerTick=${ms.toFixed(3)}`,
    `diff=${phase("diff")}`,
    `grid=${phase("grid")}`,
    `priority=${phase("priority")}`,
    `encode=${phase("encode")}`,
    `alloc=${phase("alloc")}`,
    `other=${phase("other")}`,
    `maxPacket=${host.stats.maxPacket}`,
    `sessionBytesPerSec=${perSec}`,
    `hostUplinkKiBPerSec=${(perSec / 1024).toFixed(2)}`,
  ].join(" ");
  return { line, ms, maxPacket: host.stats.maxPacket };
}

const game = {
  init(world, net) {
    if (!net.isHost) return;
    const plain = plainRequested();
    for (let i = 0; i < E; i++) {
      const init = { x: (i % 25) * 3, y: Math.floor(i / 25) * 3 };
      if (!plain) init.custom = { tag: TAG };
      world.spawn("mob", init);
    }
  },
  update(_dt, _inputs, world) {
    let n = 0;
    const next = flip ? ALT : TAG;
    for (const entity of world.query("mob")) {
      if (n % 10 < 3) entity.x += 0.25;
      if (customMode === "unique") entity.custom.tag = n + ":" + flip + ":" + TAG.slice(0, 120);
      else if (customMode === "100%" || (customMode === "30%" && n % 10 < 3))
        entity.custom.tag = next;
      n += 1;
    }
  },
  render() {},
};

const env = /** @type {{ env?: { NET_BENCH?: string, NET_BENCH_PLAIN?: string } }} */ (
  /** @type {any} */ (globalThis).process
);

function plainRequested() {
  return !!(env && env.env && env.env.NET_BENCH_PLAIN === "1");
}

let customMode = "still";
let flip = 0;

function runBench() {
  if (plainRequested()) {
    const row = bench("still");
    console.log(row.line);
    if (row.ms > 8 || row.maxPacket > manifest.budget) throw new Error(row.line);
    return;
  }
  const rows = [bench("still"), bench("30%"), bench("100%"), bench("unique")];
  for (const row of rows) console.log(row.line);
  const gated = rows[1];
  if (gated.ms > 8 || gated.maxPacket > manifest.budget) throw new Error(gated.line);
  const unique = rows[3];
  if (unique && (unique.ms > 14 || unique.maxPacket > manifest.budget))
    throw new Error(unique.line);
  for (const row of rows) {
    if (row.maxPacket > manifest.budget) throw new Error(row.line);
  }
}

if (env && env.env && env.env.NET_BENCH === "1") runBench();
