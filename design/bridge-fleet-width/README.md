# Bridge home: Your fleet uses the width

Mockups for [#189](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/189). Not approved yet; once approved they are the acceptance criteria for the build.

On a wide window Bridge home keeps its content in a fixed width on the left: Your fleet is a narrow column of small tiles with cut names, a third of the window stays empty, and a tile does nothing on click. Thomas, on these mockups: "I rather have the boxes be a bit taller so the proportions are more natural. Use that screen realestate for something usefull, maybe even animation or so".

Only the layout widths and Your fleet's tiles change. Everything else is as the approved sheets draw it: Bridge home (aeolus-fleet `docs/design/bridge/mockups`), send a ship a message (aeolus-fleet#1560) and argo's section (aeolus-fleet#1572), in the Compact look of aeolus-fleet `docs/design`. Each HTML file stands alone, with the tokens, the kit and the Geist fonts inlined; each PNG is that file rendered in Chromium at 1x. Open the HTML to see the hover, the focus and the live band run.

| File | What it shows |
| --- | --- |
| [wide.html](wide.html), [wide.png](wide.png) | Bridge home at 1900 × 1000, before and after, light and dark; the tile's states |
| [laptop.html](laptop.html), [laptop.png](laptop.png) | Bridge home at 1440 × 900, before and after, light and dark; the tile's states |
| [phone.html](phone.html), [phone.png](phone.png) | The phone at 375 × 780: home (unchanged), and the Fleet tab before and after, light and dark |

## What changes

| | Before (as built) | After |
| --- | --- | --- |
| The page | Stops at 1024 px (`max-w-5xl`), the rest of the window empty | Takes the window beside the sidebar |
| What waits | Whatever is left beside Your fleet | At most 44rem, its reading width |
| Your fleet | A fixed 20rem column | The rest of the window, at least 20rem |
| A tile's size | 52 px high, three a row | At least 112 px high and 12rem wide, about 16:9: four a row at 1900, two at 1440 and on the phone |
| A tile's content | The name, cut, and the state | The whole name, what the ship is doing (its report, two lines at most), the state and when it last did something |
| Working | A green tile | A green tile with a band of light running along its foot every 2.4 s |
| Click or tap | Nothing | Opens the ship's page (aeolus-fleet#1475: "a tap on a ship tile opens the ship's page"; the title shows the report on hover) |
| Hover | Nothing | The border takes the state's colour, the tile lifts 1 px with a soft shadow, an arrow shows top right |
| Keyboard | Tab skips every tile | Each tile takes focus with the design system's focus outline and the arrow |
| Reduced motion | | Nothing lifts or runs; the live band stands still |

## Questions

1. **When a ship last did something** ("now", "25 min", "yesterday"): Your fleet's read today carries each ship's state and its report's note, not a time. The time of the report, or of the ship's last delivery, would need core to carry it. Which one, or leave the time out?
2. **Which page a tile opens**: the agreed "ship's page" is the console's `/ships/<id>`; Bridge has no ship page of its own. Open the console there, or a Bridge page?
