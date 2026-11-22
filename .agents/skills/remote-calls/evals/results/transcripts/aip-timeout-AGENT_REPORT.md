# Report

Applied the supplied remote-calls skill; ran P0 then P1 only.

P0: `python` was unavailable (exit 127), so ran `python3 /tmp/remote-calls-runs/aip/timeout/skill/scripts/scan_remote_calls.py companion.json .`. Exit 1 correctly reported missing timeout options at untouched.js:2 and vendor.js:4,5; violations and unsupported were empty, clean was false. Actual missingTimeouts and violations are preserved in RESULT.json. Task evidence establishes problem 1. The calls are remote, not local or queue consumers, and have no configured timeout policy. Applicability is true. Native HTTP timeout support is used directly rather than adding a duplicate wrapper. Other incident data did not expand the requested procedures.

P1: scoped both payment operations in vendor.js; weather and other dependency behavior remain unchanged. Configured 100 ms from measurement.json payment p99.9 80 ms plus padding 20 ms, recording source and reason in src/config.json. Adapter passes this budget to native request timeout, which cancels outstanding work. No Cockatiel wrapper is necessary for a client-native timeout.

Added deterministic fake-timer tests in tests/timeouts.test.mjs. Before implementation, both slow-payment assertions failed (still pending at 101 ms); fast payment and weather passed. Commands: `node --test tests/*.test.mjs` (exit 1), then `node tests/timeouts.test.mjs` (exit 1 with both expected assertion failures).

After implementation, ran supplied `python3 /tmp/remote-calls-runs/aip/timeout/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'`: passed true, both commands exit 0. Repeated after adding independent-dependency coverage; passed. Direct test execution also passes all four tests. Tests verify both payment operations abort at exactly 100 ms, release network activity, issue only one request, allow fast success, and preserve weather and catalog behavior.

Changed only the task-scoped adapter, config, new tests, RESULT.json, and this report. No P2–P4 procedures were run; no protected boundary, companion, measurements, task, or checker was modified.
