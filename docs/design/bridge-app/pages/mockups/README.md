# Bridge pages: approved sheets

[Interactive screens](index.html?tools) use the agreed home/conversation relationship and Thomas's [look-and-feel reference](../../reference/look-and-feel.jpg). Thomas approved the detailed design and these sheets at commit `0f9b5f74`, with one naming requirement: show **Aeolus** to the person. He explicitly said no redraw was needed. The images retain their original Bridge and proposal labels; the [approved design and naming requirement](../README.md#user-facing-name) take precedence for the build. See the [seven #260 dispositions](../README.md#the-seven-260-dispositions-approved).

## Before and after

[Comparison gallery](comparison.html) places the current home, open question and Done beside their proposed presentations. For a quick image comparison, open the [phone home pair](phone-home-comparison.png) and [phone question/conversation pair](phone-question-comparison.png).

Before images capture this branch's existing application, whose production code is unchanged from `3190d8ac`, in Chromium with a local API stand-in and fictional data. They are not reconstructions from the old mockup kit. Question screenshots open a real current question control. The stand-in supplies no real sign-in or fleet data. After images render the proposed HTML/CSS in Chromium at 1x. Fonts are embedded Geist, icons follow the Aeolus design system, and the mark comes from aeolus-fleet `brand/aeolus-mark-slate.svg`. The proposed fleet panel renders the actual `Harbour` part from `@aeolus-fleet/ui` 0.38.0 with fictional data; `harbour.css` is its generated stylesheet from the current app. It is not a new fleet component.

| Width | Before | After |
| --- | --- | --- |
| Phone, 375 × 900 | [Home](before-home-375-light.png), [question](before-question-375-light.png), [Done](before-done-375-light.png) | [Home](after-home-375-light.png), [conversation with question](after-conversation-375-light.png), [Done](after-done-375-light.png) |
| Laptop, 1440 × 900 | [Home](before-home-1440-light.png), [question](before-question-1440-light.png), [Done](before-done-1440-light.png) | [Home](after-home-1440-light.png), [conversation with question](after-conversation-1440-light.png) |
| Wide, 1920 × 900 | [Home](before-home-1920-light.png), [question](before-question-1920-light.png), [Done](before-done-1920-light.png) | [Home](after-home-1920-light.png), [conversation with question](after-conversation-1920-light.png) |

Every linked sheet has a dark counterpart: replace `-light.png` with `-dark.png`. The comparison gallery includes both themes and all three widths, including Done.

## Additional phone sheets, both themes

The URLs below show the HTML state; corresponding `after-<state>-375-light.png` and `after-<state>-375-dark.png` files show its rendered image.

| State | What it establishes |
| --- | --- |
| [Step](index.html?state=step) | Optional note visible before Done or Cannot; link names its outside host |
| [Basket](index.html?state=basket) | Unsent answers, Change, Remove and explicit Send |
| [More](index.html?state=more) | Awareness, Done, settings and argo for an account allowed as argo |
| [Busy home](index.html?state=busy), [all waiting items](index.html?state=waiting) | 20 questions/actions and 20 messages across conversations; overview previews lead to the bounded list. The sample ends at 20 of 20; a next-page control is offered only when another page exists |
| [In basket](index.html?state=in-basket), [putting](index.html?state=putting) | Still unsent and waiting; immediate feedback while storing the entry |
| [Answered elsewhere](index.html?state=answered) | The same question shows its Slack answer in the conversation; no second response control |
| [Withdrawn](index.html?state=withdrawn) | Already-open question stays read-only; overview removal follows its existing rule |
| [Send refused](index.html?state=send-error) | Choice/note preserved, inline reason and retry |
| [Empty](index.html?state=empty), [loading](index.html?state=loading) | No waiting work while context remains reachable; skeletons preserve the coming shape |
| [Record error](index.html?state=error), [partial](index.html?state=partial) | Reason and retry; one failed part does not hide the usable parts |

The HTML offers a small simulated path from question to pending and outcome, or to the unsent basket; it calls no fleet or gateway API and sends no messages. It is a screen prototype, not a working implementation. Other controls communicate the proposed design; their real behaviour is defined in the detailed design and existing agreements. Use `?tools` for the state selector and theme switch.

## Approved acceptance criteria

- Preserve one item and outcome across home, conversation, awareness, Done, basket and other clients. Core's scope and reach remain authoritative.
- Opening from home, an additional view or an item address reaches that item in its ship's conversation; Back returns to the origin. Refresh and live updates keep the item address and reading position.
- Keep direct Send and putting in the basket as #202 specifies. Do not make a question's ordinary chat reply silently choose an option. Steps send Done/Cannot and the optional note immediately.
- Apply the seven #260 dispositions in the detailed design explicitly. The new navigation is approved; earlier navigation suggestions were not approved.
- Ready, busy, success, refused, empty, loading, record failure and partial failure retain the meaning shown here. Controls give immediate pending feedback, preserve input on failure and show a durable outcome on success.
- Use the look-and-feel reference with the real Aeolus mark, ship names and design-system icons, including accessible names and visible focus. No fictitious meeting controls appear ahead of #279.
- Reflow from 360 to 2560 px. Check the three drawn widths, both themes, long content, keyboard focus, reduced motion and phone keyboard appearance in the build.
- #287 must establish complete two-way history and bounded context reads through the public contract before building the conversation behaviour. These sheets do not approve new core functionality or a payload copy.
