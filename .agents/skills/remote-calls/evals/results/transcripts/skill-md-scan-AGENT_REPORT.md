# Applicability investigation

Applied the supplied remote-calls skill. Ran only P0, as TASK.md requests; P1–P4 were not run. All commands ran from /tmp/remote-calls-runs/skill-md/scan/repo.

Command: `python3 /tmp/remote-calls-runs/skill-md/scan/skill/scripts/scan_remote_calls.py companion.json . > P0_SCAN.json`. Exit 1 indicates scan findings. Actual stdout is preserved in `repo/P0_SCAN.json`: three missing timeout settings (untouched.js:2, vendor.js:4 and :5), one layering violation (core/leak.js:1 imports cockatiel), and one unsupported construct (core/leak.js:2, assigned client alias requires flow analysis). This is not a clean scan.

P0 task assessment: problems [1, 3]. Checkout hangs during provider outages, and those outages slow other pages. There is no demonstrated transient-recovery issue, shared limiter, or duplicate/multilayer retry issue to establish problems 2, 4, or 5. The calls cross an external HTTP boundary; no local-resource, retrying queue consumer, or existing platform resilience mechanism excludes applicability. Thus applies=true. Stopped after the requested applicability gate, despite its positive result.

Wrote `repo/RESULT.json` with the scanner's actual missingTimeouts and violations, problems [1, 3], applies=true, and proceduresRun=["P0"]. Preserved the full scan output separately so its unsupported finding is retained.

Validation: `npm run check` passed (exit 0). No application changes or new behavioral tests were needed for this inventory-only task. Application files, external boundaries, companion inputs, measurements, supplied checker, and task were left unchanged. New repository artifacts: RESULT.json and P0_SCAN.json.
