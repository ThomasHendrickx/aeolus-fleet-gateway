# Scenario results

Initial observations on 2026-11-09 used 16 fresh Codex exec sessions (eight task groups per form, two workers at a time), followed by two independent fresh judges for S0.4, S0.5 and S3.5. Root model: `gpt-6.1-sol`; worker CLI invocations used default model selection with no override. Each group ran in its own repository from the same fixture baseline. Multiple scenarios share a task's setup, as documented in `../README.md`. These are individual observations, not a pass-rate estimate.

The evaluated instructions equal the shipped forms. Both forms have byte-identical deterministic helpers. Each agent received its own task, form and companion, without the hidden behavioral checks. Fake dependencies control external latency/status and a Sinon clock controls timing; resilience runs through Cockatiel 4.0.0. Fixture dependencies are locked, and immutable-boundary/instruction audits passed for all 16 runs.

| Scenario | SKILL.md | AIP |
| --- | --- | --- |
| S0.1 | pass | pass |
| S0.2 | pass | pass |
| S0.3 | pass | pass |
| S0.4 | pass | pass |
| S0.5 | pass | pass |
| S1.1 | pass | pass |
| S1.2 | pass | pass |
| S2.1 | pass | pass |
| S2.2 | pass | pass |
| S2.3 | pass | pass |
| S2.4 | pass | pass |
| S3.1 | pass | pass |
| S3.2 | pass | pass |
| S3.3 | pass | pass |
| S3.4 | pass | pass |
| S3.5 | pass | pass |
| S3.6 | pass | pass |
| S3.7 | pass | pass |
| S4.1 | pass | pass |

Each form: 19 pass, 0 fail, 0 not run.

Thomas approved a revised S2.3 on Bridge (9 November): "Given an SDK client that already retries, When P0 runs, Then it stops and configures the SDK's retry; total attempts equal the SDK's (no second layer)." Only this scenario was rerun, with two fresh worker sessions (one per form) and one fresh independent judge. Both workers stopped at P0 and delegated to the existing SDK retry layer. Independent Node probes compared SDK and adapter directly: both make three attempts on exhaustion and third-attempt recovery, while unkeyed charge makes one. The revised scenario passes on both forms. All other scenario evidence is retained unchanged.

Current status: all nineteen scenarios pass on both forms; the PR is ready for review. The original SDK observations remain historical evidence of the earlier P2 wording and are superseded for S2.3 by `s23-p0-rerun/`. That folder preserves the exact fresh prompts/reports, gate output, diffs, independent judgement with actual commands/output, fixture audit and S2.3-only check output. Its `prior-results.json` and `prior-check-output.md` preserve the prior verdicts. Neither source SKILL.md nor AIP contains scenarios, so no recompilation was needed; instructions, compiled graph and provenance are unchanged, and the source/count check still passes. No merge was performed.

Evidence: `results.json` holds every verdict and observation; `check-output.md` is the consolidated table; the actual S2.3-only harness output is in `s23-p0-rerun/check-output.md`; `judge-*.{json,md}` hold independent judgements and commands. `transcripts/` holds each exact prompt, report, observable command transcript, application diff, execution metadata and `RESULT.json`. `fixture-audit.txt` checks unchanged boundaries, measured inputs and instruction identity. `baseline.txt` proves the checks reject missing positive behavior and preserve negative controls; it is not a fresh-agent scenario run. `validate-aip.txt`, `check-aip.txt` and `scan-unit-test.txt` are structural checks, not scenario passes.

The evaluator runner invoked `codex exec --ignore-user-config --ephemeral --skip-git-repo-check -C <run>/repo -s danger-full-access --json -o <run>/LAST_MESSAGE.md -`, with the recorded `PROMPT.md` on stdin. Observable transcripts were extracted from completed command and agent-message events; no acceptance instructions were supplied to the workers.

Deferred manual breaker override: [issue #55](https://github.com/ThomasHendrickx/skills/issues/55).
