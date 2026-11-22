# Report

Applied the supplied remote-calls skill. Ran P0 and P1 only, as TASK.md requests.

P0: `python` was unavailable (exit 127); ran `python3 /tmp/remote-calls-runs/skill-md/timeout/skill/scripts/scan_remote_calls.py companion.json .`. Scanner exited 1, reporting missing timeouts in untouched.js:2 and vendor.js:4,5; violations and unsupported arrays were empty, clean was false. Saved the actual finding records in RESULT.json with problems [1], applies true, and proceduresRun [P0, P1]. The task describes hanging payment calls (problem 1). The external client supports a native timeout, so configured that existing mechanism; no extra timeout wrapper or resilience mechanism was introduced. This is an outbound adapter, not a local resource or retrying queue consumer.

P1 scope: payment lookup and charge in src/adapters/vendor.js. Set 100 ms from measurement.json payment p99.9 80 ms plus padding 20 ms, with its source/reason in src/config.json. Other vendor dependencies and weather retain their existing behavior. No retries, breaker, bulkhead, or checkout fallback changes were requested or performed.

Added tests/payment-timeout.test.mjs. Before implementation, direct `node tests/payment-timeout.test.mjs` failed both slow-payment scenarios at the 100 ms assertion; the fast-payment and other-dependency scenarios passed. After implementation, all four tests passed: lookup/charge abort at 100 ms and release active requests without retrying; fast calls succeed and clear timers; catalog/weather calls lasting 200 ms still succeed.

Ran the supplied script: `python3 /tmp/remote-calls-runs/skill-md/timeout/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'`. Both commands exited 0 and the script reported passed true. Also ran `node tests/payment-timeout.test.mjs` to confirm all four individual scenarios passed (the test-runner invocation reports the file as one passing test).

Changed only scoped adapter/config, new tests, and requested evidence/report files. Boundary, telemetry, measurements, task, companion, and supplied checks remain unchanged.
