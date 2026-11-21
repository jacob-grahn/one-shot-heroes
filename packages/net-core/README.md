# @osh/net-core

Host-authoritative session. Inject a transport; this package does not open a socket.

```js
import { createSession, defineManifest } from "@osh/net-core";
import { createRoom } from "@osh/net-sim";

const manifest = defineManifest({ maxPlayers: 2 });
const room = createRoom({ latency: 20 });
const host = createSession({
  manifest,
  game,
  transport: room.endpoint(0),
  playerId: 0,
  peerId: "p0",
  isHost: true,
});
host.step();
```

`game` needs `init`, `update`, and `render`. A client passes `hostPeerId` and `isHost: false`.

## world.spawn

`world.spawn(type, init)` on the host spends one token from the room bucket. The bucket holds `manifest.spawnBurst` (default 120). Each later game tick adds `spawnPerSecond / tickHz` tokens (default 30 per second). The credit follows `step`'s tick. Below one token, `spawn` throws an Error whose `message` and `code` are `"spawn_rate"`. The entity is not created and nothing is sent. The 121st spawn in a single tick is refused. Spawns inside `init` do not spend the bucket. A `{ local: true }` spawn does not use it either. `world.spawnBudget()` returns how many tokens are available, floored. `session.stats.spawnRefused` counts each refusal. The entity cap and the host-only check still throw their own errors.

```js
update(_dt, _inputs, world) {
  try {
    world.spawn("mob", { x: 1 });
  } catch (err) {
    if (!err || err.code !== "spawn_rate") throw err;
  }
}
```

If `update` does not catch `spawn_rate`, `step()` records it and does not rethrow. In dev mode that warning is at most once a second.
