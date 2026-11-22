# Observable transcript: aip-retries

I’ll read the task, skill, and companion inputs, then run P0 and follow its gate decision.


```bash
/bin/bash -lc "pwd && rg --files -g 'AGENTS.md' -g 'TASK.md' -g 'COMPANION.md' -g 'companion.json' && cat TASK.md COMPANION.md companion.json && cat /tmp/remote-calls-runs/aip/retries/skill/SKILL.md"
```
Exit: 0
```text
/tmp/remote-calls-runs/aip/retries/repo
TASK.md
COMPANION.md
companion.json
Payment availability reads intermittently receive 503 or 429 during deployments, then recover. Payment creates have occasionally produced duplicate charges after ambiguous failures; orders currently have no idempotency key. Fix reliability for the lookup and preserve create safety. Apply P0, P1, P2; there is no sustained failure incident for a breaker.
# Repository companion
Read `companion.json` for the skill inputs and `measurement.json` for incident measurements.

This is an ESM Node repository. Use the installed `cockatiel` resilience library. `@sinonjs/fake-timers` is available for deterministic tests. HTTP `request(network, options)` supports a native `timeout` in milliseconds; omitting it is unbounded. `HttpError.status` and `.headers['retry-after']` carry server responses. Retry-After is seconds. The fake Network scripts only external responses and latency; keep it unchanged.

Preserve public API `makeVendor(network, {dependency='payment'}={})` with async `lookup(sku)` (idempotent read) and `charge(order)` (non-idempotent create unless `order.idempotencyKey` exists). Separate vendor instances represent separate dependencies. Core's `checkout(vendor, order)` is the page use case. `src/infra/telemetry.js` supplies existing `log(event)`/`metric(event)` and event arrays for observability. Add per-dependency values and their source/reason in `src/config.json`; keep the config importable from Node. You may extend adapter exports if helpful.

Tests go in `tests/*.test.mjs`; `npm run check` checks syntax. Dependency direction check parses imports; domain may not import resilience or adapters. The application currently leaks vendor errors to its page. On provider unavailability, checkout's declared fallback is `{status:'temporarily_unavailable', message:'Payments are temporarily unavailable. Please try again later.'}`. A read from another dependency must continue independently.

Only task-scoped application changes are authorized. Do not modify the network or telemetry boundary, companion, measurements, existing check, or this public API. P0 output is evaluation evidence, not application code. Install dependencies if absent with `npm install --ignore-scripts`.
{
  "paths": {
    "domain": [
      "src/core"
    ],
    "adapters": [
      "src/adapters"
    ]
  },
  "outboundClients": [
    {
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    }
  ],
  "resilience": {
    "library": "cockatiel",
    "config": "src/config.json"
  },
  "measurement": "measurement.json",
  "checks": {
    "dependencyDirection": "node dependency-check.mjs",
    "resilienceTests": "npm run check && node --test tests/*.test.mjs"
  }
}
---
name: remote-calls
description: Use when writing or changing an adapter that makes any outbound remote
  call to an HTTP API, SDK or remote service; configure timeouts, retries, circuit
  breakers and per-dependency concurrency limits.
metadata:
  aip:
    spec: https://github.com/zach-blumenfeld/aip/tree/v0.3a3
    schemaId: https://raw.githubusercontent.com/zach-blumenfeld/aip/v0.3a3/assets/aip-schemas/procedure.schema.json
---

```yaml
purpose: '- Every remote call has a timeout set from the dependency''s measured latency. (1)

  - Transient faults: capped retries with exponential backoff and jitter, within a retry budget, at one layer, for
  idempotent operations only. (2, 5)

  - Sustained faults: a circuit breaker per dependency that fails fast while open, with a declared fallback. (3)

  - Starvation: a concurrency limit per dependency (bulkhead). (4)

  - All of it wraps the driven adapter, never the domain (`ports-and-adapters`). (1-5)


  Companion inputs: `paths.domain`, `paths.adapters`, `outboundClients` (each client module and its timeout option
  name), `resilience.library`, `resilience.config`, `measurement` (latency percentiles per dependency), `checks.dependencyDirection`,
  `checks.resilienceTests`.'
trigger_when:
- 'Problem 1: A remote call can hang, holding connections or request slots. Signal: an outbound call with no timeout,
  or the library default.'
- 'Problem 2: Transient faults fail requests that would succeed a moment later. Signal: intermittent 503s or connection
  resets, no retry.'
- 'Problem 3: A dependency in sustained failure keeps being called, so callers wait, resources run out and the failure
  spreads. Signal: errors on one dependency followed by latency or errors on unrelated endpoints.'
- 'Problem 4: One slow dependency starves calls to others. Signal: one pool or limiter shared by several dependencies.'
- 'Problem 5: Retries multiply across layers or repeat non-idempotent operations. Signal: retries in both the SDK
  and the caller; a retried create making duplicates.'
do_not_use_when:
- 'The resource is local or in-process. The call runs in a queue or outbox consumer that already retries and dead-letters
  (`domain-events`). The SDK or platform already provides the mechanism: configure that one, do not wrap twice.'
scope_and_approval: '1. Every remote call has a timeout from the dependency''s measured latency (for example p99.9
  plus padding), never the library default.

  2. Retry only idempotent operations or calls with an idempotency key; at one layer; capped attempts; exponential
  backoff with jitter; within a retry budget; honour `Retry-After`.

  3. A breaker exists only for a dependency showing problem 3; one per dependency or shard, never shared.

  4. A breaker counts fault signals only (timeouts, connection errors, 5xx, 429), never client or business errors.

  5. A breaker trips on a failure rate over a time window with a minimum number of calls; half-open lets a limited
  number of trial calls through.

  6. Composition: timeout inside the breaker inside the retry; no retry while the breaker is open.

  7. Every breaker and limit has a declared fallback per call site (fail fast with a clear error, stale data, or
  queue for later), visible to the user (`web-frontend`).

  8. Resilience wraps the port in the driven adapter (a decorator); never in the domain or use case.

  9. Use the resilience library the companion declares; never hand-roll a breaker.

  10. Every breaker state change is logged and exported as a metric.

  11. Every value (timeout, threshold, budget, limit) is per-dependency config with its source measurement or stated
  reason.'
anti_patterns:
- A remote call with no timeout or the library default.
- Retries at several layers (SDK, caller, gateway).
- Retried non-idempotent writes creating duplicates.
- 'Immediate retries without jitter: synchronised retry storms.'
- A breaker around a local resource or business exceptions.
- One breaker shared by independent dependencies or shards.
- A breaker tripping on client or validation errors.
- 'An open breaker with no fallback: a raw exception reaches the user.'
- 'Breaker state changes not logged or exported: invisible modal behaviour.'
- A breaker wrapped around a consumer that already retries and dead-letters.
- A hand-rolled breaker.
- A retry outside the breaker that keeps retrying while it is open.
steps:
- name: p0-1-scan-remote-calls
  description: 'P0 step 1 (script): parse `paths.adapters` for calls to `outboundClients` without their timeout
    option -> `missingTimeouts[]`; parse `paths.domain` for imports of `resilience.library` -> `violations[]` (rule
    8).'
  inputs:
  - name: paths.adapters
    type: list[string]
  - name: paths.domain
    type: list[string]
  - name: outboundClients
    type: list[object]
  - name: resilience.library
    type: string
  outputs:
  - name: missingTimeouts
    type: list[object]
  - name: violations
    type: list[object]
  - name: unsupported
    type: list[object]
  script: scripts/scan_remote_calls.py
- name: p0-2-check-problems
  description: 'P0 step 2 (agent): check the task for problems 1-5 -> `problems[]`.'
  inputs:
  - name: missingTimeouts
    type: list[object]
  - name: violations
    type: list[object]
  - name: unsupported
    type: list[object]
  - name: task
    type: object
  outputs:
  - name: problems
    type: object
  depends_on:
  - p0-1-scan-remote-calls
- name: p0-3-decide-applies
  description: 'P0 step 3 (agent): local resource, queue consumer with retry and dead-letter, or a platform mechanism
    -> stop and configure that; no problems -> stop; else -> `applies`.'
  inputs:
  - name: problems
    type: object
  - name: task
    type: object
  outputs:
  - name: applies
    type: boolean
  depends_on:
  - p0-2-check-problems
- name: p1-1-scope-calls
  description: 'P1 step 1 (agent): scope = the remote calls the task touches; every other call stays unchanged ->
    scope list.'
  inputs:
  - name: applies
    type: boolean
  - name: task
    type: object
  outputs:
  - name: scope
    type: object
  depends_on:
  - p0-3-decide-applies
- name: p1-2-specify-timeouts
  description: 'P1 step 2 (agent): timeout per call from `measurement`; none -> an assumed value with its reason
    in `resilience.config` -> timeout spec.'
  inputs:
  - name: scope
    type: object
  - name: task
    type: object
  - name: resilience.config
    type: object
  - name: measurement
    type: object
  outputs:
  - name: timeout_spec
    type: object
  depends_on:
  - p1-1-scope-calls
- name: p1-3-test-timeouts
  description: 'P1 step 3 (agent): scenario: dependency slower than the timeout -> the call fails within timeout
    plus margin -> failing test.'
  inputs:
  - name: timeout_spec
    type: object
  - name: task
    type: object
  outputs:
  - name: timeout_tests
    type: object
  depends_on:
  - p1-2-specify-timeouts
- name: p1-4-configure-timeouts
  description: 'P1 step 4 (agent): set the timeout in the adapter from config.'
  inputs:
  - name: timeout_tests
    type: object
  - name: task
    type: object
  outputs:
  - name: timeout_changes
    type: object
  depends_on:
  - p1-3-test-timeouts
- name: p1-5-check-timeouts
  description: 'P1 step 5 (script): run `checks.dependencyDirection` and `checks.resilienceTests`.'
  inputs:
  - name: timeout_changes
    type: object
  - name: checks.dependencyDirection
    type: string
  - name: checks.resilienceTests
    type: string
  outputs:
  - name: timeout_checks
    type: object
  depends_on:
  - p1-4-configure-timeouts
  script: scripts/run_check.py
- name: p2-1-check-idempotency
  description: 'P2 step 1 (agent): idempotent or idempotency key? Neither -> no retry, stop.'
  inputs:
  - name: applies
    type: boolean
  - name: task
    type: object
  outputs:
  - name: retry_eligibility
    type: object
  depends_on:
  - p0-3-decide-applies
- name: p2-2-check-retry-layer
  description: 'P2 step 2 (agent): existing retry layer (SDK, gateway)? Yes -> configure it, stop.'
  inputs:
  - name: retry_eligibility
    type: object
  - name: task
    type: object
  outputs:
  - name: retry_layer
    type: object
  depends_on:
  - p2-1-check-idempotency
- name: p2-3-test-retries
  description: 'P2 step 3 (agent): scenarios: transient fault then success; fault past the cap; `Retry-After` honoured
    -> failing tests.'
  inputs:
  - name: retry_layer
    type: object
  - name: task
    type: object
  outputs:
  - name: retry_tests
    type: object
  depends_on:
  - p2-2-check-retry-layer
- name: p2-4-configure-retries
  description: 'P2 step 4 (agent): capped exponential backoff with jitter and a budget, in the adapter via `resilience.library`.'
  inputs:
  - name: retry_tests
    type: object
  - name: task
    type: object
  - name: resilience.library
    type: string
  outputs:
  - name: retry_changes
    type: object
  depends_on:
  - p2-3-test-retries
- name: p2-5-check-retries
  description: 'P2 step 5 (script): run `checks.dependencyDirection` and `checks.resilienceTests`.'
  inputs:
  - name: retry_changes
    type: object
  - name: checks.dependencyDirection
    type: string
  - name: checks.resilienceTests
    type: string
  outputs:
  - name: retry_checks
    type: object
  depends_on:
  - p2-4-configure-retries
  script: scripts/run_check.py
- name: p3-1-check-evidence
  description: 'P3 step 1 (agent): evidence of problem 3 for this dependency; none -> stop.'
  inputs:
  - name: applies
    type: boolean
  - name: task
    type: object
  outputs:
  - name: breaker_evidence
    type: object
  depends_on:
  - p0-3-decide-applies
- name: p3-2-specify-breaker
  description: 'P3 step 2 (agent): breaker per dependency or shard: fault signals, window, failure rate, minimum
    calls, open duration, half-open trials, each with its reason in `resilience.config` -> breaker spec.'
  inputs:
  - name: breaker_evidence
    type: object
  - name: task
    type: object
  - name: resilience.config
    type: object
  outputs:
  - name: breaker_spec
    type: object
  depends_on:
  - p3-1-check-evidence
- name: p3-3-specify-fallback
  description: 'P3 step 3 (agent): fallback per call site, shown to the user -> fallback spec.'
  inputs:
  - name: breaker_spec
    type: object
  - name: task
    type: object
  outputs:
  - name: fallback_spec
    type: object
  depends_on:
  - p3-2-specify-breaker
- name: p3-4-test-breaker
  description: 'P3 step 4 (agent): scenarios: over threshold -> open and fail fast without calling; after open duration
    -> one trial; trial success -> closed; client errors never trip; open -> fallback; no retry while open; state
    change logged and exported -> failing tests.'
  inputs:
  - name: fallback_spec
    type: object
  - name: task
    type: object
  outputs:
  - name: breaker_tests
    type: object
  depends_on:
  - p3-3-specify-fallback
- name: p3-5-compose-breaker
  description: 'P3 step 5 (agent): compose in the adapter: timeout inside breaker inside retry.'
  inputs:
  - name: breaker_tests
    type: object
  - name: task
    type: object
  outputs:
  - name: breaker_changes
    type: object
  depends_on:
  - p3-4-test-breaker
- name: p3-6-emit-state-changes
  description: 'P3 step 6 (agent): emit state changes as a log line and a metric.'
  inputs:
  - name: breaker_changes
    type: object
  - name: task
    type: object
  outputs:
  - name: breaker_observability
    type: object
  depends_on:
  - p3-5-compose-breaker
- name: p3-7-check-breaker
  description: 'P3 step 7 (script): run `checks.dependencyDirection` and `checks.resilienceTests`.'
  inputs:
  - name: breaker_observability
    type: object
  - name: checks.dependencyDirection
    type: string
  - name: checks.resilienceTests
    type: string
  outputs:
  - name: breaker_checks
    type: object
  depends_on:
  - p3-6-emit-state-changes
  script: scripts/run_check.py
- name: p4-1-check-starvation
  description: 'P4 step 1 (agent): evidence of problem 4; none -> stop.'
  inputs:
  - name: applies
    type: boolean
  - name: task
    type: object
  outputs:
  - name: bulkhead_evidence
    type: object
  depends_on:
  - p0-3-decide-applies
- name: p4-2-specify-limit
  description: 'P4 step 2 (agent): concurrency limit and queue size per dependency, with reasons.'
  inputs:
  - name: bulkhead_evidence
    type: object
  - name: task
    type: object
  outputs:
  - name: bulkhead_spec
    type: object
  depends_on:
  - p4-1-check-starvation
- name: p4-3-test-bulkhead
  description: 'P4 step 3 (agent): scenarios: A saturated at its limit -> calls to B succeed; over the limit ->
    fail fast with the fallback -> failing tests.'
  inputs:
  - name: bulkhead_spec
    type: object
  - name: task
    type: object
  outputs:
  - name: bulkhead_tests
    type: object
  depends_on:
  - p4-2-specify-limit
- name: p4-4-configure-limiter
  description: 'P4 step 4 (agent): a separate limiter per dependency in the adapter.'
  inputs:
  - name: bulkhead_tests
    type: object
  - name: task
    type: object
  outputs:
  - name: bulkhead_changes
    type: object
  depends_on:
  - p4-3-test-bulkhead
- name: p4-5-check-bulkhead
  description: 'P4 step 5 (script): run `checks.dependencyDirection` and `checks.resilienceTests`.'
  inputs:
  - name: bulkhead_changes
    type: object
  - name: checks.dependencyDirection
    type: string
  - name: checks.resilienceTests
    type: string
  outputs:
  - name: bulkhead_checks
    type: object
  depends_on:
  - p4-4-configure-limiter
  script: scripts/run_check.py
```

```

```bash
/bin/bash -lc 'ls /tmp/remote-calls-runs/aip/retries/skill/scripts && cat /tmp/remote-calls-runs/aip/retries/skill/scripts/run_check.py && python /tmp/remote-calls-runs/aip/retries/skill/scripts/scan_remote_calls.py --help && rg --files src tests && cat package.json measurement.json src/adapters/* src/core/* src/config.json src/infra/network.js'
```
Exit: 127
```text
__pycache__
run_check.py
scan_javascript.cjs
scan_remote_calls.py
#!/usr/bin/env python3
"""Run the repo companion's check commands and report whether all exit 0.

Usage: run_check.py COMMAND [COMMAND ...]  (each COMMAND is one shell command string)
Prints {"passed": bool, "results": [{"command", "exit", "output"}]}; exits 0 either way.
The commands come from the repo companion (checks.dependencyDirection, the scenario tests).
"""
import json
import subprocess
import sys


def main():
    if len(sys.argv) < 2:
        raise SystemExit("provide companion check commands")
    results = []
    for command in sys.argv[1:]:
        done = subprocess.run(command, shell=True, capture_output=True, text=True)
        results.append({"command": command, "exit": done.returncode, "output": (done.stdout + done.stderr)[-2000:]})
    print(json.dumps({"passed": all(r["exit"] == 0 for r in results), "results": results}))


if __name__ == "__main__":
    main()
/bin/bash: line 1: python: command not found

```

```bash
/bin/bash -lc 'python3 /tmp/remote-calls-runs/aip/retries/skill/scripts/scan_remote_calls.py --help; rg --files src tests; cat package.json measurement.json src/adapters/* src/core/* src/config.json src/infra/network.js'
```
Exit: 0
```text
Traceback (most recent call last):
  File "/tmp/remote-calls-runs/aip/retries/skill/scripts/scan_remote_calls.py", line 129, in <module>
    sys.exit(main())
             ^^^^^^
  File "/tmp/remote-calls-runs/aip/retries/skill/scripts/scan_remote_calls.py", line 83, in main
    companion = json.loads(Path(sys.argv[1]).read_text())
                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.12/pathlib.py", line 1029, in read_text
    with self.open(mode='r', encoding=encoding, errors=errors) as f:
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.12/pathlib.py", line 1015, in open
    return io.open(self, mode, buffering, encoding, errors, newline)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
FileNotFoundError: [Errno 2] No such file or directory: '--help'
rg: tests: No such file or directory (os error 2)
src/config.json
src/infra/telemetry.js
src/infra/network.js
src/adapters/untouched.js
src/adapters/vendor.js
src/core/checkout.js
{
  "name": "remote-calls-fixture",
  "private": true,
  "type": "module",
  "scripts": {
    "check": "node --check src/adapters/vendor.js && node --check src/core/checkout.js"
  },
  "dependencies": {
    "cockatiel": "4.0.0",
    "@sinonjs/fake-timers": "15.4.0",
    "acorn": "8.15.0"
  }
}
{
  "payment": {
    "p999Ms": 80,
    "paddingMs": 20,
    "requestBudgetMs": 2500,
    "transientRetryCap": 3,
    "backoffBaseMs": 40,
    "retryBudgetMs": 2400,
    "breaker": {
      "windowMs": 1000,
      "minimumCalls": 4,
      "failureRate": 0.5,
      "openMs": 200,
      "halfOpenTrials": 1
    },
    "concurrencyLimit": 2,
    "queueSize": 0,
    "reason": "Incident: four consecutive remote 503s exhausted checkout slots; recovery checks every 200 ms. Request budget 2500 ms. Load sample: two calls fit available per-provider capacity; queueing consumes the page latency budget."
  },
  "catalog": {
    "p999Ms": 80,
    "paddingMs": 20,
    "requestBudgetMs": 2500,
    "concurrencyLimit": 2,
    "queueSize": 0,
    "reason": "Catalog has a separate vendor connection budget; payment traffic must not use it."
  }
}
import { request } from '../infra/network.js';
export const readWeather = (network) => request(network, {operation: 'weather'});
import { request } from '../infra/network.js';
export function makeVendor(network, { dependency = 'payment' } = {}) {
  return {
    lookup: (sku) => request(network, { operation: 'lookup', payload: { sku } }),
    charge: (order) => request(network, { operation: 'charge', payload: order }),
  };
}
export async function checkout(vendor, order) {
  const stock = await vendor.lookup(order.sku);
  if (!stock.available) return { status: 'unavailable' };
  await vendor.charge(order);
  return { status: 'confirmed' };
}
{}
// A fake external boundary: scripted status, delay, request ledger, and cancellation.
// No retries, circuit breakers, timeouts, bulkheads, or fallback live here.
export class HttpError extends Error {
  constructor(status, headers = {}) { super(`HTTP ${status}`); this.status = status; this.headers = headers; this.retryAfter = headers["retry-after"]; }
}
export class Network {
  constructor(steps = []) { this.steps = [...steps]; this.requests = []; this.active = 0; this.peak = 0; }
  async send({ operation, payload, signal } = {}) {
    const step = this.steps.shift() ?? { status: 200, value: { available: true } };
    const record = { operation, payload, start: Date.now(), end: null };
    this.requests.push(record); this.active++; this.peak = Math.max(this.peak, this.active);
    try {
      await new Promise((resolve, reject) => {
        let timer;
        const abort = () => { clearTimeout(timer); reject(new Error('network aborted')); };
        if (signal?.aborted) return abort();
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, step.delay ?? 0);
      });
      if (step.status >= 400) throw new HttpError(step.status, step.headers);
      return step.value ?? { available: true };
    } finally { this.active--; record.end = Date.now(); }
  }
}

// Native timeout support of the external HTTP client boundary.
export async function request(network, options = {}) {
  if (options.timeout === undefined) return network.send(options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout);
  try { return await network.send({ ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

```

```bash
/bin/bash -lc 'python3 /tmp/remote-calls-runs/aip/retries/skill/scripts/scan_remote_calls.py companion.json'
```
Exit: 1
```text
{
  "violations": [],
  "missingTimeouts": [
    {
      "path": "/tmp/remote-calls-runs/aip/retries/repo/src/adapters/untouched.js",
      "line": 2,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/aip/retries/repo/src/adapters/vendor.js",
      "line": 4,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/aip/retries/repo/src/adapters/vendor.js",
      "line": 5,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    }
  ],
  "unsupported": [],
  "clean": false
}

```

```bash
/bin/bash -lc "rg -n 'class|next|backoff|delay|execute' node_modules/cockatiel/dist/{RetryPolicy,backoff/ExponentialBackoff,backoff/DelegateBackoff}.d.ts; cat node_modules/cockatiel/dist/RetryPolicy.js; cat /tmp/remote-calls-runs/aip/retries/skill/scripts/scan_remote_calls.py"
```
Exit: 0
```text
node_modules/cockatiel/dist/backoff/DelegateBackoff.d.ts:3:    delay: number;
node_modules/cockatiel/dist/backoff/DelegateBackoff.d.ts:6:export declare class DelegateBackoff<T, S = void> implements IBackoffFactory<T> {
node_modules/cockatiel/dist/backoff/DelegateBackoff.d.ts:10:     * the backoff context, and can optionally take (and return) a state value
node_modules/cockatiel/dist/backoff/DelegateBackoff.d.ts:11:     * that will be passed into subsequent backoff requests.
node_modules/cockatiel/dist/backoff/DelegateBackoff.d.ts:17:    next(context: T): IBackoff<T>;
node_modules/cockatiel/dist/backoff/ExponentialBackoff.d.ts:13:     * @see https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
node_modules/cockatiel/dist/backoff/ExponentialBackoff.d.ts:17:     * Maximum delay, in milliseconds. Defaults to 30s.
node_modules/cockatiel/dist/backoff/ExponentialBackoff.d.ts:25:     * The initial, first delay of the backoff, in milliseconds.
node_modules/cockatiel/dist/backoff/ExponentialBackoff.d.ts:30:export declare class ExponentialBackoff<S> implements IBackoffFactory<unknown> {
node_modules/cockatiel/dist/backoff/ExponentialBackoff.d.ts:33:     * An implementation of exponential backoff.
node_modules/cockatiel/dist/backoff/ExponentialBackoff.d.ts:36:    next(): IBackoff<unknown>;
node_modules/cockatiel/dist/RetryPolicy.d.ts:1:import { IBackoffFactory } from './backoff/Backoff.js';
node_modules/cockatiel/dist/RetryPolicy.d.ts:5: * Context passed into the execute method of the builder.
node_modules/cockatiel/dist/RetryPolicy.d.ts:9:     * The retry attempt, starting at 1 for calls into backoffs.
node_modules/cockatiel/dist/RetryPolicy.d.ts:14: * Context passed into backoff delegate.
node_modules/cockatiel/dist/RetryPolicy.d.ts:24:    backoff: IBackoffFactory<IRetryBackoffContext<unknown>>;
node_modules/cockatiel/dist/RetryPolicy.d.ts:32:export declare class RetryPolicy implements IPolicy<IRetryContext> {
node_modules/cockatiel/dist/RetryPolicy.d.ts:47:     * Emitter that fires when we retry a call, before any backoff.
node_modules/cockatiel/dist/RetryPolicy.d.ts:51:        delay: number;
node_modules/cockatiel/dist/RetryPolicy.d.ts:61:     * loop is kept active while we're delaying a retried call. Calling this
node_modules/cockatiel/dist/RetryPolicy.d.ts:71:    execute<T>(fn: (context: IRetryContext) => PromiseLike<T> | T, signal?: AbortSignal): Promise<T>;
import { ConstantBackoff } from './backoff/ConstantBackoff.js';
import { neverAbortedSignal } from './common/abort.js';
import { EventEmitter } from './common/Event.js';
const delay = (duration, unref) => new Promise(resolve => {
    const timer = setTimeout(resolve, duration);
    if (unref) {
        timer.unref();
    }
});
export class RetryPolicy {
    options;
    executor;
    onGiveUpEmitter = new EventEmitter();
    onRetryEmitter = new EventEmitter();
    /**
     * @inheritdoc
     */
    get onSuccess() {
        return this.executor.onSuccess;
    }
    /**
     * @inheritdoc
     */
    get onFailure() {
        return this.executor.onFailure;
    }
    /**
     * Emitter that fires when we retry a call, before any backoff.
     *
     */
    onRetry = this.onRetryEmitter.addListener;
    /**
     * Emitter that fires when we're no longer retrying a call and are giving up.
     */
    onGiveUp = this.onGiveUpEmitter.addListener;
    constructor(options, executor) {
        this.options = options;
        this.executor = executor;
    }
    /**
     * When retrying, a referenced timer is created. This means the Node.js event
     * loop is kept active while we're delaying a retried call. Calling this
     * method on the retry builder will unreference the timer, allowing the
     * process to exit even if a retry might still be pending.
     */
    dangerouslyUnref() {
        return new RetryPolicy({ ...this.options, unref: true }, this.executor.clone());
    }
    /**
     * Executes the given function with retries.
     * @param fn Function to run
     * @returns a Promise that resolves or rejects with the function results.
     */
    async execute(fn, signal = neverAbortedSignal) {
        const factory = this.options.backoff || new ConstantBackoff(0);
        let backoff;
        for (let retries = 0;; retries++) {
            const result = await this.executor.invoke(fn, { attempt: retries, signal });
            if ('success' in result) {
                return result.success;
            }
            if (!signal.aborted && retries < this.options.maxAttempts) {
                const context = { attempt: retries + 1, signal, result };
                backoff = backoff ? backoff.next(context) : factory.next(context);
                const delayDuration = backoff.duration;
                const delayPromise = delay(delayDuration, !!this.options.unref);
                // A little sneaky reordering here lets us use Sinon's fake timers
                // when we get an emission in our tests.
                this.onRetryEmitter.emit({ ...result, delay: delayDuration, attempt: retries + 1 });
                await delayPromise;
                continue;
            }
            this.onGiveUpEmitter.emit(result);
            if ('error' in result) {
                throw result.error;
            }
            return result.value;
        }
    }
}
//# sourceMappingURL=RetryPolicy.js.map#!/usr/bin/env python3
"""Conservative Python AST scan; see source/README.md for supported syntax.

CLI: scan_remote_calls.py COMPANION.json [REPOSITORY_ROOT]
Companion: paths.{domain,adapters}, outboundClients [{module,timeoutOption}].
Reports violations and unsupported constructs separately; never equates uncertainty
with a clean result. This is evidence for the agent, not an architecture verdict.
"""
import ast
import json
import sys
import subprocess
from pathlib import Path


def scan_source(source, clients, core=False, filename='<source>', resilience_library=None):
    result = {'violations': [], 'missingTimeouts': [], 'unsupported': []}
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError as error:
        result['unsupported'].append({'path': filename, 'line': error.lineno, 'reason': str(error)})
        return result
    aliases = {}
    def configured(name):
        return next((c for c in clients if name == c['module'] or name.startswith(c['module'] + '.')), None)
    def dotted(node):
        if isinstance(node, ast.Name):
            return aliases.get(node.id, node.id)
        if isinstance(node, ast.Attribute):
            base = dotted(node.value)
            return base + '.' + node.attr if base else None
        return None
    def unsupported(node, reason):
        result['unsupported'].append({'path': filename, 'line': node.lineno, 'reason': reason})
    # Imports are resolved structurally, including aliases and imported functions.
    for node in ast.walk(tree):
        imported = []
        if isinstance(node, ast.Import):
            for alias in node.names:
                aliases[alias.asname or alias.name.split('.')[0]] = alias.name if alias.asname else alias.name.split('.')[0]
                imported.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ''
            if node.level:
                unsupported(node, 'relative import requires repository-specific resolution')
            for alias in node.names:
                if alias.name == '*':
                    unsupported(node, 'star import cannot be resolved statically')
                else:
                    name = module + '.' + alias.name if module else alias.name
                    aliases[alias.asname or alias.name] = name
                    imported.append(name)
        for name in imported:
            if core and resilience_library and (name == resilience_library or name.startswith(resilience_library + '.')):
                result['violations'].append({'path': filename, 'line': node.lineno, 'module': name})
    # Constructors/sessions assigned to a name require flow/type analysis. Flag them
    # instead of quietly claiming calls on those objects have been checked.
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            value = node.value
            if isinstance(value, ast.Call) and configured(dotted(value.func) or ''):
                unsupported(node, 'assigned client result requires instance/flow analysis')
            elif isinstance(value, (ast.Name, ast.Attribute)) and configured(dotted(value) or ''):
                unsupported(node, 'assigned client alias requires flow analysis')
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:
                if arg.arg in aliases:
                    unsupported(node, 'parameter shadows imported name ' + arg.arg)
        if isinstance(node, ast.Call):
            target = dotted(node.func) or ''
            if target in ('__import__', 'importlib.import_module'):
                unsupported(node, 'dynamic import requires runtime resolution')
            client = configured(target)
            if client:
                if any(kw.arg is None for kw in node.keywords):
                    unsupported(node, 'expanded keyword arguments may contain timeout option')
                elif not any(kw.arg == client['timeoutOption'] for kw in node.keywords):
                    result['missingTimeouts'].append({'path': filename, 'line': node.lineno, 'call': target, 'timeoutOption': client['timeoutOption']})
    return result


def main():
    companion = json.loads(Path(sys.argv[1]).read_text())
    root = Path(sys.argv[2] if len(sys.argv) > 2 else '.')
    clients = companion['outboundClients']
    if any(not isinstance(c.get('module'), str) or not isinstance(c.get('timeoutOption'), str) for c in clients):
        raise ValueError('every outboundClients item requires module and timeoutOption strings')
    result = {'violations': [], 'missingTimeouts': [], 'unsupported': []}
    paths = companion['paths']
    seen = set()
    for group in ('domain', 'adapters'):
        configured_paths = paths.get(group, [])
        if isinstance(configured_paths, str):
            configured_paths = [configured_paths]
        for entry in configured_paths:
            path = root / entry
            if not path.exists():
                result['unsupported'].append({'path': str(path), 'reason': 'configured scan path does not exist'})
                continue
            files = sorted(path.rglob('*')) if path.is_dir() else [path]
            for file in files:
                if not file.is_file() or file in seen:
                    continue
                seen.add(file)
                if file.suffix in ('.js', '.mjs'):
                    config = {'domain': group == 'domain', 'library': companion['resilience']['library'], 'clients': clients if group == 'adapters' else []}
                    done = subprocess.run(['node', str(Path(__file__).with_name('scan_javascript.cjs')), str(file.resolve()), json.dumps(config)], capture_output=True, text=True)
                    if done.returncode:
                        result['unsupported'].append({'path': str(file), 'reason': done.stderr})
                    else:
                        for key, values in json.loads(done.stdout).items():
                            result[key].extend(values)
                    continue
                if file.suffix != '.py':
                    result['unsupported'].append({'path': str(file), 'reason': 'only Python source is supported; exclude non-source assets from scan paths'})
                    continue
                try:
                    partial = scan_source(file.read_text(), clients if group == 'adapters' else [], group == 'domain', str(file), companion['resilience']['library'])
                except (UnicodeError, OSError) as error:
                    partial = {'unsupported': [{'path': str(file), 'reason': str(error)}]}
                for key, values in partial.items():
                    result[key].extend(values)
    result['clean'] = not any(result.values())
    print(json.dumps(result, indent=2))
    return 0 if result['clean'] else 1


if __name__ == '__main__':
    sys.exit(main())

```

P0 found missing timeouts on both vendor calls and the unrelated weather call, with no domain import violations. Problems 1, 2, and 5 apply. I’ll scope changes to lookup and charge, use the measured 100 ms timeout, and retry lookup only. Charge without an idempotency key stops at P2’s eligibility gate. The task excludes a sustained failure incident, so I won’t add a breaker.


```bash
/bin/bash -lc "python3 - <<'PY'
import subprocess,json
p=subprocess.run(['python3','/tmp/remote-calls-runs/aip/retries/skill/scripts/scan_remote_calls.py','companion.json'],capture_output=True,text=True)
r=json.loads(p.stdout)
json.dump({**{k:r[k] for k in ['missingTimeouts','violations']},'problems':[1,2,5],'applies':True,'proceduresRun':['P0']},open('RESULT.json','w'),indent=2)
PY
mkdir -p tests
cat > tests/vendor.test.mjs <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import FakeTimers from '@sinonjs/fake-timers';
import { makeVendor } from '../src/adapters/vendor.js';
import { Network } from '../src/infra/network.js';

async function timed(run) {
  const clock = FakeTimers.install();
  try { await run(clock); } finally { clock.uninstall(); }
}
test('both calls cancel slow requests within 100 ms', () => timed(async clock => {
  for (const method of ['lookup', 'charge']) {
    const network = new Network([{delay:1000}]);
    const result = assert.rejects(makeVendor(network)[method]({sku:'a'}));
    await clock.runAllAsync();
    await result;
    assert.equal(network.requests[0].end - network.requests[0].start, 100);
    assert.equal(network.active, 0);
  }
}));
EOF
node --test tests/*.test.mjs"
```
Exit: 1
```text
(node:2729123) PromiseRejectionHandledWarning: Promise rejection was handled asynchronously (rejection id: 1)
(Use `node --trace-warnings ...` to show where the warning was created)
✖ tests/vendor.test.mjs (96.567439ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 110.839712

✖ failing tests:

test at tests/vendor.test.mjs:1:1
✖ tests/vendor.test.mjs (96.567439ms)
  'test failed'

```

```bash
/bin/bash -lc "python3 - <<'PY'
p='tests/vendor.test.mjs'
s=open(p).read().replace(\"const result = assert.rejects(makeVendor(network)[method]({sku:'a'}));\",\"const result = makeVendor(network)[method]({sku:'a'}).then(() => null, error => error);\").replace('await result;','assert.ok(await result instanceof Error);')
open(p,'w').write(s)
PY
node --test tests/*.test.mjs
cat > src/config.json <<'EOF'
{
  \"payment\": {
    \"timeoutMs\": 100,
    \"timeoutSource\": \"measurement.json payment: p999Ms 80 + paddingMs 20\",
    \"maxRetries\": 3,
    \"backoffBaseMs\": 40,
    \"backoffMaxMs\": 160,
    \"retryBudgetMs\": 2400,
    \"retrySource\": \"measurement.json payment transientRetryCap, backoffBaseMs, retryBudgetMs; three retries with capped exponential full jitter, under requestBudgetMs 2500\",
    \"backoffMaxReason\": \"Cap exponential delay at base * 2"'^(maxRetries-1)"
  },
  "catalog": {
    "timeoutMs": 100,
    "timeoutSource": "measurement.json catalog: p999Ms 80 + paddingMs 20"
  }
}
EOF
cat > src/adapters/vendor.js <<'"'EOF'
import { request } from '../infra/network.js';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
export function makeVendor(network, { dependency = 'payment' } = {}) {
  const settings = config[dependency];
  if ("'!settings) throw new Error(`No timeout configured for ${dependency}`);
  return {
    lookup: (sku) => request(network, { operation: '"'lookup', payload: { sku }, timeout: settings.timeoutMs }),
    charge: (order) => request(network, { operation: 'charge', payload: order, timeout: settings.timeoutMs }),
  };
}
EOF
python3 /tmp/remote-calls-runs/aip/retries/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
✖ both calls cancel slow requests within 100 ms (11.199427ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 103.591956

✖ failing tests:

test at tests/vendor.test.mjs:11:1
✖ both calls cancel slow requests within 100 ms (11.199427ms)
  AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
  
    assert.ok(await result instanceof Error)
  
      at file:///tmp/remote-calls-runs/aip/retries/repo/tests/vendor.test.mjs:16:12
      at async timed (file:///tmp/remote-calls-runs/aip/retries/repo/tests/vendor.test.mjs:9:9)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 both calls cancel slow requests within 100 ms (8.722694ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 1\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 88.119066\n"}]}

```

```bash
/bin/bash -lc "cat >> tests/vendor.test.mjs <<'EOF'

test('lookup retries transient faults with jitter and respects cap', () => timed(async clock => {
  const network = new Network([{status:503}, {status:429}, {value:{available:true}}]);
  const result = makeVendor(network).lookup('a');
  await clock.runAllAsync();
  assert.deepEqual(await result, {available:true});
  assert.equal(network.requests.length, 3);
  assert.ok(network.requests[1].start > network.requests[0].end);
  const failed = new Network(Array.from({length:8}, () => ({status:503})));
  const outcome = makeVendor(failed).lookup('a').catch(error => error);
  await clock.runAllAsync();
  assert.equal((await outcome).status, 503);
  assert.equal(failed.requests.length, 4);
}));
test('Retry-After is honored and cannot exceed retry budget', () => timed(async clock => {
  for (const seconds of [1, 3]) {
    const network = new Network([{status:429, headers:{'retry-after':String(seconds)}}, {}]);
    const start = Date.now();
    const result = makeVendor(network).lookup('a').catch(error => error);
    await clock.runAllAsync();
    await result;
    assert.equal(network.requests.length, seconds === 1 ? 2 : 1);
    if (seconds === 1) assert.ok(network.requests[1].start - start >= 1000);
    assert.ok(Date.now() - start <= 2400);
  }
}));
test('unkeyed creates and business errors are never retried', () => timed(async clock => {
  for (const [method, status] of [['charge',503], ['lookup',400]]) {
    const network = new Network([{status}, {}]);
    const outcome = makeVendor(network)[method]({sku:'a'}).catch(error => error);
    await clock.runAllAsync();
    assert.equal((await outcome).status, status);
    assert.equal(network.requests.length, 1);
  }
}));
EOF
node --test tests/*.test.mjs"
```
Exit: 1
```text
(node:2740694) PromiseRejectionHandledWarning: Promise rejection was handled asynchronously (rejection id: 1)
(Use `node --trace-warnings ...` to show where the warning was created)
✖ tests/vendor.test.mjs (88.580172ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 99.032645

✖ failing tests:

test at tests/vendor.test.mjs:1:1
✖ tests/vendor.test.mjs (88.580172ms)
  'test failed'

```

P1 passes: both vendor calls now cancel at 100 ms, and the dependency-direction and syntax checks pass. Next I’m adding lookup retries through Cockatiel, with a retry cap, jitter, Retry-After handling, and a budget that reserves time for each attempt.


```bash
/bin/bash -lc "sed -i \"s/const result = makeVendor(network).lookup('a');/const result = makeVendor(network).lookup('a').catch(error => error);/\" tests/vendor.test.mjs
node --test tests/*.test.mjs
cat > src/adapters/vendor.js <<'EOF'
import { request } from '../infra/network.js';
import { readFileSync } from 'node:fs';
import { retry, handleWhen, DelegateBackoff } from 'cockatiel';
const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));

export function makeVendor(network, { dependency = 'payment' } = {}) {
  const settings = config[dependency];
  if ("'!settings) throw new Error(`No timeout configured for ${dependency}`);

  function call(operation, payload, eligible) {
    const send = () => request(network, { operation, payload, timeout: settings.timeoutMs });
    if (!eligible || !settings.maxRetries) return send();
    const started = Date.now();
    let retries = 0;
    let delay = 0;
    const policy = retry(handleWhen(error => {
      const transient = error.status === 429 || error.status >= 500 && error.status <= 599
        || ['"'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code)
        || error.message === 'network aborted';
      if ("'!transient) return false;
      const cap = Math.min(settings.backoffMaxMs, settings.backoffBaseMs * 2 ** retries++);
      const seconds = Number(error.headers?.['"'retry-after']);
      const retryAfter = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 0;
      delay = Math.max(retryAfter, 1 + Math.floor(Math.random() * cap));
      return Date.now() - started + delay + settings.timeoutMs <= settings.retryBudgetMs;
    }), {
      maxAttempts: settings.maxRetries,
      backoff: new DelegateBackoff(() => delay),
    });
    return policy.execute(send);
  }
  return {
    lookup: sku => call('lookup', { sku }, true),
    charge: order => call('charge', order, Boolean(order.idempotencyKey)),
  };
}
EOF
python3 /tmp/remote-calls-runs/aip/retries/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
✖ tests/vendor.test.mjs (96.379254ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 109.096195

✖ failing tests:

test at tests/vendor.test.mjs:1:1
✖ tests/vendor.test.mjs (96.379254ms)
  'test failed'
{"passed": false, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 1, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2716 tests/vendor.test.mjs (100.59825ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 0\n\u2139 fail 1\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 110.823363\n\n\u2716 failing tests:\n\ntest at tests/vendor.test.mjs:1:1\n\u2716 tests/vendor.test.mjs (100.59825ms)\n  'test failed'\n"}]}

```

```bash
/bin/bash -lc 'node --test --test-reporter=tap tests/vendor.test.mjs; cat tests/vendor.test.mjs; cat node_modules/cockatiel/dist/backoff/DelegateBackoff.js'
```
Exit: 0
```text
TAP version 13
# Subtest: tests/vendor.test.mjs
not ok 1 - tests/vendor.test.mjs
  ---
  duration_ms: 100.029649
  type: 'test'
  location: '/tmp/remote-calls-runs/aip/retries/repo/tests/vendor.test.mjs:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 111.303944
import { test } from 'node:test';
import assert from 'node:assert/strict';
import FakeTimers from '@sinonjs/fake-timers';
import { makeVendor } from '../src/adapters/vendor.js';
import { Network } from '../src/infra/network.js';

async function timed(run) {
  const clock = FakeTimers.install();
  try { await run(clock); } finally { clock.uninstall(); }
}
test('both calls cancel slow requests within 100 ms', () => timed(async clock => {
  for (const method of ['lookup', 'charge']) {
    const network = new Network([{delay:1000}]);
    const result = makeVendor(network)[method]({sku:'a'}).then(() => null, error => error);
    await clock.runAllAsync();
    assert.ok(await result instanceof Error);
    assert.equal(network.requests[0].end - network.requests[0].start, 100);
    assert.equal(network.active, 0);
  }
}));

test('lookup retries transient faults with jitter and respects cap', () => timed(async clock => {
  const network = new Network([{status:503}, {status:429}, {value:{available:true}}]);
  const result = makeVendor(network).lookup('a').catch(error => error);
  await clock.runAllAsync();
  assert.deepEqual(await result, {available:true});
  assert.equal(network.requests.length, 3);
  assert.ok(network.requests[1].start > network.requests[0].end);
  const failed = new Network(Array.from({length:8}, () => ({status:503})));
  const outcome = makeVendor(failed).lookup('a').catch(error => error);
  await clock.runAllAsync();
  assert.equal((await outcome).status, 503);
  assert.equal(failed.requests.length, 4);
}));
test('Retry-After is honored and cannot exceed retry budget', () => timed(async clock => {
  for (const seconds of [1, 3]) {
    const network = new Network([{status:429, headers:{'retry-after':String(seconds)}}, {}]);
    const start = Date.now();
    const result = makeVendor(network).lookup('a').catch(error => error);
    await clock.runAllAsync();
    await result;
    assert.equal(network.requests.length, seconds === 1 ? 2 : 1);
    if (seconds === 1) assert.ok(network.requests[1].start - start >= 1000);
    assert.ok(Date.now() - start <= 2400);
  }
}));
test('unkeyed creates and business errors are never retried', () => timed(async clock => {
  for (const [method, status] of [['charge',503], ['lookup',400]]) {
    const network = new Network([{status}, {}]);
    const outcome = makeVendor(network)[method]({sku:'a'}).catch(error => error);
    await clock.runAllAsync();
    assert.equal((await outcome).status, status);
    assert.equal(network.requests.length, 1);
  }
}));
export class DelegateBackoff {
    fn;
    /**
     * Backoff that delegates to a user-provided function. The function takes
     * the backoff context, and can optionally take (and return) a state value
     * that will be passed into subsequent backoff requests.
     */
    constructor(fn) {
        this.fn = fn;
    }
    /**
     * @inheritdoc
     */
    next(context) {
        return instance(this.fn).next(context);
    }
}
const instance = (fn, state, current = 0) => ({
    duration: current,
    next(context) {
        const result = fn(context, state);
        return typeof result === 'number'
            ? instance(fn, state, result)
            : instance(fn, result.state, result.delay);
    },
});
//# sourceMappingURL=DelegateBackoff.js.map
```

```bash
/bin/bash -lc "python3 - <<'PY'
p='tests/vendor.test.mjs';s=open(p).read().replace('FakeTimers.install()', \"FakeTimers.install({toFake:['setTimeout','clearTimeout','Date']})\").replace('new Network([{delay:1000}])','new Network(Array.from({length:4}, () => ({delay:1000})))');open(p,'w').write(s)
PY
python3 /tmp/remote-calls-runs/aip/retries/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 both calls cancel slow requests within 100 ms (8.198642ms)\n\u2714 lookup retries transient faults with jitter and respects cap (4.855764ms)\n\u2714 Retry-After is honored and cannot exceed retry budget (1.82424ms)\n\u2714 unkeyed creates and business errors are never retried (2.536516ms)\n\u2139 tests 4\n\u2139 suites 0\n\u2139 pass 4\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 114.162883\n"}]}

```

```bash
/bin/bash -lc "cat >> tests/vendor.test.mjs <<'EOF'
test('keyed create can retry and independent catalog lookup proceeds', () => timed(async clock => {
  const network = new Network([{status:503}, {}]);
  const order = {sku:'a', idempotencyKey:'order-1'};
  const result = makeVendor(network).charge(order).catch(error => error);
  const catalog = new Network([{}]);
  const other = makeVendor(catalog, {dependency:'catalog'}).lookup('a');
  await clock.runAllAsync();
  await result;
  await other;
  assert.equal(network.requests.length, 2);
  assert.ok(network.requests.every(request => request.payload.idempotencyKey === 'order-1'));
  assert.equal(catalog.requests.length, 1);
}));
EOF
python3 - <<'PY'
p='src/adapters/vendor.js';s=open(p).read();s=s.replace(\"const config =\", \"const isTransient = error => error.status === 429 || error.status >= 500 && error.status <= 599\\n  || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code)\\n  || error.message === 'network aborted';\\nconst config =\")
s=s.replace('function call(operation, payload, eligible) {','async function call(operation, payload, eligible) {\\n    try {\\n      return await execute(operation, payload, eligible);\\n    } catch (error) {\\n      if (isTransient(error)) {\\n        const unavailable = new Error("'`Dependency ${dependency} unavailable`, { cause: error });'"\\n        unavailable.code = \\'PROVIDER_UNAVAILABLE\\';\\n        unavailable.status = error.status;\\n        throw unavailable;\\n      }\\n      throw error;\\n    }\\n  }\\n\\n  function execute(operation, payload, eligible) {')
a=s.index('      const transient =');b=s.index('      const cap',a);s=s[:a]+ '      if ("'!isTransient(error)) return false;'"\\n'+s[b:];open(p,'w').write(s)
p='src/core/checkout.js';open(p,'w').write('''export async function checkout(vendor, order) {
  try {
    const stock = await vendor.lookup(order.sku);
    if ("'!stock.available) return { status: '"'unavailable' };
    await vendor.charge(order);
    return { status: 'confirmed' };
  } catch (error) {
    if (error.code "'!== '"'PROVIDER_UNAVAILABLE') throw error;
    return {
      status: 'temporarily_unavailable',
      message: 'Payments are temporarily unavailable. Please try again later.',
    };
  }
}
''')
PY
cat >> tests/vendor.test.mjs <<'EOF'
test('checkout shows declared fallback after exhausted retries', () => timed(async clock => {
  const { checkout } = await import('../src/core/checkout.js');
  const network = new Network(Array.from({length:4}, () => ({status:503})));
  const outcome = checkout(makeVendor(network), {sku:'a'});
  await clock.runAllAsync();
  assert.deepEqual(await outcome, {
    status:'temporarily_unavailable',
    message:'Payments are temporarily unavailable. Please try again later.',
  });
  assert.ok(network.requests.every(request => request.operation === 'lookup'));
}));
EOF
python3 /tmp/remote-calls-runs/aip/retries/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 both calls cancel slow requests within 100 ms (10.665643ms)\n\u2714 lookup retries transient faults with jitter and respects cap (13.156279ms)\n\u2714 Retry-After is honored and cannot exceed retry budget (2.192945ms)\n\u2714 unkeyed creates and business errors are never retried (8.035446ms)\n\u2714 keyed create can retry and independent catalog lookup proceeds (1.819291ms)\n\u2714 checkout shows declared fallback after exhausted retries (3.7796ms)\n\u2139 tests 6\n\u2139 suites 0\n\u2139 pass 6\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 174.971377\n"}]}

```

All six tests pass, covering timeout cancellation, transient recovery, retry caps, Retry-After and budget limits, create safety, dependency independence, and the checkout fallback. I’m saving the final procedure record and report. The weather adapter and external boundaries remain unchanged.


```bash
/bin/bash -lc "python3 - <<'PY'
import json
p='RESULT.json';r=json.load(open(p));r['proceduresRun']=['P0','P1','P2'];open(p,'w').write(json.dumps(r,indent=2)+'\\n')
PY
cat > /tmp/remote-calls-runs/aip/retries/AGENT_REPORT.md <<'EOF'
# Agent report

Applied the supplied remote-calls skill, using TASK.md, COMPANION.md and companion.json. Procedures actually run: P0, P1, P2.

P0: ran "'`python3 /tmp/remote-calls-runs/aip/retries/skill/scripts/scan_remote_calls.py companion.json` before changes. Exit 1 reported missing timeouts in untouched.js line 2 and vendor.js lines 4 and 5; violations and unsupported were empty. Saved actual missingTimeouts and violations in RESULT.json. Problems [1,2,5] apply: unbounded vendor calls, intermittent 503/429 responses, and unsafe create retries. These are remote calls with no existing retry mechanism; applicability is true. Weather is outside the task and was left unchanged. Initial CLI discovery attempts with unavailable `python` and unsupported `--help` were corrected to the documented Python 3 invocation.

P1: scoped lookup and charge. Configured native timeout 100 ms from payment/catalog p99.9 80 ms plus 20 ms padding. Added a slow-response test and observed failure before implementation, then passed the supplied run_check.py commands. No boundary changes.

P2 gates: lookup is idempotent and eligible; unkeyed charge is ineligible and receives no retries. Keyed charge is eligible and retains its original key. Inspected network and caller: no existing retry layer. Added transient recovery, capped failure and Retry-After scenarios before retry implementation and observed failure. Implemented Cockatiel retry in the driven adapter only: three retries, exponential full jitter with 40 ms base and 160 ms cap, and a 2400 ms elapsed budget reserving 100 ms for the next attempt. Retry-After seconds set the minimum wait; an instruction exceeding the remaining budget causes immediate give-up. Client/business errors are not retried. Config records measurements and reasons. Exhausted provider faults map to the companion'"'s declared checkout fallback, without resilience imports in core.

Test development initially exposed fake-timer interference with Node's test runner; restricted fake timers to Date/setTimeout/clearTimeout. Updated timeout scenario to supply slow responses for all eligible attempts. Final six tests pass, including independent catalog traffic and keyed/unkeyed create behavior.

Verification: ran the supplied "'`python3 /tmp/remote-calls-runs/aip/retries/skill/scripts/run_check.py '"'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"'` after P1 and P2. Final result passed=true; both commands exit 0, six tests pass. P3/P4 were not run or implemented: task requests P0/P1/P2, explicitly excludes sustained-failure breaker work, and supplies no starvation task. Measurement fields alone were not used to expand procedure scope.

Changed src/adapters/vendor.js, src/config.json, src/core/checkout.js; added tests/vendor.test.mjs and RESULT.json. Network, telemetry, measurements, companion, task, checker, and unrelated weather adapter were preserved.
EOF
git status --short'
```
Exit: 128
```text
fatal: not a git repository (or any of the parent directories): .git

```

Completed P0, P1, and P2. Added measured timeouts, bounded Cockatiel retries, create-safety checks, and the declared checkout fallback.

All six tests, syntax checks, and dependency-direction checks pass.

Evidence saved in `RESULT.json`; report saved in `/tmp/remote-calls-runs/aip/retries/AGENT_REPORT.md`.

