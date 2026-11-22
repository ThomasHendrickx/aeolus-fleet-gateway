# scenario.json and vo.json

Coordinates are on a 1280x720 canvas, origin top left. Times are seconds from the start. Two templates share the engine; each has a complete, working pair to copy: `example/` (scenario) and `example-explainer/` (explainer).

## The 90-second scenario template

The same call played twice, without and with Aeolus.

| Beat | Time | Caption group | What happens |
|---|---|---|---|
| Intro | 0 to `a0` (3.4) | One call | Caption with a subline: who the company is; one call, played twice. |
| Run A | `a0` to `a1` (35.0) | Without Aeolus | About 5 scenes. People carry every step by phone, mail and chat (amber); the clock jumps hours and days; hand-offs count up; each decision. Ends on a count line ("Four decisions. Fourteen hand-offs by people."). |
| Switch | `a1` to `b0` (38.6) | Now on Aeolus | "Same call. Now on Aeolus." The mark appears at `a1`+0.8, the wave at `join` (36.4) puts everyone on the network, agents appear from `join`+0.6. |
| Run B | `b0` to `proof` (71.0) | With Aeolus | About 6 scenes. The same call; agents and apps carry the work along the network (purple); the clock runs in minutes; the same decisions, each on a screen (vignette). |
| Proof | `proof` to `end` (81.4) | The proof | The proof card, row by row at `proof.times`, with three voice lines. |
| End | `end` to `dur` (90) | End | The end card; one voice line with the tagline. |

Reference stills: `7.5,24,37.6,44.2,50.8,60.2,75.5,86`.

## The 2-minute explainer template

One Aeolus part: the same work by hand, then with the part, how it works, and when to use it.

| Beat | Time | Caption group | What happens |
|---|---|---|---|
| Intro | 0 to `a0` (4.4) | Intro | Caption with a subline: what the video explains. |
| By hand | `a0` to `a1` (32.0) | By hand | About 4 scenes. Every step by you counts up; something breaks at night and waits for you. Ends on a count line. |
| Switch | `a1` to `b0` (36.0) | The switch | "Same ships. Now with a trierarch." The part's tiles appear from `join`; no wave and no mark (`wave` and `mark` false). |
| How it works | `b0` to `proof` (84.0) | How it works | About 8 short scenes: the parts, how one joins, how work is placed, what it does while running, a failure, the release. |
| Proof | `proof` to `closing.from` (94.0) | The proof | Two rows of counts from the story (`proof.rows`), three voice lines. |
| Closing | `closing.from` to `end` (116.0) | Use it or not | Use it when and skip it when, three items each, and one caveat line, all read by the voice. |
| End | `end` to `dur` (122) | End | The end card, labelled "Explainer". |

Reference stills: `11.8,21.5,39.5,47.5,53.4,62.8,73.4,112.5`.

Keep a template's times and caption group names unless the story cannot fit; the score, the chips and the cards follow them. Write the beat table first: per scene its time, caption, voice lines, and what moves.

## Layout

- Keep clear: the caption at top left (x 48 to 816, y 43 to 135 for two lines), the clock and counters at top right (x 1000 to 1231, y 43 to 160), the chip right-aligned at x 1231 around y 190.
- People in the middle band (y 240 to 480), about 200 px apart; an avatar has radius 42 and a name plate of about 50 px under it.
- Apps in one row along the bottom (y about 665), about 270 px apart.
- Agents between people and apps (y 440 to 550), near what they serve; a private assistant sits beside its person.
- Outside parties (the customer, a supplier) at the left or right edge.
- Explainer: computers as frames along the bottom (y 410 to 680), each with its trierarch tile in the header and its sessions in a row inside; status above a session, its label and worktree below.
- `timeline.center` is the middle of the cast: the wave starts there.
- Tags need room: about 250 px beside a person for `right` and `left` tags.

## Fields

`page`: `title` (browser tab), `heading` (above the video), `kicker` ("Scenario · 90 s · voice and music"), `aria` (the whole story in a few sentences, for screen readers).

`timeline`: `dur`, `a0`, `a1`, `join`, `b0`, `proof`, `end`, `center` {x, y}. Optional: `mark` (when the Aeolus mark appears, default `a1`+0.8; false for none), `fly` (default `join`+0.8), `chipB` (when the second chip appears), `wave` (false: no wave; everything on stage is on the network), `netFrom` (when connections start to draw, default `join`; 0 when the network exists from the start).

`people`: key to {`x`, `y`, `name`, `role`, `spec`}, plus:
- `spec`: {`skin`, `hair`, `style` (short, bun, long, curly, fringe), `beard`, `glasses`, `bg`, `shirt`}, colours in hex. Vary skin, hair and style across the cast.
- `outside: true`: not on the network (the customer).
- `small: true`, `r: 26`, `label`: a minor party (another customer), one label above instead of a name plate.

`apps`: key to {`x`, `y`, `label`}, 142x42 by default (`w`, `h` to change). `outside: true`: a grey tile that never joins the network (a supplier's system). `kind`: "process" (a plain process such as a trierarch: a slate tile with a prompt) or "fleet" (the fleet: a slate tile with the sail).

`frames`: key to {`x`, `y`, `w`, `h`, `label`, `sub`, `glyph`}: a computer, or a tool when the story is about tools, drawn under everything with its name and what it runs; `glyph` is `chat` or `prompt` for a tool (default: a monitor). Hops and tags may name a frame; it is never an obstacle.

`agents`: key to {`x`, `y`, `r` (21; 13 when private), `label`, `lab` (right, left, above, below: where the label sits), `from` (when it appears)}. `own`: the person it works for, drawn as a link. `kind: "private"`: a person's own assistant, a small badge with its label below.

`show`: key to [[from, to], ...]: when a person, app, frame or agent is on stage (a session that starts and ends). Without an entry, always (an agent from its `from`).

`decisions` (scenario): {`who` [person per decision], `a` [times in run A], `b` [times in run B], `tags` [{x, y} per decision]}. At each time the person gets an orange ring, a chime plays and a "Decision n of N" pill shows at `tags[n]` (its centre) for 1.8 s. With a vignette, the decision time is its `press` + 0.4.

`notes`: [{`x`, `y`, `rot`, `l1`, `l2`, `from`, `to`, `handoff`}]: a sticky note a person writes to remember. `handoff` (a time) counts as a hand-off.

`lines`: [{`a`, `b`, `from`, `to`, `bend`}]: two people on the phone with each other; use it to show why someone cannot answer.

`hops`: [from, to, start, end, kind, bend, handoff]: something moving between two keys along a curve.

| kind | shows | use |
|---|---|---|
| busy | a call that does not get through | the first call in run A |
| phone | an amber handset | a person phones |
| mail | an envelope (amber in run A, slate in run B) | email |
| doc | a document | a person retypes into an app, or does a step by hand |
| chat | an amber chat bubble | a person's chat message |
| call | a green handset | a call the voice agent takes |
| msg | a slate chat glyph | an automated message to a person |
| spark | a purple agent dot | agents and apps carrying work |

- `bend`: curvature, about -0.3 to 0.3; flip its sign to move a curve off a person or label. Hops on the network take their edge's bend.
- `handoff`: 1 on a run A step a person carried (needs a `bend` before it). It counts in "Hand-offs by people" and leaves an amber trace until run A ends. The proof's hand-off number is these plus note hand-offs; the voice says the same number.
- Run A hops last 0.5 to 1 s; run B hops 0.4 to 0.6 s, chained.

`edges`: {"a>b": bend, or {`bend`, `from`, `to`, `label`} for a connection that exists only then, or carries a word such as "MCP" at its middle}: the network's connections. A connection appears the first time a hop crosses it (either direction) after `netFrom`, glows while it carries work, and fades while either end is off stage; connections to outside keys are dashed. Give every hop on the network an edge, except between an agent and its `own` person.

`tags`: [{`from`, `to`, `text`, `at`, `of`, `dx`, `dy`, `icon`, `col`, `ic`, `size`, `sfx`}]: short pills.
- `at`: right, left, above, below (`dy` 22 by default) a person or agent; `app`: above an app tile or frame; `agent`: above an agent. Without `at`: centred at `x`, `y`.
- `icon`: check, cross, clock, pencil, chat, spark, phone, dot, van, ball, msg, mail, folder, lock.
- `col` (text) and `ic` (icon) take a palette name: ink, muted, slate, agent, app (green), gate (orange), amber.
- Meaning by look: done is check with col app; carried by a person ends in ", by phone" or ", by email" with icon phone (ic amber) or mail; a finding is dot with ic gate; a condition is clock; a manual edit is pencil; where a person is (van, ball) is context; a session's state is a size 12 dot above it (crewing slate, running app, restarting amber, crashed gate, releasing muted); a worktree is folder.
- `sfx`: "urgent" (two bips), "accept" (a bell), "down" (something stops), "up" (it is back).
- One to three tags on stage at once, 1 to 3 s each.

`vignettes`: [{`type`, `from`, `to`, `x`, `y` (top-left corner), `slide` (px it rises while appearing, 8)}, plus by type:
- `chatCard` (320x128, team chat on a desktop): `title`, `lines` (up to 2), `options` [left, right] (the right one is pressed), `press`, `done` ("Decided"), `w`.
- `phoneCard` (170x236, a brief on a phone): `title`, `rows` [[label, value, colour]] (up to 4; one row every 0.45 s).
- `approvalPhone` (150x212): `title`, `label`, `amount`, `note`, `options` (["Later", "Approve"]), `press`, `done` ("Approved").
- `voiceNote` (140x38, recording): `len` ("0:20").
- `quoteCard` (280x196, a draft with line items): `title`, `lines` [[label, value]] or [[label, old, new]] (up to 2), `note`, `total` [old, new], `totalLabel` ("Total"), `change` (when new values replace old), `press`, `button` ("Send"), `done` ("Sent").
- `terminalCard` (`w`x72, a terminal): `title`, `line` typed out from `typeAt` (default `from`+0.3) over `typeDur`, `hl` [from, to] characters shown in orange (a secret), `prompt` ("$").
- `fileCard` (`w`x(68 + 19 per line), a file in git): `title` (its path), `tag` (its version tag, `tester@1`), `lines` (a few lines of it; `key:` shows in slate).
- `chatThread` (`w`x(70 + 46 per one-line message), team chat on a desktop): `title`, `msgs` [{`at`, `who`, `text` (a string, or two lines), `col`}], `typing` {`who`, `from`, `to`}: "who is typing" in the slot of the next message.
- `ticketCard` (`w`x(106 + 23 per row), a card on the backlog): `title`, `rows` [[label, value]] or [[label, old, new, colour]] (new replaces old at `change`; an empty old just appears), `status` [before, after] with dot colours `ic0`, `ic1`, changing at `statusAt` (default `change`).
- `requestCard` (270 wide, a crew request): `title`, `rows` [[label, value]], `status` [before, after] with dot colours `ic0`, `ic1`, `change` (when after replaces before), and an optional `button` pressed at `press`, then `done`.

`captions`: [{`a`, `b`, `g`, `h`, `s`}]: one per scene. `g` groups scenes into the chapter buttons under the video, `h` is the headline, `s` a subline (intro only). The proof, closing and end scenes have `h` "".

`clockA`: [[t, day, "HH:MM"], ...]: run A's clock, jumping. `clockB`: {`day`, `keys` [[t, minutes since midnight, day], ...]}: run B's clock, running between keys (615 is 10:15); a key's optional day holds from that key on. Two keys 0.01 s apart make a jump.

`counters` (optional): [{`label`, `a` [times], `b` [times], `of`}, two rows]: each row counts its times in run A, then in run B. Without it: hand-offs and decisions.

`labels`: {`handoffs` "Hand-offs by people", `decisions` "Decisions by people", `chipA` "Without Aeolus", `chipB` "On Aeolus"}.

`proof`: {`title` "Same call.", `colA`, `colB`, `footer` [two lines], `times` [title, first row, second row, footer]}. Its numbers come from `decisions`, `hops` and `notes`, never typed; an explainer gives `rows` [{`label`, `a`, `b`, `ca`, `cb`}, two rows] with counts from its story, `ca`/`cb` colouring them h (amber), g (orange), a (slate) or "" (grey).

`closing` (explainer): {`from`, `title`, `use` {`title`, `items`}, `skip` {`title`, `items`}, `note`, `times` [title, use, skip, note]}: the card after the proof, until the end card.

`end`: {`word` "Aeolus", `tagline`, `url`, `label` "Scenario" or "Explainer"}. Keep the examples' values.

`sound`: optional score cues.
- `ticks`: run A clock jumps that get ticking (default: every `clockA` time after the first).
- `turn` [t0, t1]: the music holds its breath (no drums) around the run B finding or failure.
- `suspense` [t0, t1]: the music thins before the last decision, with a fill into it.
- Put `turn` and `suspense` on the half-second beat from `b0`.

The score adds every sound effect itself, from the hops, notes, agents (each time one appears), tags with `sfx`, vignettes, decisions, proof and closing rows and the end card.

## vo.json

{`voice` "af_heart", `respell` {written: spoken}, `lines` [{`t`, `end`, `text`}]}.
- Each line plays from `t` and is sped up (at most 23 %) to end by `end`. Plan about 3 words per second of window, windows 2 to 4 s, gaps of about 0.2 s.
- Run A closes with the count line, the switch has its own line, and each proof or closing line starts just after its row.
- Respell names the voice gets wrong ("Jens": "Yens", "Aeolus": "Eeohlus", "trierarch": "tryerark"); write times and numbers as words.
