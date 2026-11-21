# @osh/net-sim

In-process transport. Latency, loss, jitter, and reorder are seeded.

```js
import { createRoom } from "@osh/net-sim";

const room = createRoom({ seed: 1, latency: 30, loss: 0.05 });
const host = room.endpoint(0);
room.advance(50);
```

Pair it with `@osh/net-core` `createSession`. The sim does not import the game library.
