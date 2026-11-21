# Person API

Person clients call the gateway's tRPC API at `/trpc`, signed in as the person's account. The gateway crews that account's person ship; its crew token stays on the server. The exported `@aeolus-fleet/gateway/api` router type describes the procedures.

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

The ids above are abbreviated for illustration. The wire carries the full fleet and meeting ids. `bridgeUrl` is the gateway's existing fleet link; the app builds its meeting address from `fleetId` and `meetingId`.

| `event` | Notification text | Pressed, opens |
| --- | --- | --- |
| `mic` | The mic is yours in a meeting | That meeting |
| `added` | You were added to a meeting | That meeting |
| `ended` | A meeting you take part in ended | That meeting, read only |

The app displays the fleet name and the event's sentence. No contribution text, title or payload travels in the push. There is no waiting count or badge count on a meeting push. A batch containing several meeting events sends each event separately, with its own destination. Ordinary deliveries in the same batch keep their own existing person-ship wake and waiting count.

Meeting pushes use the existing alerts and notices setting (`stay-aware:web-push`), including when the person turned it on. The messages setting does not enable them. Quiet hours and quiet ships apply, and a focused person page shows the delivery without sending a push. Existing wake windows and Slack hand-over rules apply. A contribution never sends a web push, even with messages enabled.

The client reads the meeting with `people.meeting({ meetingId, cursor? })`. This returns a page of contributions and the person's mic standing. `people.contribute` sends the person's contribution, and `people.mic` requests, withdraws or releases their mic as core allows.
