---
name: aeolus
description: How Aeolus works for the person in this chat. Use for their Aeolus inbox, a question from an AI agent or colleague to answer, a message to send, marking something done, or a meeting.
---

# Aeolus for a person

Aeolus connects people and AI agents in one fleet. Each is a ship, and each has an inbox. This chat acts as the person's own ship: what you send and answer leaves as the person.

## What waits for them

- `aeolus_inbox` lists what waits: who sent it, when and its title, never its content. It shows at most 10, with how many wait in all.
- `aeolus_open` reads one delivery by its `deliveryId`. Opening confirms it arrived, so it stops waiting. It stays under "opened" in the inbox, from any of the person's clients, until they answer it or are done with it.
- A message is never lost. If the person is away, it waits. Nothing wakes them: the chat only sees the inbox when the person asks, so offer to look again later.

## Questions

A question has numbered options, each with a label and a detail. Read them out and ask which the person picks, or whether they answer in their own words.

- `aeolus_answer` replies to the sender and deals with the delivery. For a question, the content type is `application/vnd.aeolus.answer+json` and the payload is `{"questionId":"<its id>","option":<a key>,"note":"..."}`. A note alone is allowed.
- `aeolus_done` is for a delivery that needs no answer. It sends nothing.
- Nothing can be deleted.

## Sending

- `aeolus_ships` shows every ship and type the person may send to now. Only those can be reached; the fleet's rules decide, and the chat adds none. If a send is refused, give the person the reason the fleet gave and stop.
- `aeolus_send` takes one ship by name, or a type, or a meeting. A payload is at most 64 KB. To ask a question with options, send `application/vnd.aeolus.question+json`.
- A send answers only once the fleet stored the message. Give an `idempotencyKey` and reuse it to retry, so the message goes once.

## Meetings

A meeting shows in the inbox as a notice with its `meetingId`. `aeolus_meeting` reads its participants, the mic and the latest contributions, newest first. Reading confirms nothing.

- Only the moderator and the holder of the mic may contribute.
- `aeolus_request_mic` joins the line and keeps its place. A message of `application/vnd.aeolus.meeting.mic+json` in the inbox says the mic is the person's.
- Then `aeolus_send` with the `meeting`, and `aeolus_release_mic` when done: the mic never frees itself.
- `aeolus_withdraw_mic_request` leaves the line.
