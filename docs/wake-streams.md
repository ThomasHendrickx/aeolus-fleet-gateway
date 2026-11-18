# Gateway lease wake streams

The gateway holds one REST server-sent event stream at `GET /api/v1/ship/wakeups` for each lease it crews. It presents that lease's crew token as Bearer authorization. The stream carries hints to look, never messages or deliveries. The fleet's durable reads remain the only way to take work.

| Lease | Look on a wake, including the opening wake |
| --- | --- |
| Person ship | `inbox`, then notify pages when its count changed and wake the person when it rose |
| Outside MCP server or A2A agent proxy ship | `pushReceive`, then hand the deliveries over under the concurrency and retry rules |
| Outside MCP or A2A client proxy ship | `receiveReply` for its outstanding calls, then store each reply before acknowledging it |
| Gateway's own ship in each served fleet | `receive`, then pong pings and acknowledge other messages |

The argo inbox uses a separate `GET /api/v1/fleet/events` stream per connected served fleet, authorised by the gateway ship's crew token with `fleet:read` and its read reach (long-poll W5). Each event or resync hint, and every successful open or reconnect, wakes the serialized inbox follower to read `fleet.follow` at once from its stored sequence. Reconnects send the last stream id as `Last-Event-ID`. The two-second inbox round stays as a safety look for missed wakes; the gateway never follows argo's crew stream.

Client replies stay on their client's proxy ship (Q9 a). No additional gateway ship is created for A2A. A blocking A2A call uses its own timer, bounded by the capability's `waitMs` and the gateway's maximum. It reads the stored task while waiting and returns the same task state at the deadline, even while a stream or fleet call is slow or unavailable.

A successful local person claim or acknowledgement requests another inbox look through that lease's queue and publishes an inbox hint through the gateway's database change channel. The instance holding the person's waiter lock reads that hint too, so a request handled by another instance refreshes the count. Inbox reads send neither `waitSeconds` nor `knownWaiting`. Saving a new client call requests a reply look after the save, so a reply whose wake arrived before the call was stored is found.

Looks for one lease run serially. Wakes received during a look coalesce into one more look; another fleet or ship has its own stream and queue. A safety hint requests a look after five minutes without a wake or local hint. Retried party handovers and person wake windows keep their own timers.

The reader consumes fragmented SSE as bytes arrive. Comments keep the connection alive but do not request looks. A closed or failed stream, a refused opening (including `FLEET_BUSY`), or sixty seconds without bytes causes a reconnect after a random one to five seconds. Consecutive failures double that delay up to sixty seconds; a wake restores the initial spread. An opening refused with `401 LEASE_ENDED`, or an `end` event carrying `LEASE_ENDED`, stops that lease. Other 401 responses retry with the reconnect backoff.

The gateway reconciles its own connections at startup and during its worker rounds. Disabled, disconnected or replaced leases close their streams. Person waiters retain their database locks, so only the instance holding a person's lock opens its stream; a disabled fleet stops those waiters on reconciliation. Party workers close their streams when stopped or when outside parties are switched off. The start of shutdown aborts every stream and clears safety and reconnect timers, before waiting for other workers to finish; later opening attempts stay closed. After a restart or reconnect, the opening wake causes a durable read, which finds deliveries stored while the stream was down.

The gateway sends no input to shorten the server waits of `receive`, `pushReceive` or `receiveReply`.
