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

`world.spawn(type, init)` on the host spends one token from the room bucket. The bucket holds `manifest.spawnBurst` (default 120). Each later game tick adds `spawnPerSecond / tickHz` tokens (default 30 per second). The credit follows `step`'s tick, not the wall clock, so a packet that leaves a few milliseconds early is not a refusal. Below one token, `spawn` throws an Error whose `message` and `code` are `"spawn_rate"`. The entity is not created and nothing is sent. Catch it in `update` when the rest of the tick should run. If `update` does not catch it, `step()` records the error and does not rethrow. `session.stats.spawnRefused` counts each refusal. The 121st spawn in a single tick is refused. A `{ local: true }` spawn does not use the bucket. The entity cap and the host-only check still throw their own errors.
