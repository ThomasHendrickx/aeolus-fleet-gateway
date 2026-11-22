# Agent report

Applied the supplied remote-calls skill, using TASK.md, COMPANION.md and companion.json. Procedures actually run: P0, P1, P2.

P0: ran `python3 /tmp/remote-calls-runs/aip/retries/skill/scripts/scan_remote_calls.py companion.json` before changes. Exit 1 reported missing timeouts in untouched.js line 2 and vendor.js lines 4 and 5; violations and unsupported were empty. Saved actual missingTimeouts and violations in RESULT.json. Problems [1,2,5] apply: unbounded vendor calls, intermittent 503/429 responses, and unsafe create retries. These are remote calls with no existing retry mechanism; applicability is true. Weather is outside the task and was left unchanged. Initial CLI discovery attempts with unavailable `python` and unsupported `--help` were corrected to the documented Python 3 invocation.

P1: scoped lookup and charge. Configured native timeout 100 ms from payment/catalog p99.9 80 ms plus 20 ms padding. Added a slow-response test and observed failure before implementation, then passed the supplied run_check.py commands. No boundary changes.

P2 gates: lookup is idempotent and eligible; unkeyed charge is ineligible and receives no retries. Keyed charge is eligible and retains its original key. Inspected network and caller: no existing retry layer. Added transient recovery, capped failure and Retry-After scenarios before retry implementation and observed failure. Implemented Cockatiel retry in the driven adapter only: three retries, exponential full jitter with 40 ms base and 160 ms cap, and a 2400 ms elapsed budget reserving 100 ms for the next attempt. Retry-After seconds set the minimum wait; an instruction exceeding the remaining budget causes immediate give-up. Client/business errors are not retried. Config records measurements and reasons. Exhausted provider faults map to the companion's declared checkout fallback, without resilience imports in core.

Test development initially exposed fake-timer interference with Node's test runner; restricted fake timers to Date/setTimeout/clearTimeout. Updated timeout scenario to supply slow responses for all eligible attempts. Final six tests pass, including independent catalog traffic and keyed/unkeyed create behavior.

Verification: ran the supplied `python3 /tmp/remote-calls-runs/aip/retries/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'` after P1 and P2. Final result passed=true; both commands exit 0, six tests pass. P3/P4 were not run or implemented: task requests P0/P1/P2, explicitly excludes sustained-failure breaker work, and supplies no starvation task. Measurement fields alone were not used to expand procedure scope.

Changed src/adapters/vendor.js, src/config.json, src/core/checkout.js; added tests/vendor.test.mjs and RESULT.json. Network, telemetry, measurements, companion, task, checker, and unrelated weather adapter were preserved.
