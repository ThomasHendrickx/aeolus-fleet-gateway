# Person API

Person clients call the gateway's tRPC API at `/trpc`, signed in as the person's account. The gateway crews that account's person ship; its crew token stays on the server. The exported `@aeolus-fleet/gateway/api` router type describes the procedures.

`people.meetings` and `people.meeting` include `personShipId` once in each answer. Compare it with a meeting's owner, moderator and mic holder ship ids to identify the person's roles.

## One reachable ship

`people.lookup({ name })` or `people.lookup({ id })` reads one ship for a conversation header. Supply exactly one nonempty name or valid ship id. The answer is `{ id, name, description }`, where `description` may be null. A missing ship and a ship outside the person's current send reach both answer null, revealing no ship outside that reach. Core refusals surface as API errors with their code and message.

The gateway makes one bounded `ship.lookup` read with the person's crew token, without discovery, a ship list or the full statement. Core's `messages:send` scope and current network rules decide visibility. The read keeps no cached copy and marks nothing seen. It stays a single-resource read at the fleet scale target of 3,000 ships and 10,000,000 messages.

The lookup requires core/common 0.44.0 or later. The gateway requires 0.46.0.

## Agent meetings

`people.meeting({ meetingId, cursor?, callId?, progressCursor? })` carries core's meeting read: `goal`, `endsAt` and `endAfterCalls`, plus `call` (null before the first call). Without `callId`, core returns the latest round; pass it to read a particular round or keep the same round while paging progress. The call includes its answers, late answers, expected, silent and not-asked ship ids, deadline, opening and closing times, and `progress.items` with each expected ship's delivery progress, crew `status`, reported `turn`, delivery and acknowledgement times. Call fields use core/common's shared contract and ISO 8601 timestamps.

The gateway makes one core read with the person's own crew. Contributions and expected-ship progress each have a fixed 20-row page and independent cursors. Pass the contributions' `nextCursor` as `cursor`, and `call.progress.nextCursor` as `progressCursor`, retaining `callId`. No per-ship reads, discovery or whole-fleet lists are needed at the scale target of 3,000 ships and 10,000,000 messages. Answers belong to core's complete collected round; progress alone is paginated.

Core allows a person reached by the owner to read before joining. `people.rejoinMeeting({ meetingId })` joins for the first time as well as rejoins after leaving, on the owner's reach. Reading and joining leave the moderator and open call in place. The gateway adds no participation or reach policy.

`people.closeCall({ meetingId, callId })` closes the named call as the signed-in person. Core requires that person to be present, preserves answers and recorded silence, marks pending ships in `notAskedShipIds`, and delivers one collected round to the moderator. Success is `{}`; read the meeting with that `callId` for the resulting round. A repeated close succeeds without another collected round. Core's refusal code and reason pass through as API errors. These calls require core/common 0.46.0.

## Person record

The gateway owns the person's record of arriving contributions and what that person has seen per meeting. Contributions sent before the counting release count as seen.

The database migration's start time is the shared counting boundary for every gateway instance and restart. On receipt, the gateway notes each contribution by fleet, person ship, meeting and message id before acknowledging its delivery and exposing it. Repeated receives do not count it again. The record keeps ids and seen state, never contribution payloads.

`people.unseenContributions({ meetingIds })` returns `[{ meetingId, count }]`, including zero, for up to 20 meetings. It reads the person's indexed gateway record, without receiving or scanning deliveries or reading meeting history. A person with no person ship is refused. Every device reads the same durable state.

`people.unseenMeetings()` returns `[{ meetingId, count }]` for at most 20 meetings with unseen contributions, newest unseen contribution first (by time-ordered message id). No meeting ids or cursor are required. An empty array means nothing is new; a nonempty array enables the Meetings dot and supplies Home's meetings with something new, including ended meetings and meetings beyond the first page of `people.meetings`. It is a bounded summary, not a complete list when more than 20 meetings have something new. Reading it marks nothing seen.

The read uses one grouped query over the gateway's contribution record, with the fleet, person ship and unseen state selected through the existing index, and orders and limits the groups in Postgres. It neither scans meeting pages nor calls core per meeting, and adds no reach. A person with no person ship is refused. After a meeting page is shown, `requests.changes` tells clients to refresh this read as well as their per-meeting counts.

`people.meeting({ meetingId, cursor? })` returns the requested page and marks only the other participants' contributions on that page seen. It records sightings even before the corresponding delivery arrives; later arrival never makes a seen contribution unseen. A refused meeting read marks nothing. Reading one page leaves the other pages unseen. Clients fetch this call when showing the page, since reading marks that page seen. Record changes notify the person's clients through `requests.changes`; replay and repeated sightings do not notify again.

Contributions stay in their meeting. They are outside ordinary inbox items, the home plain-message list, ship conversations, the waiting count and icon badge. Meeting added, mic and ended notices remain outside those counts too. The fleet's delivery record remains available independently; a meeting page records seen state without acknowledging deliveries.

## Meeting pushes

A web push for a meeting carries one destination and one event:

```json
{
  "fleetName": "My fleet",
  "bridgeUrl": "https://gateway.example/bridge?fleet=flt_...",
  "waitsAt": "meeting",
  "fleetId": "flt_...",
  "meetingId": "mtg_...",
  "event": "mic"
}
```

The ids above are abbreviated for illustration. The wire carries the full fleet and meeting ids. `bridgeUrl` is the gateway's fleet link; the app builds its meeting address from `fleetId` and `meetingId`.

| `event` | Notification text | Pressed, opens |
| --- | --- | --- |
| `mic` | The mic is yours in a meeting | That meeting |
| `added` | You were added to a meeting | That meeting |
| `ended` | A meeting you take part in ended | That meeting, read only |

The app displays the fleet name and the event's sentence. No contribution text, title or payload travels in the push. There is no waiting count or badge count on a meeting push. A batch containing several meeting events sends each event separately, with its own destination. Ordinary deliveries in the same batch keep their own person-ship wake and waiting count.

Meeting pushes use the alerts and notices setting (`stay-aware:web-push`), including when the person turned it on. The messages setting does not enable them. Quiet hours and quiet ships apply, and a focused person page shows the delivery without sending a push. Wake windows and Slack hand-over rules apply. A contribution never sends a web push, even with messages enabled.

The client reads the meeting with `people.meeting({ meetingId, cursor? })`. This returns a page of contributions and the person's mic standing. `people.contribute` sends the person's contribution, and `people.mic` requests, withdraws or releases their mic as core allows.
