# Installing Aeolus

Design for [#267](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/267), the second part of the [approved Bridge app order](../README.md#3-parts-and-order). The person sees **Aeolus**, never Bridge ([naming requirement](../pages/README.md#user-facing-name)); Bridge names this part of the gateway in code and design only. Thomas approved the purpose (question 1, option 1). The questions below settle the install path before the detailed design and before/after screens.

## Purpose, approved

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
| Bridge shares the gateway's origin today with its console pages; Aeolus moves to `app.aeolus-fleet.dev` | The installed app is Aeolus for the person, not the gateway's console. Links that leave the app's address say so; a gateway page opened from Aeolus opens in the browser |
| Aeolus's promise: no message is ever lost | With no connection, the installed app says so and that nothing is lost, rather than showing a stale copy or a browser error page |
| [Decision 0073](https://github.com/ThomasHendrickx/aeolus-fleet/blob/main/docs/decisions/0073-bridge-stays-in-the-gateway.md) and decision 0013 | New code goes in `bridge/` behind its lint boundary. No compatibility layers or paid-product polish: installation is the browser's own, with the least Aeolus adds to it |

## The app's address

Thomas: "It will live under app.aeolus-fleet.dev". Aeolus has its own address, apart from the gateway's, and its own repository. The installed app is everything under `app.aeolus-fleet.dev` and nothing else: a browser keeps an installed app's window to one address. Sign-in passes through pagasae and returns into the window, through a way back at the app's own address. The gateway's pages (outside parties, console), the Account app and outside links open in the browser, as their outward arrow says.

The purpose's "same addresses" holds within that address: the installed app and the browser open the same `app.aeolus-fleet.dev` addresses. Links to today's Bridge addresses on the gateway are the new repository's concern, not this design's.

The app serves its own service worker at its own address. The gateway's existing wake worker and the browsers subscribed to it stay as they are and can open the app's address from a wake, in the browser. A wake reaches the installed app, and an iPhone at all, only from a subscription made inside the app at its address; making that subscription is #268's, under #269's preferences.

## Questions for Thomas

### 1. Does the purpose describe what installing Aeolus is for?

**Answered: option 1, approved by Thomas.**

Context: #267 makes Aeolus installable without an app store, and comes before iPhone push. This confirms the purpose before the install path, icon, sign-in return and offline screen are designed.

1. **Agree with this purpose.** Phone and desktop, the same Bridge at the same addresses with no content copy, opening onto home or the addressed item, sign-in returning into the installed app, no new notification on install, nothing offline beyond saying so.
2. **Phone first.** Only the phone home screen now; desktop installation becomes its own issue.
3. **Also read offline.** Installed Aeolus keeps the last record it read and shows it without a connection, marked as possibly out of date.
4. **None of these.** Say what installing Aeolus is for.

**Pick: 1.** It gives the app a familiar place on phone and desktop for the cost of the browser's own install, unblocks iPhone push, and keeps one record with no stale copy against the promise that nothing is lost.

### 2. How does a person find out they can install Aeolus?

**Answered: option 1, approved by Thomas.**

Context: Chrome and Edge on desktop and Android offer their own install button in the address bar or menu once Aeolus has a manifest. iPhone and iPad Safari offer none: the person must know Share, then Add to Home Screen, and on iPhone push (#268) needs that. The approved home leads with what waits, so an install ask there competes with it.

1. **Install Aeolus under More and Settings.** An Install Aeolus entry in Settings (More on phone, the sidebar on desktop) shows this browser's way: the browser's own install prompt where it has one, the Share then Add to Home Screen steps on iPhone. It disappears inside the installed app.
2. **Also a one-time note on phone home.** As option 1, plus a dismissible note under the home's lead card on a phone browser the first time, until installed or dismissed.
3. **The browser alone.** Aeolus says nothing; the person uses the browser's own menu. iPhone users must know Add to Home Screen themselves.
4. **None of these.** Say how the person should learn it.

**Pick: 1.** Findable on every browser, iPhone included, without putting an ask ahead of what waits on home; option 2 adds a note the person has to clear.

### 3. Which pages open inside the installed Aeolus window?

**Withdrawn.** Thomas gave Aeolus its own address, which answers it: see [the app's address](#the-apps-address).

Context: The gateway serves Bridge (/bridge), the outside-parties pages Bridge links to, and its console pages (sign-in, meetings, Slack) on one address. Sign-in goes through pagasae and the Account app is another app. Out-of-window pages open in the browser, or in the browser's in-app sheet on iPhone, with a way back.

1. **Bridge and its outside-parties pages.** The app opens at /bridge; Bridge and the outside-parties pages stay in the window. Sign-in passes through and returns into the window. The Account app, the console pages and outside links (a PR, a step's link) open in the browser, as their outward arrow already says.
2. **Bridge only.** Only /bridge stays in the window; the outside-parties pages open in the browser too.
3. **Every gateway page.** Bridge, outside parties and the console pages all stay in the window; only other apps and outside links open the browser.
4. **None of these.** Say what belongs in the app window.

**Pick: 1.** The installed app is the person's Aeolus: what Bridge links to as its own pages stays, what is marked as leaving leaves, matching the approved navigation's outward arrows.

### 4. What does the installed window and app switcher title say?

Asked on Aeolus. Context: Today every Bridge page is titled "Bridge · Aeolus" (#285, after aeolus-fleet#1674's <Surface> · Aeolus). The installed app's name is Aeolus, and the window title, task switcher and browser tab show the page title. Thomas: "We dont show Bridge, we show Aeolus".

1. **Aeolus.** Every Bridge page is titled Aeolus, in the browser tab and in the installed window alike. The gateway's other pages keep Gateway · Aeolus.
2. **The place, then Aeolus.** Home · Aeolus, Done · Aeolus, a conversation as <ship> · Aeolus: tells windows and tabs apart.
3. **Keep Bridge · Aeolus.** Only the app's name is Aeolus; page titles stay as #285 set them.
4. **None of these.** Say what the title shows.

**Pick: 1.** It follows the naming requirement with the least change: one title; option 2 is useful with many tabs but names every page for little gain.

### 5. When the person opens an Aeolus link and has the app installed, where does it open?

Asked on Aeolus. Context: A link to a question in Slack or mail opens the browser by default. Desktop Chrome and Edge, and Android, can open such links in the installed app instead when the manifest asks; iPhone cannot, and opens Safari, signed in apart from the home screen app. A pressed wake already opens /bridge through the existing service worker.

1. **In the installed app where the browser allows.** Ask for links within Aeolus to open in the installed app, reusing its open window and moving it to the addressed item. On iPhone the link opens Safari, which opens the item as today.
2. **Wherever the browser opens it.** Ask nothing; links open in a browser tab, the app opens only from its icon or a wake.
3. **None of these.** Say where a link should land.

**Pick: 1.** One window that follows the item, as #268 will need for a pushed item, and no duplicate windows; iPhone stays as good as today.
