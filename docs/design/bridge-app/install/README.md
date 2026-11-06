# Installing Aeolus

Design for [#267](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/267), the second part of the [approved Bridge app order](../README.md#3-parts-and-order). The person sees **Aeolus**, never Bridge ([naming requirement](../pages/README.md#user-facing-name)); Bridge names this part of the gateway in code and design only. This document holds the proposed purpose and the lessons to check it against. Detailed design and screens follow once Thomas approves the purpose.

## Purpose, proposed

A person adds Aeolus to their phone's home screen or their computer's desktop and dock, from the browser they already use, without an app store. They then open it like any other app: its own icon and the name Aeolus, its own window without browser bars, straight onto the home the [pages design](../pages/README.md) approved.

Installed Aeolus is the same Bridge at the same addresses, reading the same record. It holds no copy of the person's questions, steps or messages, and it adds no second app to build or keep up. Signing in from the installed app brings the person back into the installed app, onto the page they asked for, in their fleet.

Installation earns its place by what it enables. On iPhone, a web app receives push only once it is added to the home screen, so installation comes before [push that opens its item (#268)](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/268), which waits for [notification preferences (#269)](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/269). Installing alone turns on no new notification.

Not in this part: app store or native wrappers, working offline with the record, the content of push, and what pushes when.

## Lessons to check against

The [app design's lessons](../README.md#2-lessons-to-check-against) apply. These are the ones installation meets most directly, with what the gateway does today.

| What went wrong, was learned or exists today | What the design must check against |
| --- | --- |
| Thomas: "We dont show Bridge, we show Aeolus". Pages are titled `Bridge · Aeolus` today (#285), and the installed window and app switcher show the app's name and page title | The installed app's name, icon label and window title say Aeolus. Decide the page title in the installed window explicitly rather than inherit `Bridge · Aeolus` |
| #286 took the favicon and logo from aeolus-fleet `brand/`; `web/app/icon.svg` and `apple-icon.png` exist, no manifest does | The app icon comes from `brand/`, drawn for each home screen and dock shape (rounded, masked, dark), not a new mark |
| [#282](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/282): an open item lost its address on a page re-read | Opening the installed app, reloading it, and opening an item address in it keep the addressed item. A link from Slack or mail on iPhone opens the browser, not the installed app: say where the person lands and how they reach the app |
| Sign-in goes to pagasae, another origin, and returns to `return_to` through `/sign-in/done`. On iPhone an app added to the home screen keeps its own cookies apart from Safari | Signing in from the installed app returns into it, to the asked page. A person signed in in Safari is not signed in in the home screen app; the first open says so plainly and signs them in once |
| [Navigation design](../../../../design/bridge-navigation/README.md): opening another app's pages from Bridge switched the layout completely | Leaving Aeolus for the Account app or an outside link from the installed window is visible, and the way back into Aeolus is clear |
| Bridge's addresses carry the fleet (`?fleet=`); a person may belong to more than one fleet | The installed app opens the fleet the person chose, and changing fleet stays possible inside it |
| A service worker already exists: `web/public/wake-worker.js` shows a wake and opens Bridge when pressed (wake a person, W4, W8), registered from Settings with the browser's consent | Use the existing worker and its consent rule; do not add a second worker or ask notification permission on install. A refused or missing permission leaves the installed app fully useful |
| The gateway's console pages share Bridge's origin | The installed app is Aeolus for the person, not the gateway's console. What opens inside the app window and what opens in the browser is decided, not left to the browser |
| Aeolus's promise: no message is ever lost | With no connection, the installed app says so and that nothing is lost, rather than showing a stale copy or a browser error page |
| [Decision 0073](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/decisions/0073-bridge-stays-in-the-gateway.md) and decision 0013 | New code goes in `bridge/` behind its lint boundary. No compatibility layers or paid-product polish: installation is the browser's own, with the least Aeolus adds to it |

## Questions for Thomas

### 1. Does the purpose describe what installing Aeolus is for?

Asked on Bridge. Context: #267 makes Aeolus installable without an app store, and comes before iPhone push. This confirms the purpose before the install path, icon, sign-in return and offline screen are designed.

1. **Agree with this purpose.** Phone and desktop, the same Bridge at the same addresses with no content copy, opening onto home or the addressed item, sign-in returning into the installed app, no new notification on install, nothing offline beyond saying so.
2. **Phone first.** Only the phone home screen now; desktop installation becomes its own issue.
3. **Also read offline.** Installed Aeolus keeps the last record it read and shows it without a connection, marked as possibly out of date.
4. **None of these.** Say what installing Aeolus is for.

**Pick: 1.** It gives the app a familiar place on phone and desktop for the cost of the browser's own install, unblocks iPhone push, and keeps one record with no stale copy against the promise that nothing is lost.
