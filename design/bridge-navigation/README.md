# The gateway's other pages inside Bridge's navigation

Mockups for [#191](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/191). Not approved yet; once approved they are the acceptance criteria for the build.

Thomas: "the non bridge gateway screens need to be adjusted to fit into the new navigation. If I now go to outside parties I switch layout 180 which is really weird".

Bridge's sidebar leads to three settings: Where things show, Outside parties and Fleets and account. Each "before" is the build (gateway main, v0.36.3) shot in Chromium at 1x against a stand-in for the gateway's API. Its plain "Aeolus" bar is drawn without the account's app switcher, which the stand-in does not answer, and the round "N" is Next's dev badge. Each "after" is drawn in the approved Bridge sheets' kit (aeolus-fleet `docs/design/bridge/mockups`, Compact look), with the tokens and Geist fonts inlined; each PNG is its HTML rendered at 1x.

| File | What it shows |
| --- | --- |
| [outside-parties-wide.html](outside-parties-wide.html), [png](outside-parties-wide.png) | Outside parties and Add MCP server at 1900 × 1000, before and after, light and dark |
| [outside-parties-laptop.html](outside-parties-laptop.html), [png](outside-parties-laptop.png) | The same at 1440 × 900 |
| [outside-parties-phone.html](outside-parties-phone.html), [png](outside-parties-phone.png) | The same at 375 × 780 |
| [where-things-show.html](where-things-show.html), [png](where-things-show.png) | Where things show as built, at the three widths, light and dark: already inside Bridge |

## What changes

| Page | Before (as built) | After |
| --- | --- | --- |
| Outside parties, and its pages (add, a party, change, retire) | The gateway's old frame: a plain bar across the top and a centred column, no sidebar; on the phone no tabs and no way back | Bridge's shell. The sidebar stays with Outside parties current under Settings. The top bar reads "Aeolus fleet / Outside parties", and on a page below it adds the page ("/ Add MCP server"); the crumbs replace the page's own back link. On the phone: a back chevron and the page's title in the top bar, with Bridge's tabs, none current, as Where things show has today. The content stays as built; the page takes the window, as #189 proposes, and a form keeps its reading width |
| Where things show | Already a Bridge page (`/bridge/settings/routing`) | Unchanged, apart from the page width #189 proposes |
| Fleets and account | Opens the account page in pagasae's Account app, another app, with no sign that it leaves Bridge | Stays in the Account app. Bridge's sidebar marks the entry with an arrow, "Opens the Account app", so the app switch is said before it happens |

## Questions

1. **Fleets and account** is pagasae's Account app, not a gateway page. Drawn: it stays there, marked as opening another app. Alternatives: the gateway draws a copy inside Bridge (two places to keep), or pagasae's Account app adopts Bridge's sidebar (pagasae work). Asked over the fleet; this is the pick until answered.
2. The gateway's other old-frame pages (Parties, Slack, meetings, sign-in) are not in Bridge's navigation and are not drawn here.
