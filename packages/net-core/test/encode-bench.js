import { createSession, defineManifest } from "@osh/net-core";
import { createNetwork } from "@osh/net-sim";

const N = 8;
const E = 500;
const TICKS = 100;
const manifest = defineManifest({
  maxPlayers: N,
  focus: "none",
  tickHz: 20,
  budget: 1200,
  starvationK: 8,
});

function bench() {
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
    for (const session of sessions) session.step();
    net.advance(dt);
  }
  const before = host.stats.bytes;
  const phases = { ...host.stats.phases };
  let hostMs = 0;
  for (let i = 0; i < TICKS; i++) {
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
  if (host.stats.maxPacket > manifest.budget || ms > 8) throw new Error(line);
  console.log(line);
}

const game = {
  init(world, net) {
    if (!net.isHost) return;
    for (let i = 0; i < E; i++) world.spawn("mob", { x: (i % 25) * 3, y: Math.floor(i / 25) * 3 });
  },
  update(_dt, _inputs, world) {
    let n = 0;
    for (const entity of world.query("mob")) {
      if (n % 10 < 3) entity.x += 0.25;
      n += 1;
    }
  },
  render() {},
};

if (process.env.NET_BENCH === "1") bench();
