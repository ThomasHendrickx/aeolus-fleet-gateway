# Gateway pages: three proposals

The gateway's pages, as people see them: sign-in and picking a fleet, a person's own page, waiting for approval at an outside MCP client, pending requests, adding an outside MCP server, and the errors (refused, expired, access_denied). Users see Aeolus, never pagasae. Every proposal uses the console's tokens, tone families and parts (aeolus-fleet `docs/design/README.md`), in light and dark, phone first.

Each proposal has four sheets: `<letter>-phone-light.png`, `<letter>-phone-dark.png`, `<letter>-desktop-light.png`, `<letter>-desktop-dark.png`.

What all three share, from decisions 0054 and 0056 and flows F5, F9 and F10:

- The handshake: the outside party's mark and the fleet's mark side by side (Slack's lesson), so who meets whom is seen, not read.
- Status is a StatusBadge: tone, icon and label. Waiting for approval is the waiting tone with an hourglass; approved is ok; denied and expired are ended, expired with a dashed edge.
- The 7 days a request is kept show as days left (Entra's lesson), in the attention tone on the last day.
- The decision names the owner (a person ship) and the scopes, each scope a row with an icon, its plain label and the scope in mono (GitHub's lesson). `messages:send` and `messages:receive` are locked on, since every app ship gets them (0046).
- An answer to a question is one tap on a button that names what it sends, with the asker's pick on a dashed edge (OperatorInbox).
- Adding an outside MCP server shows the gateway's check: how many tools the server answered with, before it counts as added (F10).
- Errors: one icon, one title, at most one chip, one way on.

## A · Console

The gateway's pages as a small sibling of the operator console: TopBar and TabBar (Inbox, Requests, Outside parties) on phone, Sidebar on desktop. The own page leads with three count tiles (questions, messages, pending), then the list. Pending requests are a table; a request opens in a side sheet on desktop and a full-screen page on phone. Waiting for approval is a vertical list of three steps.

- For: almost every part exists already (ListPage, StatusBadge, Sheet, Table, SignInLayout), so it is the cheapest to build and to keep in step with the console. Familiar to anyone who knows the console.
- Against: it reads like an admin tool. The person with no AI at hand, the very user of the own page, meets console density; rows still lean on short text more than the other two.

## B · Signal

One large shape leads every page: a ring for the time left, a big number for what waits on you. One item in focus at a time, as a card on a stack, decided with two big buttons; on desktop a queue sits beside it. Sign-in is two big tiles (identity provider, sign-in link). Errors are a full ring in the tone, dashed when the request expired.

- For: the most "understood by looking": a glance at the ring or the number tells the state, at any distance and on the smallest phone. Answering one question after another is fast on phone.
- Against: one at a time hides the overview; an approver with many requests wants to scan and pick, and the desktop queue only partly fixes it. Rings and the card stack are new parts outside the design system, and a big ring for every state can feel playful for an approval.

## C · Tracker

Every flow is a row of steps, like a parcel tracker: Sign in, Fleet, Connected for the person; Signed in, Approval, Connected for the human at the outside client; Asked, Decide, Commissioned for the approver; Address, Tools, Owner, Commissioned for an outside MCP server. An error is the same row, stopped where it stopped: a red cross on Fleet for refused, a dashed timer on Approval for expired, a cross on Approval for access_denied. Lists are lanes by state (Waits on you, Messages, Your requests; To decide, Approved, Ended), each card with a tone edge; on phone the lanes are chips with counts.

- For: one picture explains every flow, including the unhappy paths: you see where you are and where it stopped, with no sentence. The same tracker serves sign-in, waiting, deciding, adding and the errors, so people learn it once. Lanes give the approver the whole state of the fleet's requests at a glance.
- Against: the tracker and the tone edge are new parts (small ones, built from StatusBadge tones). Lanes on phone show one lane at a time, so the counts in the chips carry the overview.

## Pick

C. Thomas asked for pages understood by looking, and C is the only one where the unhappy paths are understood by looking too: refused, expired and access_denied are the waiting page with the step that failed, so nobody has to read why. It stays calm enough for approvals, where B's rings feel loud, and it keeps the overview that B gives up. From A it keeps the console's parts for everything inside the tracker and the lanes (StatusBadge, Avatar, Sheet, TopBar, TabBar), so the new parts stay two: the tracker and the tone-edged card.

## Questions

1. The approving scope has no name in the docs yet; the screens never show it, and show the Requests tab only to holders of it. Is that right, or should a person without it see their own requests under Requests too (C puts them in the own page's third lane)?
2. Which scopes may an approver grant to a proxy ship beyond `messages:send` and `messages:receive`? The screens offer `fleet:read` as an example; F9 says only scopes the gateway's ship holds.
