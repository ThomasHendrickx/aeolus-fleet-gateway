# Bridge home: Your fleet uses the width

Mockups for [#189](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/189). Not approved yet; once approved they are the acceptance criteria for the build.

On a wide window Bridge home keeps its content in a fixed width on the left: Your fleet is a narrow column of small tiles with cut names, and a third of the window stays empty.

Only the layout widths and the fleet tiles change. Everything else is as the approved sheets draw it: Bridge home (aeolus-fleet `docs/design/bridge/mockups`), send a ship a message (aeolus-fleet#1560) and argo's section (aeolus-fleet#1572), in the Compact look of aeolus-fleet `docs/design`. Each HTML file stands alone, with the tokens, the kit and the Geist fonts inlined; each PNG is that file rendered in Chromium at 1x.

| File | What it shows |
| --- | --- |
| [wide.html](wide.html), [wide.png](wide.png) | Bridge home at 1900 × 1000, before and after, light and dark |
| [laptop.html](laptop.html), [laptop.png](laptop.png) | Bridge home at 1440 × 900, before and after, light and dark |
| [phone.html](phone.html), [phone.png](phone.png) | The phone at 375 × 780: home (unchanged), and the Fleet tab before and after, light and dark |

## What changes

| | Before (as built) | After |
| --- | --- | --- |
| The page | Stops at 1024 px (`max-w-5xl`), the rest of the window empty | Takes the window beside the sidebar |
| What waits | Whatever is left beside Your fleet | At most 44rem, its reading width |
| Your fleet | A fixed 20rem column | The rest of the window, at least 20rem |
| Tiles a row | Three, on home and on the phone's Fleet tab | As many as fit at 11rem or wider on home (four at 1900, two at 1440); two on the phone |
| A tile's name | Cut with an ellipsis | Whole; a name too long for its tile goes on to a second line |

No new breakpoint: the columns are fluid between lg (1024) and any width. At 1024 the columns keep today's widths, what waits beside a 20rem Your fleet, and the tiles go one a row there (three cut tiles today) until what waits reaches 44rem and the column fits two, from about 1390 px.

The phone's home draws no tiles, as the Bridge sheets decide: while something waits Your fleet is left out, and when nothing waits it shows the numbers only. The tiles live on the Fleet tab.
