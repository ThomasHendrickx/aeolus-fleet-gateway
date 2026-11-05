# Bridge: a withdrawn item leaves the overview after 5 seconds

Mockups for [#240](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/240). Not approved yet; once approved they are the acceptance criteria for the build.

Thomas, 5 Nov: "The widrawn questions or statements (anything someone takes back out of the inbox of a user) needs to disappear after 5 seconds. For the Bridge application, when a user has it open, it will remain there but no more actions are possible. Same as what is now. But the item will disappear in the overview and refreshing the screen or clicking somewhere else removes it. --> the same rules apply for argo messages (like I see those for argo as well in my bridge)."

## Purpose

What the asker took back no longer asks anything of the person, so it should not sit in their overview waiting to be cleared by hand. Today it does: a withdrawn or replaced question or step stays in Waiting on you, struck through, until the person opens it, and argo's withdrawn items stay under Waits at argo until someone deals with them in the console.

## Lessons to check against

- **Actions buried in information** (Bridge design, section 3): a list holding struck-through rows the person must clear is information in the way of what asks for action.
- **Bridge always keeps the record** (CC4): leaving the overview is not leaving the record; the item is in Done with what came of it.
- **Places are views of one record** (CC7): when an item leaves Bridge's overview, a chat's inbox and Slack's post must not still show it as open.
- **The basket, approved** (section 9, 5): a withdrawn entry in the basket is marked and skipped by Send; that stays as approved.

## Today, as built

| | Overview row | Open | Leaves |
| --- | --- | --- | --- |
| The person's question or step, withdrawn | Struck through on muted ground: "Withdrawn by orchestrator-1 at 20:09 UTC: open it to clear it", Open | Read-only: "Withdrawn by orchestrator-1 at 20:09. Nothing to answer: it is done." Opening marks it done | Only once opened |
| Replaced | Struck through: "Replaced by … with “…”", Open the new step, Open | Read-only, with Open the new question or step | Once it or its replacement is opened |
| argo's question, withdrawn | Struck through: "Withdrawn", Answer in the console as argo | Opens the console | Only once done at argo, in the console |

## Drawn

| | After |
| --- | --- |
| 0 s, the withdrawal reaches Bridge | The row turns struck through as today, outside every count. It no longer says "open it to clear it". A replacement is a new item on top |
| 4.7 s to 5 s | The row fades and its height closes in 300 ms (the design system's slow duration); with reduced motion it goes at 5 s at once |
| 5 s and later | Gone from the overview: the person's list, the list beside an open item, and Waits at argo, on the desktop and on the phone's tabs. No count changes; it was outside every count from 0 s |
| Open when withdrawn | Stays open, read-only, as today; gone once the person opens something else, goes elsewhere or refreshes |
| Bridge not open at the withdrawal | Never shows it |
| Done | Holds it: "Withdrawn by orchestrator-1", "Withdrawn by builder-gateway, replaced by “…”", as an opened one is today |

| File | What it shows |
| --- | --- |
| [wide.html](wide.html), [wide.png](wide.png) | 1920 × 1080: before, 0 s, 4.7 s, 5 s, open when withdrawn, Done; light and dark |
| [laptop.html](laptop.html), [laptop.png](laptop.png) | The same at 1440 × 900 |
| [phone.html](phone.html), [phone.png](phone.png) | 375 × 780: the Waiting tab and the argo tab, before, 0 s, 4.7 s, 5 s; the open question; light and dark |

Drawn in the kit of [`../bridge-fleet-width`](../bridge-fleet-width) (the approved Bridge sheets' Compact look, tokens and Geist fonts inlined); each PNG is its HTML in Chromium at 1x. A purple tag names the moment drawn and is not part of Bridge.

## Questions

1. **"Statements".** Only questions and steps can be withdrawn or replaced in the fleet's protocol; alerts and notices cannot. Drawn: "statements" read as steps.
2. **Who ends a withdrawn item of the person's.** Drawn: the gateway marks it done when it leaves, 5 s after the withdrawal reached it, so Done holds it and a chat's inbox drops it. Without that, it would stay seen-not-done in the fleet forever.
3. **argo's withdrawn items.** Drawn: they leave Bridge's view only; they stay in argo's inbox in the console until done there. The alternative, the gateway marking them done at argo, acts for everyone allowed as argo.
4. **From when the 5 s count.** Drawn: from when the withdrawal reaches Bridge, not the time it was sent, so a late one still shows for 5 s.
5. **The basket.** Unchanged, as approved: a withdrawn entry stays marked in the basket until Remove or Send.
