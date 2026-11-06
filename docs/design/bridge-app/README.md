# Bridge as the app

Purpose and proposed parts for [#265](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/265). Thomas approved the purpose and the parts in the proposed order (questions 1 and 2, option 1 for each). The next part is #266, including #260: its detailed design and screens need approval before its build.

## 1. Purpose

Bridge is the app in which a person works with their fleet: see what needs their decision or action, answer with context, see how their ships are doing, and read back what happened. Making Bridge an app means making that place convenient to return to on phone and desktop, telling the person something waits when they are elsewhere, and opening the item concerned. Conversations with ships and meetings get views suited to those jobs.

This carries forward [Bridge's approved purpose and jobs](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/design/bridge/README.md), rather than replacing them. Thomas first, built for every person ship: a person owning a busy fleet, someone working in a chat, and someone with no AI chat open all need to keep work moving.

| The person's job | What the app should make easy | Why use Bridge for it |
| --- | --- | --- |
| Decide | Find the question, understand its context, choose an answer and send the basket | The decision stays visible until answered, with explicit controls and an outcome that can be read back |
| Do what only a human can | Open a step's link, finish it or say Cannot, with a note | The person sees exactly what is needed and what their response sends |
| Direct and converse | Send work to a ship, follow the exchange as a chat, and return to its context | The person can act directly, without asking a model to interpret every action; separate messages should not make every reply feel like new mail |
| Take part in meetings | Find the meeting, its participants, contributions and mic state in a separate view | Meeting notices and controls belong with the meeting, rather than cluttering the person's chats |
| Stay aware | See ships' state, alerts and notices; choose what calls for a push | A chat runs when the person writes; an app notification can tell them something waits between turns |
| Review output | Open the reference to a PR, design or report, then return to the item that asks for a response | Bridge keeps the request and its outcome together; the output stays where it lives |

Installation gives Bridge a familiar place on the home screen or desktop without an app store ([#267](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/267)). A push should lead to the item it concerns, with the content loaded in Bridge ([#268](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/268)); the person chooses what pushes and when it does not ([#269](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/269)). The app earns its place by completing those jobs, not by being installed alone.

**Other clients stay useful.** Thomas on #265: "WhatsApp is still using the nice distribution channel of whatsapp so no need to say no to that." [WhatsApp remains its own client (#263)](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/263), reaching people where they already are. Slack and an AI chat remain choices too. Each acts as the same person ship on one record; Bridge keeps that record available whichever client the person uses. Push is a way to learn that something waits, not another copy of its content.

**Existing boundaries stand.** [Decision 0073](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/decisions/0073-bridge-stays-in-the-gateway.md) keeps Bridge in the gateway's package and release train, in top-level `bridge/`. New code uses that shape, existing code moves when touched, and shared code stays apart from Bridge and the gateway's doors. There is no rewrite in this purpose. Core still decides scope and reach; the console remains the fleet's admin console.

## 2. Lessons to check against

| What went wrong or was learned | What the design must check against |
| --- | --- |
| Bridge was built far from the approved home mockups. [#260](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/260) records seven visible differences; later mockups drawn from the kit concealed differences from the actual app | Begin #266 with the approved sheets beside what people actually see. Put each unresolved difference before Thomas; neither the kit nor the current build silently settles it |
| [#282](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/282): opening a question briefly put its id in the address, then a page re-read removed it; Messages did not put the id there at all. #241's own tests passed before later changes broke the flow | An open question, step or message must keep its address through page re-reads, refresh and opening the address anew. Check that same flow from a notification, including an item already done or no longer available. #282 is closed and its fix is present; this is a lesson, not proposed duplicate repair work |
| Thomas on [#266](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/266#issuecomment-6671841730), after answering a plain message: "we will need to see how we make this more UX friendly"; "this is nice and functional. Great success!" | Keep the working ability to answer and improve the person's path to it. Functional success alone does not establish that a screen fits a person's job |
| [#287](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/287): "Now messages act as a mail box ... but actually it could just be chats." | Design an exchange as an exchange, with its context visible; do not choose chat grouping or change Done semantics before that part's purpose and questions are answered |
| [#279](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/279): "They will go in a separate view of bridge" | Meetings get their own view. Establish how a person finds a meeting and returns to it; do not turn the meeting's notices into chat clutter |
| [`design/bridge-navigation`](../../../design/bridge-navigation/README.md): outside-party pages switched the layout completely when opened from Bridge | Make navigation and return paths part of #266, including settings and a visible change of app when a link leaves Bridge |
| [`design/bridge-messages`](../../../design/bridge-messages/README.md): plain messages were absent; Thomas asked for a variant with 20 questions/actions and 20 messages | Keep every item reachable and what asks for action distinguishable from information. Later screens must show a busy fleet, not only a nearly empty one |
| [`design/bridge-withdrawn-leaves`](../../../design/bridge-withdrawn-leaves/README.md): withdrawn items sat in the overview until cleared; approved behaviour preserves an already-open item read-only | A changing overview must not lose the person's open context. Withdrawals, replacements, the basket and answers in another client must remain understandable in each new view |
| Approved Bridge design: places are views of one record, Bridge always keeps the record, consent precedes pushing, and an in-focus Bridge page suppresses wakes | Notification preferences extend the person's existing choices. Opening Bridge or answering elsewhere must not create another unanswered copy. A refused notification permission must leave the app useful |

The seven differences from #260 belong to #266, each requiring an explicit disposition:

1. Sidebar head: Bridge mark versus app switcher; outward arrows absent beside Fleets and account.
2. The approved kit's "Search what reached you /" box is absent from the build.
3. Done: narrow card in the kit versus the built card, its explanatory sentence and places icons.
4. Phone tabs: four in the kit, no Done tab, argo as its own pane.
5. Phone home header: no send button in the kit, a send button in the build.
6. Phone question screen: one bar in the kit, two in the build.
7. Open question: the build adds "No option, only the note", "Goes with the answer.", "Send option 1", the places note and "Seen just now".

These are questions about which presentation is right, not permission to remove working behaviour. The approved basket and optional notes remain requirements unless Thomas changes them.

Relevant gateway designs: [pages and sign-in](../../../design/gateway-pages/proposal.md), [chat connector](../../../design/chatgpt-plugin/chatgpt-plugin.md), [inbox state and client setup](../../../design/gateway-inbox-state-and-setup/README.md), [home widths](../../../design/bridge-fleet-width/README.md), [navigation](../../../design/bridge-navigation/README.md), [withdrawn items](../../../design/bridge-withdrawn-leaves/README.md), and [messages](../../../design/bridge-messages/README.md). They supply existing agreements and lessons; an earlier slice does not decide new app behaviour.

## 3. Parts and order

Thomas approved this order. It does not approve the detailed design or build of every part. Each part gets its own purpose, open questions and approved screens before its build. The first part establishes where later parts belong; it does not draw all later parts in detail.

| Order | Concrete part | Issue | What its design must settle |
| --- | --- | --- | --- |
| 1 | Bridge's pages and navigation | [#266](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/266), including [#260](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/260) | The person's paths through what waits, an open item, the basket, awareness, Done, their fleet and settings on phone and desktop. Resolve the seven differences against the actual build and approved sheets; locate chats and meetings without designing their internals |
| 2 | Installation | [#267](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/267) | Opening Bridge from the home screen or desktop; the manifest, icon and service worker; the person's installation path and return after sign-in. The issue requires installation before iPhone push |
| 3 | Notification preferences | [#269](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/269) | What pushes per person and when it does not, including quiet hours, alongside existing routing per job and browser consent. Decide these before new notifications are enabled |
| 4 | Push notifications that open their item | [#268](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/268) | A notification saying something waits, with no item content, opens that item. Include sign-in, page re-reads, refresh, a stale item, denied permission and a failed subscription in the flow |
| 5 | Messages as chats | [#287](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/287) | Following and answering exchanges rather than processing separate mail. Ask how messages form a chat and how its state relates to the shared record before deciding controls or storage |
| 6 | Meetings in a separate view | [#279](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/279) | Finding and returning to meetings, their participants, contributions, mic and ended state, using core's existing meeting rules. Keep this separate from the chats design |

Why this order: establish a usable place and stable navigation, then deliver the installation, preferences and push value Thomas described in #265. Chats and meetings are separate parts that follow in the agreed navigation. Installation precedes iPhone push; preferences precede enabling the new pushes. Chats and meetings follow the installation and notification parts, as approved in question 2.

## 4. Questions for Thomas

### 1. Does section 1 describe what Bridge as the app is for?

**Answered: option 1, approved by Thomas.**

Context: the original Bridge purpose is approved. #265 asks to shape it into a true user-facing interface, add installation, notifications and preferences; #287 and #279 add chats and a separate meetings view. This question confirms the app's purpose before choosing screens or detailed behaviour.

1. **Agree with this purpose.** Carry the existing jobs and one record into an app convenient to return to, with chats and meetings in usable views.
2. **Start with decisions and actions only.** Keep chats and meetings as later work outside this app design.
3. **None of these.** Say which person or job the purpose misses.

**Pick: 1.** It carries forward the approved purpose and connects Thomas's app, chats and meetings feedback while keeping WhatsApp independent.

### 2. In what order should the parts be designed and built?

**Answered: option 1, approved by Thomas.**

Context: approve the structure first, then one part at a time. Section 3 proposes pages/navigation including #260, installation, notification preferences, push to an item, chats, then meetings. All six parts remain in scope; no detailed behaviour is decided by this ordering.

1. **Pages, then installation and notifications, then chats and meetings.** Use section 3's order: #266/#260, #267, #269, #268, #287, #279.
2. **Pages, then chats and meetings, then installation and notifications.** #266/#260, #287, #279, #267, #269, #268. Prioritise everyday conversations before waking the person.
3. **None of these.** Give a different order or change the parts.

**Pick: 1.** Navigation comes first and preferences precede new pushes; the app then delivers the installation and notification value Thomas identified without waiting for both conversation designs.

The seven #260 dispositions, chat grouping, meeting controls, installation details and notification rules are questions for their respective parts after this structure is agreed.
