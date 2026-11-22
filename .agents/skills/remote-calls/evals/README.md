# Fresh-agent evaluations

`scenarios.md` preserves the approved scenarios verbatim. Eight independent tasks cover the nineteen scenarios on each form. A task grouping shares only one fresh run's relevant setup (for example the breaker's open/half-open lifecycle); every form/task has its own repo, base snapshot, skill and prompt. Agents receive task signals and repository inputs, never the harness acceptance checks. They must follow actual gates; a stopped procedure is `not run`, even when existing behavior would satisfy a check.

Install the fixture's pinned dependencies, then prepare:

```sh
npm ci --ignore-scripts --prefix skills/remote-calls/evals/fixtures/shared
export REMOTE_CALLS_NODE_MODULES="$PWD/skills/remote-calls/evals/fixtures/shared/node_modules"
python3 skills/remote-calls/evals/harness.py baseline
python3 skills/remote-calls/evals/harness.py prepare /tmp/remote-calls-runs
```

For every `PROMPT.md`, start a **fresh agent session** in its directory, supplying that prompt and writing its actual report to `AGENT_REPORT.md`. Preserve its transcript separately as evidence. An example local runner is:

```sh
codex exec --ignore-user-config --ephemeral --skip-git-repo-check \
  -C /tmp/remote-calls-runs/skill-md/local/repo -s danger-full-access --json \
  -o /tmp/remote-calls-runs/skill-md/local/FINAL_REPORT.md \
  < /tmp/remote-calls-runs/skill-md/local/PROMPT.md \
  > /tmp/remote-calls-runs/skill-md/local/transcript.jsonl
```

The agent records `RESULT.json` with real gate output and `proceduresRun`. Missing report means `not run`. P0 must say `applies: true` and list the relevant procedure before a later scenario counts as run. S2.3 uses Thomas's 9 November revision: its When is P0. It requires the existing-SDK stop, configuration of that layer, and the SDK's total attempt count. Do not force it through P2.

Independent fresh judges review S0.4, S0.5, S2.3 and S3.5 against the approved text, task, source/compiled form, actual diff and transcript. Record each judgement in `<work>/<form>/JUDGE.json`, keyed by scenario, with `{"result":"pass|fail|not run","evidence":"specific observation"}`. No judgement means `not run`; the scripted observable check still vetoes a contradictory pass. A judge must not count a gated-off P3 fallback as run.

```sh
python3 skills/remote-calls/evals/harness.py check /tmp/remote-calls-runs
# To check only a revised scenario on freshly prepared runs:
python3 skills/remote-calls/evals/harness.py check /tmp/remote-calls-s23-rerun S2.3
python3 skills/remote-calls/evals/harness.py collect /tmp/remote-calls-runs /tmp/remote-calls-evidence
```

`check` writes `results.json` and prints every scenario as `pass`, `fail` or `not run` for both forms. The report is an observation from these runs, not a success-rate estimate. `collect` preserves prompts, actual agent reports, final reports, execution metadata, RESULT.json gate evidence, transcripts (when named transcript.jsonl), independent JUDGE.json verdicts, the results table and application diffs. Keep any separately named judge transcripts and command outputs alongside those files.

Both forms ship byte-identical deterministic scan/check helpers; only their instruction representation differs. The scripted behavioral checks use the real Cockatiel library through the agent's finished adapter, with Sinon fake timers and an external-network fake. Scripted remote status, Retry-After, delay and cancellation are the only network behavior. No resilience implementation is supplied in the baseline HTTP adapter. The SDK fixture has real Cockatiel retries at its SDK layer plus the pre-existing duplicate caller layer; this is the S2.3 defect. The timeout is the boundary client's native setting. The baseline command proves all missing positive behavior fails for an assertion, and that the non-idempotent-create and client-error negative controls remain safe; it does not claim fresh-agent scenario passes.
