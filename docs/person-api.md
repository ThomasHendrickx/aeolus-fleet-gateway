# Person API

Person clients call the gateway's tRPC API at `/trpc`, signed in as the person's account. The gateway crews that account's person ship; its crew token stays on the server. The exported `@aeolus-fleet/gateway/api` router type describes the procedures.

`people.meetings` and `people.meeting` include `personShipId` once in each answer. Compare it with a meeting's owner, moderator and mic holder ship ids to identify the person's roles.

## Person record

The gateway owns the person's record of arriving contributions and what that person has seen per meeting. Contributions sent before the counting release count as seen.

The database migration's start time is the shared counting boundary for every gateway instance and restart. On receipt, the gateway notes each contribution by fleet, person ship, meeting and message id before acknowledging its delivery and exposing it. Repeated receives do not count it again. The record keeps ids and seen state, never contribution payloads.

`people.unseenContributions({ meetingIds })` returns `[{ meetingId, count }]`, including zero, for up to 20 meetings. It reads the person's indexed gateway record, without receiving or scanning deliveries or reading meeting history. A person with no person ship is refused. Every device reads the same durable state.

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
