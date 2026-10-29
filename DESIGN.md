# Realtime sync engine

AI-prompted games treat the world as local. This library is the wrapper that does the networking. A game writes `init`, `update`, and `render`. It does not open a socket.

Real WebRTC is a later deliverable. This one defines the transport interface and ships an in-process simulated transport.

## Module map

| package | role |
|---|---|
| `@osh/net-wire` | Binary protocol, manifest, quantization, custom values. No session and no transport. |
| `@osh/net-core` | The in-game library: world, host tick, deltas, interpolation, `net.*`. |
| `@osh/net-sim` | `Transport` interface and the simulated network (fake clock, seeded loss). |
| `@osh/net-mediator` | Host-page caps. Not imported by `@osh/net-core`. |
| `@osh/net-examples` | A 2-player dots arena and a vote-driven text adventure. |

`@osh/net-core` does not import `@osh/net-sim` or `@osh/net-mediator`. The host page injects a transport. The mediator wraps that transport in the host page's own module graph, because a game can tamper with the copy of the in-game library it was given.

## What a game sees

```js
init(world, net)
update(dt, inputs, world, net)   // host only
render(state, alpha, draw, net)

world.spawn(type, init, { local: true })
world.despawn(entity)
world.query(type)

net.isHost, net.me, net.players
net.emit(name, payload), net.on(name, fn)
net.time, net.tick, net.random()
net.setFocus(playerId, x, y)     // host, focus mode "game"
net.setFocusHint(x, y)           // client hint, focus mode "avatar"
```

`createSession({ manifest, game, transport, playerId, peerId, isHost, hostPeerId })` is the wrapper. The host calls `step()` once per sim tick. Clients call `step()` to send inputs and take in packets. `render(draw)` builds the frozen view.

Only the host runs `update`. Only the host spawns networked entities and assigns their ids (uint16, starting at 1, never reused). A client may spawn `{ local: true }` particles; those are never synced. Ids below 0 are local.

## Defaults Jacob can change

Every value below is the default in `defineManifest` or `CAPS`. Pass a different value in the manifest, or pass `caps` to `createMediator`.

| default | value | where |
|---|---|---|
| 2D only | one position, one rotation in radians | entity fields |
| players | 8, including the host | `manifest.maxPlayers` (max 8) |
| networked entities | a few hundred; mediator cap 400 | `CAPS.maxEntities` |
| who runs logic | the host | no client prediction in v1 |
| sim rate | 20 Hz | `manifest.tickHz` (1..60) |
| interpolation delay | 100 ms | `manifest.interpMs` |
| teleport snap | 48 world units | `manifest.teleport` |
| unreliable byte budget | 1200 bytes | `manifest.budget` |
| starvation bound K | 8 ticks | `manifest.starvationK` |
| input redundancy | last 4 ticks | `manifest.inputRedundancy` |
| interest cell | 32 world units | `manifest.cell` |
| avatar hint clamp | 64 world units | `manifest.focusClamp` |
| position range | -2048..2048, 16-bit | `manifest.quant` |
| scale range | 0..8, 16-bit | `manifest.quant` |
| angle | 0..2π, 16-bit | fixed |
| custom payload | about 1 KB per encoded custom value | `CAPS.maxCustomBytes` (1024) |
| focus | `none` | `manifest.focus` |
| host leave | the session ends | bye, or the host peer leaving |
| events | reliable `net.emit` / `net.on` | not replayed to late joiners |
| bytes/s | 64 KiB/s per mediator | `CAPS.bytesPerSecond` |
| spawn rate | 30/s | `CAPS.spawnPerSecond` |
| keys per custom object | 16 | `CAPS.maxKeys` |
| string length | 128 | `CAPS.maxString` |
| nesting | 4 | `CAPS.maxDepth` |
| late-join snapshot | 64 KiB | `CAPS.maxSnapshotBytes` |
| join rate | 4/s | `CAPS.joinPerSecond` |

Anti-cheat is not a goal. The caps exist to protect players' machines and the TURN bill. Schema validation of inputs (so `update` never sees a value outside the manifest) lives in the engine. The caps live in the mediator.

## Clock and 15 fps animation

Every packet carries the sender's tick. The host tick advances once per `step`. A client sets its host-tick estimate from the newest packet and extrapolates by the number of local steps since that packet arrived. There is no NTP.

`render` on a client samples at `estimate - interpMs`. Positions and scale lerp. Rotation takes the short way around. A jump longer than `teleport` snaps to the newer sample. The client does not extrapolate past the newest sample: if the buffer underruns it holds. The host renders the tick it just simulated.

The animation frame is not transmitted. The entity carries an anim id (`uint16`) and `animStart`, the host tick the animation started on. If the game changes `anim` and leaves `animStart` alone, the host stamps `animStart` with the current tick.

Frames come from `@osh/timing`'s 15 fps constant:

```
frame = floor((hostTick - animStart) * 15 / tickHz) mod frameCount
```

At the default 20 Hz that is 0.75 frames per sim tick. At `tickHz` 15 it is exactly one frame per tick. `animFrame(animStart, hostTick, frameCount, tickHz)` is the helper. Both peers compute it from the synced tick, so they show the same frame without the packet carrying one.

## Channels

`Transport.send(to, bytes, reliable)` and `onMessage(handler)`. `onPeerLeave` is optional. `@osh/net-sim`'s `createNetwork` implements this with a fake clock. Latency, jitter, loss, reordering, and duplication are seeded. The reliable channel is ordered and delivers once (the sim retransmits). The unreliable channel may drop, reorder, or duplicate. A future WebRTC transport must offer the same two channels. The sim is not a wire format; it passes `Uint8Array`s in process.

Topology is a star. Clients talk only to the host. The wrapper tells a client the host's peer id.

Reliable messages: handshake (`protocol` + game hash), spawn, despawn, `net.emit` events, the late-join snapshot, welcome/reject/bye. Unreliable: entity state, inputs, focus hints. Inputs repeat the last few ticks. The host applies a tick's input once, after checking it against the manifest. A bad sample is dropped.

The handshake compares `manifest.hash` (FNV-1a of the canonical manifest) and protocol version 1. A mismatch rejects the peer. If the host leaves, clients end with `host_left`.

## Change tracking and deltas

At the end of a host tick each entity is snapshotted once (a plain copy, not a Proxy — a Proxy misses `custom.hp = 1`). That snapshot is diffed per recipient against the last state that recipient acknowledged.

Each recipient has its own baseline, version counter, and Gaffer accumulator:

```
acc += basePriority * relevance * dt
```

`basePriority` comes from `manifest.types[type].priority` (default 1). Sending an entity resets its accumulator to 0. Packets are filled up to the byte budget, highest accumulator first, not up to a fixed item count. One voluntary packet is sent per recipient per tick. If a dirty entity is still unsent and its age is at least K ticks, extra packets go out the same tick until it has been sent. Resends use the same K bound so a lost packet is retried. No single packet exceeds the budget. A single entity that cannot fit is an error; the custom cap keeps a valid entity inside the budget.

Relevance:

- `none` (default): 1 for every entity. Items go out by accumulated age. This is the mode for vote-driven text adventures and board games.
- `game`: the host calls `net.setFocus(playerId, x, y)`.
- `avatar`: the host finds that player's avatar (`avatarType` + `avatarOwnerKey`) and clamps a client `setFocusHint` to `focusClamp` world units around it.

`game` and `avatar` use a spatial grid. Relevance is `1 / (1 + chebyshev cell distance)`. It is never zero, and K forces a send anyway, so a far dirty entity cannot starve.

Deltas are absolute field values, not additive, so a duplicate or a reorder is harmless: a client applies an update only onto the baseline version the packet names, and only if the new version is newer. Defaults (`x = 0`, `y = 0`, `rotation = 0`, `scale = 1`, `anim = 0`, `animStart = 0`, empty custom) are omitted. They are the baseline for a spawn and for a late join. The late-join snapshot is the full set of non-default values, chunked so each datagram still fits the budget. A client that receives it gets exactly the host's current networked state, not the history of events.

Acks use a sequence number plus a 32-packet bit window, carried on every packet. State sequence 0 is reserved.

## Custom values

JSON scalars, arrays, and objects. A changed key is sent whole. Key names travel with the value as a length-prefixed string, not as an id in a side string table: an unreliable delta must still decode if it arrives before any reliable dictionary message. Decode builds objects with `Object.create(null)` and rejects `__proto__`, `constructor`, and `prototype`.

Strings are user content. On the receiving side they are `{ text, userContent: true }`, not bare strings, so a shell can refuse to treat them as HTML or code. The host keeps the plain string the game wrote.

Keys must be declared in the manifest (`custom`, `inputs`, `events`). The schema checks ranges before `update` and before `emit`. Integers and the transform fields are quantized; custom numbers are `i32` or `f32`.

`net.random()` is a mulberry32 stream seeded by the session seed (the welcome message carries it). Call order matters. It is for host `update`. `net.time` is seconds of the host clock (`tick / tickHz`).

`render` receives a deep copy. In dev mode (the default) writing it throws `render state is read-only`. With `dev: false` the copy is frozen.

## Mediator

`createMediator({ now, caps }).wrap(transport)` drops any datagram that fails a cap and records the code on `violations`. `inspect(bytes)` is the same check without a transport. Counts use `now()`, so tests advance a fake clock. The walk is independent of the game's session: it decodes `@osh/net-wire` and enforces bytes/s, entity count, spawn rate, keys, string length, depth, custom size, snapshot size, join rate, and the three prototype keys.

## Deviations

- Key names are inline strings, not a session dictionary. A dictionary id would be unreadable if the unreliable packet won the race against the reliable definition.
- Anim ids are `uint16`. The game maps names to ids.
- Custom keys, inputs, and events must be declared in the manifest. Undeclared keys are not synced.
- Clients speak only to the host.
- Property tests use a seeded in-repo generator, not a third-party property library.
- `net.tick` is exposed so a game can stamp `animStart`. The host also stamps it when `anim` changes and `animStart` does not.
- Decoded strings are `{ text, userContent: true }`. The sending game still holds a plain string.
- The host renders the latest tick. Clients interpolate. There is no client prediction.
- The mediator's custom-size cap is per encoded custom payload (a spawn, a snapshot record, or a state delta), which is the unit that hits the wire.
