# @osh/net-mediator

Host-page caps in front of a transport. It does not import `@osh/net-core`.

```js
import { createMediator } from "@osh/net-mediator";

const mediator = createMediator({
  manifest,
  onDisconnect(peerId) {
    host.dropPeer(peerId);
  },
});
const transport = mediator.wrap(socket);
```

Pass the manifest so `maxEntities` and the string cap follow the game.
