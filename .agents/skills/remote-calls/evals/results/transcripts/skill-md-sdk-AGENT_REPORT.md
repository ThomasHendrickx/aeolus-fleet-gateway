# Actual outcome

Ran P0 only. Read TASK.md, COMPANION.md, companion.json, measurement.json and the supplied skill and scripts. P0 identified task problem 5: SDK and adapter retries multiply three SDK attempts into six outbound requests. Its existing-platform-mechanism gate applies: configure that mechanism and stop; P1 and P2 were not run. RESULT.json records applies=false and proceduresRun=["P0"].

Commands and evidence:
- Initial `python` invocation was unavailable (exit 127); used `python3`.
- `python3 /tmp/remote-calls-runs/skill-md/sdk/skill/scripts/scan_remote_calls.py companion.json .` exited 1: missing timeout in src/adapters/untouched.js line 2; violations=[]; unsupported=[]; clean=false. Actual missingTimeouts and violations are preserved in RESULT.json. Weather is outside the requested payment retry scope.
- Regression test before the adapter change failed with six requests versus the expected three.
- Ran supplied run_check.py with `node dependency-check.mjs` and `npm run check && node --test tests/*.test.mjs`. Final result passed=true, both commands exit 0, all three tests pass. Fake timers are restricted to timeout and Date APIs so Node test scheduling remains operational.

Changes: payment adapter retries configured to zero in src/config.json, with source and reason; vendor adapter consumes the setting and defaults other dependencies to zero extra retries. SDK remains the retry owner with three total lookup attempts. Added deterministic tests for persistent failure (three attempts), transient recovery (two attempts), and non-idempotent charge (one attempt). No boundary, measurement, companion, checker, or task changes. No breaker, bulkhead, fallback, or timeout work was performed after the P0 stop.
