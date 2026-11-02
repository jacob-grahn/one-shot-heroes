# Realtime sync engine

AI-prompted games treat the world as local. This library is the wrapper that does the networking. A game writes `init`, `update`, and `render`. It does not open a socket.

Real WebRTC is a later deliverable. This one defines the transport interface and ships an in-process simulated transport.

## Module map

| package             | role                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------ |
| `@osh/net-wire`     | Binary protocol, manifest, quantization, custom values. No session and no transport. |
| `@osh/net-core`     | The in-game library: world, host tick, deltas, interpolation, `net.*`.               |
| `@osh/net-sim`      | `Transport` interface and the simulated network (fake clock, seeded loss).           |
| `@osh/net-mediator` | Host-page caps. Not imported by `@osh/net-core`.                                     |
| `@osh/net-examples` | A 2-player dots arena and a vote-driven text adventure.                              |

`@osh/net-core` does not import `@osh/net-sim` or `@osh/net-mediator`. The host page injects a transport. The mediator wraps that transport in the host page's own module graph, because a game can tamper with the copy of the in-game library it was given.

## What a game sees

```js
init(world, net);
update(dt, inputs, world, net); // host only
render(state, alpha, draw, net);

world.spawn(type, init, { local: true }); // throws "entity cap is N" past manifest.maxEntities
world.despawn(entity);
world.query(type);

(net.isHost, net.me, net.players);
(net.emit(name, payload), net.on(name, fn));
(net.time, net.tick, net.random());
net.setFocus(playerId, x, y); // host, focus mode "game"
net.setFocusHint(x, y); // client hint, focus mode "avatar"
```

`createSession({ manifest, game, transport, playerId, peerId, isHost, hostPeerId })` is the wrapper. The host calls `step()` once per sim tick. Clients call `step()` to send inputs and take in packets. `render(draw)` builds the frozen view.

Only the host runs `update`. Only the host spawns networked entities and assigns their ids (uint32, starting at 1, never reused). `world.spawn` throws `entity cap is N` when the live networked count is already `manifest.maxEntities` (default 400). A client may spawn `{ local: true }` particles; those are never synced. Ids below 0 are local. The counter stops at 2^32-1: the next spawn ends the session with reason `ids` and sends bye, instead of wrapping the id.

## Defaults Jacob can change

Every value below is the default in `defineManifest` or `CAPS`. Pass a different value in the manifest, or pass `caps` to `createMediator`. `createMediator({ manifest })` copies `manifest.maxEntities` into the cap.

| default                | value                                 | where                         |
| ---------------------- | ------------------------------------- | ----------------------------- |
| 2D only                | one position, one rotation in radians | entity fields                 |
| players                | 8, including the host                 | `manifest.maxPlayers` (max 8) |
| networked entities     | 400; spawn past that throws           | `manifest.maxEntities`        |
| who runs logic         | the host                              | no client prediction in v1    |
| sim rate               | 20 Hz                                 | `manifest.tickHz` (1..60)     |
| interpolation delay    | 100 ms                                | `manifest.interpMs`           |
| teleport snap          | 48 world units                        | `manifest.teleport`           |
| unreliable byte budget | 1200 bytes                            | `manifest.budget`             |
| starvation bound K     | 8 ticks                               | `manifest.starvationK`        |
| input redundancy       | last 4 ticks                          | `manifest.inputRedundancy`    |
| interest cell          | 32 world units                        | `manifest.cell`               |
| avatar hint clamp      | 64 world units                        | `manifest.focusClamp`         |
| position range         | -2048..2048, 16-bit                   | `manifest.quant`              |
| scale range            | 0..8, 16-bit                          | `manifest.quant`              |
| angle                  | 0..2π, 16-bit                         | fixed                         |
| custom payload         | about 1 KB per encoded custom value   | `CAPS.maxCustomBytes` (1024)  |
| focus                  | `none`                                | `manifest.focus`              |
| host leave             | the session ends                      | bye, or the host peer leaving |
| events                 | reliable `net.emit` / `net.on`        | not replayed to late joiners  |
| bytes/s                | 64 KiB/s per peer, per direction      | `CAPS.bytesPerSecond`         |
| spawn rate             | 30/s after a burst of maxEntities     | `CAPS.spawnPerSecond`         |
| keys per custom object | 16                                    | `CAPS.maxKeys`                |
| string length          | manifest string max, else 128         | `CAPS.maxString`              |
| nesting                | 4                                     | `CAPS.maxDepth`               |
| late-join snapshot     | 64 KiB per packet, chunked            | `CAPS.maxSnapshotBytes`       |
| join rate              | 8/s per peer                          | `CAPS.joinPerSecond`          |
| event name             | 32 characters                         | `CAPS.maxName`                |
| event payload          | 1024 bytes                            | `CAPS.maxEventBytes`          |
| event relay            | off unless `relay: true`              | manifest `events`             |

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

Reliable messages: handshake (`protocol` + game hash), spawn, despawn, `net.emit` events, the late-join snapshot, welcome/reject/bye. Unreliable: entity state, inputs, focus hints. Inputs repeat the last few ticks. The host applies a tick's input once, after checking it against the manifest. A bad sample is dropped. The host keeps samples in `[tick - max(inputRedundancy, tickHz * 2), tick + 4]`, so a round trip longer than the repeated history still applies, up to about two seconds. A sample older than that is dropped.

The handshake compares `manifest.hash` (FNV-1a of the canonical manifest) and protocol version 2. A mismatch rejects the peer. If the host leaves, clients end with `host_left`.

## Change tracking and deltas

At the end of a host tick each entity is snapshotted once (a plain copy, not a Proxy — a Proxy misses `custom.hp = 1`). The unreliable patch is diffed against that peer's spawn or late-join snapshot (version 0), so every delta is a full description since spawn. The host sends it until the peer acknowledges that description. An empty patch is sent when the entity has returned to the spawn pose, so a lost "back to baseline" packet is retried instead of going quiet.

Each recipient has its own baseline, version counter, and Gaffer accumulator:

```
acc += basePriority * relevance * dt
```

`basePriority` comes from `manifest.types[type].priority` (default 1). Sending an entity resets its accumulator to 0. Packets are filled up to the byte budget, highest accumulator first, not up to a fixed item count. One voluntary packet is sent per recipient per tick. If a dirty entity is still unsent and its age is at least K ticks, extra packets go out the same tick until it has been sent. Resends use the same K bound so a lost packet is retried. No single packet exceeds the budget. Custom data over 1024 bytes throws `custom data exceeds 1024 bytes` at the assignment (`entity.custom = …`, a property set, or a nested write on that object) and at `world.spawn`, before the value is stored. The write marks that entity dirty. The tick size-checks and encodes custom only for dirty entities; unchanged custom keeps the last snapshot. A throw inside `update` leaves the tick partial: the oversize write is reverted, earlier edits in that tick stay, the step still sends, and in dev the game's `warn(message)` is called (or `console.warn` if the game has no `warn`). Send paths do not throw: a single reliable message that cannot fit is counted on `stats.reliableDrops` and that peer is disconnected. Snapshot records that do not fit in the current datagram are carried in the next snapshot packet.

Relevance:

- `none` (default): 1 for every entity. Items go out by accumulated age. This is the mode for vote-driven text adventures and board games.
- `game`: the host calls `net.setFocus(playerId, x, y)`.
- `avatar`: the host finds that player's avatar (`avatarType` + `avatarOwnerKey`) and clamps a client `setFocusHint` to `focusClamp` world units around it.

`game` and `avatar` use a spatial grid. Relevance is `1 / (1 + chebyshev cell distance)`. It is never zero, and K forces a send anyway, so a far dirty entity cannot starve.

Deltas are absolute field values, not additive. A client applies an update only onto the baseline version the packet names, and only if the new version is newer, so a duplicate or a reorder cannot stick a stale field. Defaults (`x = 0`, `y = 0`, `rotation = 0`, `scale = 1`, `anim = 0`, `animStart = 0`, empty custom) are omitted from the spawn baseline. The late-join snapshot is the full set of non-default values, chunked so each datagram still fits the budget. A client that receives it gets exactly the host's current networked state, not the history of events. Records that do not fit are carried in the next snapshot packet.

Acks use a sequence number plus a 32-packet bit window, carried on every packet. State sequence 0 is reserved.

## Custom values

JSON scalars, arrays, and objects. A changed key is sent whole. Key names travel with the value as a length-prefixed string, not as an id in a side string table: an unreliable delta must still decode if it arrives before any reliable dictionary message. Decode builds objects with `Object.create(null)` and rejects `__proto__`, `constructor`, and `prototype`.

Strings are user content. On the receiving side they are `{ text, userContent: true }`, not bare strings, so a shell can refuse to treat them as HTML or code. The host keeps the plain string the game wrote.

Keys must be declared in the manifest (`custom`, `inputs`, `events`). The schema checks ranges before `update` and before `emit`. Integers and the transform fields are quantized; custom numbers are `i32` or `f32`.

`net.random()` is a mulberry32 stream seeded by the session seed (the welcome message carries it). Call order matters. It is for host `update`. `net.time` is seconds of the host clock (`tick / tickHz`).

`render` receives a deep copy. In dev mode (the default) `set`, `deleteProperty`, `defineProperty`, and `setPrototypeOf` throw `render state is read-only`. With `dev: false` the copy is frozen. Dev-mode render is about 2 ms per frame at 500 entities with custom data. That cost is the deep copy plus the proxy, and it is acceptable for local play.

## Mediator

`createMediator({ now, caps, onDisconnect }).wrap(transport)` checks each datagram. Byte, spawn, and join windows are kept per peer and per direction. `seenSpawns` is the set of live entity ids: a spawn adds an id, a despawn removes it, and a finished snapshot replaces the set. The entity cap is that live count, not the number of spawns since the process started. Spawns are counted once per id, at the source, not once per recipient.

The 64 KiB/s per-peer cap is what makes the measured ~163 KiB/s host uplink (about 24 KiB/s on each of seven links) fit. Only host `spawn`, `snap`, and `despawn` messages may exceed that byte window. Every other outbound reliable message, including a relayed event, stops at 75% of the cap so at least a quarter of the link stays available for unreliable state. Outbound reliable traffic over 2× the cap (128 KiB/s) for more than one second disconnects that peer (`reliable_ceiling`).

A relayed event is charged to the sender's inbound byte window, including the fan-out, and to a per-sender relay window of `bytesPerSecond / 8`. Over that limit the event is not forwarded and `onDisconnect(peerId, code)` runs. The library does not drop the peer by itself. The host page must wire it:

```js
const mediator = createMediator({
  onDisconnect(peerId) {
    host.dropPeer(peerId);
  },
});
```

`host.dropPeer` removes that peer. It also calls `transport.forget(peerId)` when the wrapped transport provides it, and `close` sends `bye` (from a client as well as the host) so the mediator drops that peer from `joined` and deletes its lane. A hello occupies a lane but does not count as joined. The peer is joined only when the host sends `welcome`. A hello that is not accepted is evicted after 1.5 seconds, so a run of rejected hellos cannot hold the 64 lanes the way a joined peer can. A lane with no traffic for 10 seconds is evicted even if the peer had joined. When every lane is still in use, a new peer id is refused and the violation `lanes` is recorded. Fan-out for relayed events counts only peers still in `joined`. Pass the manifest to `createMediator({ manifest })` so `caps.maxEntities` is taken from `manifest.maxEntities`. An explicit `caps.maxEntities` that disagrees with the manifest throws at startup. Unreliable traffic over the cap is dropped and resent by the normal ack loop. `inspect(bytes)` is the same check. The walk also rejects event names longer than `maxName` and event payloads over `maxEventBytes`.

Protocol version is 2.

`@osh/net-core/src/wire.js` is the only module that imports `@osh/net-wire`. The codec would otherwise be imported from enough call sites to trip the fan-in gate. The file is a barrel on purpose.

Peer events are delivered only when the name is in the manifest and the payload matches. They are relayed to other peers only when that event sets `relay: true`. Event strings decode as `{ text, userContent: true }`. Each join gets an epoch. The dedupe key is origin plus epoch plus id, a sliding window of 64, and a new epoch resets that window on the host and on every client. The host replaces `origin` with the joined player's id.

Entity ids are a `u32` counter that is never reused. A despawn does not hand that id to a later spawn, so a packet still in flight cannot be applied to the wrong entity. `world.spawn` throws `entity cap is N` at the manifest's `maxEntities` (default 400) before the entity exists.

A client resends hello until it is welcomed or rejected. If the page does not pass `seed`, the host draws one with `crypto.getRandomValues` and sends it in the welcome, so `net.random` is not the same sequence in every session.

The host loop is not running in a Worker. `@osh/net-core` does not touch the DOM. Moving `step` into a Worker is a hard prerequisite before a real WebRTC host ships: a background tab throttles timers to about 1 Hz and would stall the room. It is not done in this change.

## Deviations

- Key names are inline strings, not a session dictionary. A dictionary id would be unreadable if the unreliable packet won the race against the reliable definition.
- Anim ids are `uint16`. The game maps names to ids.
- Custom keys, inputs, and events must be declared in the manifest. Undeclared keys are not synced.
- Clients speak only to the host.
- Property tests use a seeded in-repo generator, not a third-party property library.
- `net.tick` is exposed so a game can stamp `animStart`. The host also stamps it when `anim` changes and `animStart` does not.
- Decoded strings are `{ text, userContent: true }`. The sending game still holds a plain string.
- The host renders the latest tick. Clients interpolate. There is no client prediction.
- Inputs older than `max(inputRedundancy, tickHz * 2)` ticks are dropped. That is about two seconds at the default tick rate.
- The mediator's custom-size cap is per encoded custom payload (a spawn, a snapshot record, or a state delta), which is the unit that hits the wire.
