# Bridge: plain messages to a person show in Bridge

Mockups for [#242](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/242). Not approved yet; once approved they are the acceptance criteria for the build.

Thomas, 5 Nov: "Plain messages send to the user should also be visible in bridge as message, now i only see actions and questions (or I have not yet received any messages)".

## Does a plain message show in Bridge today?

No, nowhere. A delivery to the person ship whose content type is none of the fleet's conventions (a text/plain or text/markdown message) is the job everything else (`src/core/people/item-job.ts`). Bridge home keeps only decide and do in Waiting on you and only stay aware in its feed (`src/core/people/read-bridge-home.ts`), so it drops the message; Done lists only done items, and nothing in Bridge lists the message to open or mark done, so it never gets there. Only a chat lists it, at its next `aeolus_inbox` (routing's default `everything-else:chat`). Bridge can already open such a message and draws it with Your answer, Answer and Done (`web/features/bridge/ui/delivery-card.tsx`); no list leads there.

## Purpose

What a ship tells the person in plain words reaches them where they look, Bridge, with who sent it and what it says, and they can mark it done once read.

## Lessons to check against

- **Bridge always keeps the record** (CC4): every item is in Bridge; today plain messages are the exception.
- **Actions buried in information**: a message asks nothing by convention, so it stays out of the count (Bridge design, section 6: everything else is not in what waits), apart from what waits.
- **A text message cannot be told apart from a conversation** (CC15): what a ship tells without asking should be a notice; a plain message is what remains, read as written.
- **Places are views of one record** (CC7): done in Bridge, the chat no longer lists it.

## Drawn

| | After |
| --- | --- |
| Where | Home, a Messages list beneath Waiting on you, outside the count; on the phone, in the Waiting tab beneath what waits. Gone when no message is left |
| Which | A delivery of text/plain or text/markdown to the person ship. Other unknown types (withdrawals, a reply in a thread) stay in the record only |
| A row | The message icon, a dot while new, its first line as the title with Markdown marks taken off, Message, the sender, the places, its age; two lines of its text; Done in place and Open |
| Done | Marking done... while it goes; then it leaves the list and is in Done ("Done in Bridge"). If the fleet does not answer, the row says so and Done stays |
| Open | Opening marks it Seen: its whole text in Markdown, Your answer, Answer and Done, as Bridge draws an opened message today. Answer sends the text to the sender as the person and the message is done |

| File | What it shows |
| --- | --- |
| [wide.html](wide.html), [wide.png](wide.png) | 1920 × 1080: before; a message arrives; marking done, the failure; done; open, typing, answered, done; Done; light and dark |
| [laptop.html](laptop.html), [laptop.png](laptop.png) | The same at 1440 × 900 |
| [phone.html](phone.html), [phone.png](phone.png) | 375 × 780: the Waiting tab before and after, its states; a message on its own screen; light and dark |

Drawn in the kit of [`../bridge-fleet-width`](../bridge-fleet-width) (the approved Bridge sheets' Compact look, tokens and Geist fonts inlined); each PNG is its HTML in Chromium at 1x. A purple tag names the moment drawn and is not part of Bridge.

## Questions

1. **Where messages show.** Drawn: their own Messages list beneath Waiting on you, outside the count. The alternative: in the Stay aware feed, beside alerts and notices; but those are done once seen, and a message waits for Done.
2. **Which content types.** Drawn: text/plain and text/markdown only.
3. **The row.** Drawn: first line as title, two lines of text, Done in place.
