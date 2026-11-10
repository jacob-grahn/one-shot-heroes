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

`PROTOCOL` is 4. A hello may end with a session nonce. A different build, including protocol 3, fails the handshake with reason `version`.
