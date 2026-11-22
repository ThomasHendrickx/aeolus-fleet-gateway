# Remote-call isolation report

Applied the supplied remote-calls skill, running P0, P1 and P4 in order from the repository directory. No other procedures were run.

P0: `python` was unavailable (exit 127); ran `python3 ../skill/scripts/scan_remote_calls.py companion.json .` successfully. Scanner exit 1 reported three missing timeouts: untouched.js:2 and vendor.js:4–5; no domain violations or unsupported constructs. Actual scanner output is preserved in RESULT.json, together with problems [1,4], applies=true and the procedures run. The task concerns outbound provider calls, with missing timeouts and capacity starvation; no local-resource, queue-consumer or existing platform-mechanism exclusion applied. Measurements mentioning breaker settings did not expand the requested scope into P3.

P1: scoped payment/catalog vendor lookup and charge; weather stays unchanged. Both measured timeout specifications are 80 ms p99.9 + 20 ms padding = 100 ms. Added deterministic slow-call tests first; direct execution (`node tests/resilience.test.mjs`) showed all four timeout assertions failing. The initial fake-timer setup obscured individual results under the test runner; restricted fake timers to Date/setTimeout/clearTimeout. Configured native request timeouts using src/config.json with measurement reasons. Ran `python3 ../skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'`: both checks passed.

P4: starvation gate passed based on the task's shared-budget incident. Specified two active calls and zero queued calls per provider from measurement.json, recording source/reasons in config. Added tests before implementation: saturation admitted four network calls instead of two, and provider failures leaked through checkout. An initial saturation test waited indefinitely before the missing limiter was implemented; corrected it to assert the request count before awaiting the fallback. Both P4 regression scenarios then failed explicitly as expected.

Added a separate Cockatiel bulkhead per vendor instance (instances represent separate dependencies), covering lookup and charge together. Adapter errors translate provider unavailability to a stable error code; checkout maps that code to its declared temporary-unavailability response. HTTP client errors remain errors. Added coverage for reverse isolation, timeout slot recovery, successful checkout, out-of-stock results and client errors.

Final command: `python3 ../skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'`. Result: passed=true, both commands exited 0, all eight tests passed. Installed dependencies were already available.

Changed only src/adapters/vendor.js, src/core/checkout.js and src/config.json; added tests/resilience.test.mjs and RESULT.json. Network, telemetry, measurements, companion, task and existing checker were unchanged. The unrelated weather timeout finding remains outside task scope.
