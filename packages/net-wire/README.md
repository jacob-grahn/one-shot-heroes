# @osh/net-wire

Binary protocol, manifest, and quantization. No session and no transport.

```js
import { defineManifest, PROTOCOL } from "@osh/net-wire";

const manifest = defineManifest({
  maxPlayers: 4,
  tickHz: 20,
  silenceMs: 12000,
});
```

`PROTOCOL` is 3. A different build fails the handshake with reason `version`.
