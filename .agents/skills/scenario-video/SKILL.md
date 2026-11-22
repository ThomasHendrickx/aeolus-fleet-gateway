---
name: scenario-video
description: Use when making an Aeolus scenario video (the same story without and with Aeolus) or explainer video (how an Aeolus part works, when to use it and when not) from a script, delivered as a page and a 1080p MP4.
---

# Scenario video

A video is two data files in a workdir: `scenario.json` (what is on screen, when) and `vo.json` (what is said, when). The look, the engine and the score live in `assets/` and `scripts/`; never edit them for one video: when a story needs something they lack, say so instead. Every script takes the workdir as its first argument.

Steps:
1. Kit: when `scripts/` is not beside this file, `git clone --depth 1 --branch v3.2.0 https://github.com/ThomasHendrickx/skills` and work from its `skills/scenario-video`. Done when `scripts/build.py` exists.
2. Tools: `pip install kokoro-onnx==0.6.1 faster-whisper==1.2.1 soundfile scipy numpy pillow playwright` (add `--break-system-packages` if pip asks), `ffmpeg`, and a Chromium for Playwright (`python3 -m playwright install chromium` only when none is installed). Done when `python3 -c "import kokoro_onnx, faster_whisper, playwright"` and `ffmpeg -version` succeed.
3. Reference: copy the template's example (`example/` for a scenario, `example-explainer/` for an explainer) to a workdir, run `build.py`, then `frames.py <wd>` with that template's reference stills from `references/scenario.md`. Done when you have looked at the sheets (the look to match) and it printed `page errors: none`.
4. Story: read `references/scenario.md`, then write a beat table on the template's timeline. Done when both runs hold the same decisions by the same people (scenario) or the same work by hand and with the part (explainer), and every scene has one caption and its voice lines.
5. Data: in a new workdir, write `scenario.json` and `vo.json` from the table, starting from the example's. Done when `build.py` writes `page.html`.
6. Review: `frames.py` with at least one time per caption scene and per vignette, then `check_paths.py`. Done when no sheet shows an overlap or clipped text, there are no page errors, and only `own:` hits are listed.
7. Voice: `make_vo.py`. Done when no line prints OVER (shorten the line or widen its window, then rerun).
8. Score: `make_sound.py`. Done when it prints `sound.wav at -16 LUFS`.
9. Hearing check: `check_voice.py`. Done when every missing word is only spelled differently (a respelled name, a numeral, labour and labor).
10. Export: `export.py <wd> <name>`, with nothing else running. Done when `<name>.mp4` is 1920x1080 with sound and lasts `timeline.dur`.
11. Deliver `page.html` with `sound.mp3` beside it (the page plays it by that name), and the MP4.

Story rules:
- The same story, played twice: without, then with. A scenario keeps the same decisions by the same people in both runs; an explainer keeps the same work, shows how the part does it, and closes on when to use it and when not.
- People decide; agents and apps carry the rest. An agent steps in when a person is busy (show why) and never replaces one.
- The proof card shows only counts from the story (decisions and hand-offs by people; for an explainer, steps by you). No time or money claims: the story clock tells the time.
- An explainer states only what the part's own docs back (limits, defaults, what it never does).
- One caption per scene, under 12 words. Every voice line names what is on screen and says the numbers the counters show.
- A scenario uses plain words: people, apps, agents, the network; an explainer may use Aeolus words, each on screen when first said. No vendor names beyond the harnesses an explainer is about, no em dashes. The end card says "Scenario" or "Explainer".

Gotchas:
- `export.py` takes about 6 minutes for 90 seconds on 2 cores, longer with anything heavy beside it; stopped midway, it continues from its saved frames when run again.
- The voice reads names and numbers its own way: respell names in `vo.json` (`"Jens": "Yens"`) and write times as words ("ten fifteen").
- `check_voice.py` often drops the first word of the file (check that line alone); a swallowed "-ed" before "the" is real: reword the line.
- `make_vo.py` downloads the voice model once (about 350 MB, from GitHub); `export.py` needs Google Fonts and stops when they did not load.
