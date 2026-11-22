You work in the repository at WORK/aip/finder/repo. Apply the skill in WORK/aip/finder/skill (read its SKILL.md first and follow its procedures) to the task in WORK/aip/finder/repo/TASK.md. The repo companion is WORK/aip/finder/repo/COMPANION.md; run commands from WORK/aip/finder/repo. The Postgres database for this repo is already running; its URL is in WORK/aip/finder/repo/database.url.

Run P0, then P3. Before anything else, run P0 and write its result to WORK/aip/finder/repo/RESULT.json as {"violations": [...], "problems": [numbers], "applies": bool}.
If the skill has script steps, run them (scripts are under the skill folder; read a script's header for usage). Do the steps yourself; do not look outside WORK/aip/finder/repo and WORK/aip/finder/skill.
If P0 says applies is false, stop after P0.
Finish with a short report (the steps you ran, what you changed, anything you could not do) and also write it to WORK/aip/finder/AGENT_REPORT.md.
