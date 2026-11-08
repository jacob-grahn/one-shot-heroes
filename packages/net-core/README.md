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
