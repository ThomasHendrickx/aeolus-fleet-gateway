# Agent report

Ran P0, P1, P2 in the supplied repository using the supplied remote-calls skill.

P0: ran `python3 /tmp/remote-calls-runs/skill-md/retries/skill/scripts/scan_remote_calls.py companion.json .`. Exit 1: three missing timeouts (weather and both vendor calls), no domain violations or unsupported constructs. Actual scanner output is in `repo/p0-scan.json`; entry evidence and applicability are in `repo/RESULT.json`. `python` was unavailable, so used `python3`. Problems 1, 2, 5 apply. This is a remote adapter with no existing retry layer. No applicability stop.

P1: scoped to vendor lookup and charge, leaving weather unchanged. Set native 100 ms timeouts from each dependency's measured p99.9 80 ms plus 20 ms padding. Timeout tests failed before changes. Ran the supplied `run_check.py` with both companion check commands; passed (`repo/p1-check.json`). An initial fake-timer setup interfered with Node test scheduling; narrowed timer fakes before P2 verification.

P2: lookup is idempotent; charge retries only with a nonempty idempotency key. Unkeyed create hits the safety gate and makes exactly one attempt. No SDK/gateway retry layer exists. Added scenarios before implementation: recovery, cap, Retry-After, budget, keyed/unkeyed create, and business errors; four expected failures are saved in `repo/p2-before.txt`. Implemented Cockatiel retry with exponential equal jitter, three retries, a 2400 ms total budget, native timeout reservation, and Retry-After seconds. Values and sources/reasons are per dependency in config. Provider availability failures get an adapter error code and the declared checkout fallback. Added dependency independence and jitter verification.

Final supplied runner command: `python3 /tmp/remote-calls-runs/skill-md/retries/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'`. Both checks passed; all 12 tests passed (`repo/p2-check.json`). No P3/P4 run: they were not requested; task explicitly excludes a sustained-failure incident. No breaker or bulkhead added. Boundary, telemetry, measurements, companion, task and supplied checker remain unchanged.

Changed application files: vendor adapter, per-dependency config, checkout fallback. Added tests and procedure evidence. Git status was unavailable because the supplied directory has no Git repository.
