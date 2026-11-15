# Gateway lease wake streams

The gateway holds one REST server-sent event stream at `GET /api/v1/ship/wakeups` for each lease it crews. It presents that lease's crew token as Bearer authorization. The stream carries hints to look, never messages or deliveries. The fleet's durable reads remain the only way to take work.

| Lease | Look on a wake, including the opening wake |
| --- | --- |
| Person ship | `inbox`, then notify pages when its count changed and wake the person when it rose |
| Outside MCP server or A2A agent proxy ship | `pushReceive`, then hand the deliveries over under the existing concurrency and retry rules |
| Outside MCP or A2A client proxy ship | `receiveReply` for its outstanding calls, then store each reply before acknowledging it |
| Gateway's own ship in each served fleet | `receive`, then pong pings and acknowledge other messages as before |

Client replies stay on their client's proxy ship (Q9 a). No additional gateway ship is created for A2A. A blocking A2A call still uses its own timer, bounded by the capability's `waitMs` and the gateway's maximum. It reads the stored task while waiting and returns the same task state at the deadline, even while a stream or fleet call is slow or unavailable.

A successful local person claim or acknowledgement requests another inbox look through that lease's queue and publishes an inbox hint through the gateway's existing database change channel. The instance holding the person's waiter lock reads that hint too, so a request handled by another instance refreshes the count. Inbox reads send neither `waitSeconds` nor `knownWaiting`. Saving a new client call requests a reply look after the save, so a reply whose wake arrived before the call was stored is still found.

Looks for one lease run serially. Wakes received during a look coalesce into one more look; another fleet or ship has its own stream and queue. A safety hint requests a look after five minutes without a wake or local hint. Retried party handovers and person wake windows keep their own timers.

The reader consumes fragmented SSE as bytes arrive. Comments keep the connection alive but do not request looks. A closed or failed stream, a refused opening (including `FLEET_BUSY`), or sixty seconds without bytes causes a reconnect after a random one to five seconds. Consecutive failures double that delay up to sixty seconds; a wake restores the initial spread. An opening refused with `401 LEASE_ENDED`, or an `end` event carrying `LEASE_ENDED`, stops that lease. Other 401 responses retry with the reconnect backoff.

The gateway reconciles its own connections at startup and during its existing worker rounds. Disabled, disconnected or replaced leases close their streams. Person waiters retain their database locks, so only the instance holding a person's lock opens its stream; a disabled fleet stops those waiters on reconciliation. Party workers close their streams when stopped or when outside parties are switched off. Shutdown aborts streams and clears safety and reconnect timers. After a restart or reconnect, the opening wake causes a durable read, which finds deliveries stored while the stream was down.

This is gateway slice W5 of the [approved long-poll design](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/design/long-poll/README.md). Core calls retain their existing server waits until W8: the gateway adds no new input to shorten `receive`, `pushReceive` or `receiveReply`. Its minimum core remains 0.38.5, which already includes the W1 wake stream.
