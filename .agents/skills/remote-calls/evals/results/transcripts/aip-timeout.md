# Observable transcript: aip-timeout

I’ll read the task, skill, and companion inputs, then run P0 and follow its gates.


```bash
/bin/bash -lc 'cat TASK.md COMPANION.md companion.json /tmp/remote-calls-runs/aip/timeout/skill/SKILL.md'
```
Exit: 0
```text
Payment availability lookup occasionally takes several seconds and holds checkout requests. Set a measured time budget for the payment calls in src/adapters/vendor.js. Weather is outside this task. Apply P0 then P1 only.
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
/bin/bash -lc 'ls -la /tmp/remote-calls-runs/aip/timeout/skill/scripts && cat /tmp/remote-calls-runs/aip/timeout/skill/scripts/scan_remote_calls.py /tmp/remote-calls-runs/aip/timeout/skill/scripts/run_check.py'
```
Exit: 0
```text
total 28
drwxrwxr-x 3 thomas thomas 4096 Nov  9 13:23 .
drwxrwxr-x 4 thomas thomas 4096 Nov  9 13:23 ..
drwxrwxr-x 2 thomas thomas 4096 Nov  9 13:23 __pycache__
-rwxrwxr-x 1 thomas thomas  893 Nov  9 13:22 run_check.py
-rw-rw-r-- 1 thomas thomas 3000 Nov  9 13:21 scan_javascript.cjs
-rw-rw-r-- 1 thomas thomas 6967 Nov  9 13:21 scan_remote_calls.py
#!/usr/bin/env python3
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

```

```bash
/bin/bash -lc 'python /tmp/remote-calls-runs/aip/timeout/skill/scripts/scan_remote_calls.py companion.json .'
```
Exit: 127
```text
/bin/bash: line 1: python: command not found

```

```bash
/bin/bash -lc "rg --files -g '"'!node_modules/**'"' -g '"'!package-lock.json'"' -g '"'!*COMPANION*'"' && cat measurement.json package.json src/adapters/vendor.js src/config.json src/infra/network.js"
```
Exit: 0
```text
measurement.json
companion.json
dependency-check.mjs
package.json
TASK.md
src/config.json
src/infra/telemetry.js
src/infra/network.js
src/core/checkout.js
src/adapters/vendor.js
src/adapters/untouched.js
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
import { request } from '../infra/network.js';
export function makeVendor(network, { dependency = 'payment' } = {}) {
  return {
    lookup: (sku) => request(network, { operation: 'lookup', payload: { sku } }),
    charge: (order) => request(network, { operation: 'charge', payload: order }),
  };
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
/bin/bash -lc 'python3 /tmp/remote-calls-runs/aip/timeout/skill/scripts/scan_remote_calls.py companion.json .'
```
Exit: 1
```text
{
  "violations": [],
  "missingTimeouts": [
    {
      "path": "/tmp/remote-calls-runs/aip/timeout/repo/src/adapters/untouched.js",
      "line": 2,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/aip/timeout/repo/src/adapters/vendor.js",
      "line": 4,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/aip/timeout/repo/src/adapters/vendor.js",
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
/bin/bash -lc 'cat src/adapters/untouched.js && node --version && test -d node_modules'
```
Exit: 0
```text
import { request } from '../infra/network.js';
export const readWeather = (network) => request(network, {operation: 'weather'});
v26.12.0

```

P0 found missing timeouts on both vendor calls and the weather call, with no domain violations. Problem 1 applies to the payment calls. I’ll use the client’s native timeout and the measured budget of 100 ms (80 ms p99.9 + 20 ms padding), leaving weather unchanged. Only P0 and P1 are in scope.


```bash
/bin/bash -lc "mkdir -p tests
python3 - <<'PY'
import json
from pathlib import Path
r={'missingTimeouts':[{'path':str(Path('src/adapters/'+f).resolve()),'line':n,'module':'../infra/network.js','timeoutOption':'timeout'} for f,n in [('untouched.js',2),('vendor.js',4),('vendor.js',5)]],'violations':[],'problems':[1],'applies':True,'proceduresRun':['P0']}
Path('RESULT.json').write_text(json.dumps(r,indent=2)+'\\n')
PY
cat > tests/timeouts.test.mjs <<'EOF'
import test from 'node:test';
import assert from 'node:assert/strict';
import FakeTimers from '@sinonjs/fake-timers';
import { makeVendor } from '../src/adapters/vendor.js';
import { Network } from '../src/infra/network.js';
import { readWeather } from '../src/adapters/untouched.js';

for (const operation of ['lookup', 'charge']) {
  test("'`payment ${operation} aborts at measured 100 ms budget`, async () => {
    const clock = FakeTimers.install();
    try {
      const network = new Network([{ delay: 1000 }]);
      const vendor = makeVendor(network);
      let outcome;
      const pending = vendor[operation](operation === '"'lookup' ? 'sku' : { id: 'order' })
        .then(() => { outcome = 'resolved'; }, () => { outcome = 'rejected'; });
      await clock.tickAsync(99);
      assert.equal(outcome, undefined);
      await clock.tickAsync(2);
      assert.equal(outcome, 'rejected');
      await pending;
      assert.equal(network.active, 0);
      assert.equal(network.requests.length, 1);
      assert.equal(network.requests[0].end - network.requests[0].start, 100);
    } finally { clock.uninstall(); }
  });
}

test('fast payment succeeds and weather retains its behavior', async () => {
  const clock = FakeTimers.install();
  try {
    const payment = new Network([{ delay: 50, value: { available: true } }]);
    const weather = new Network([{ delay: 200, value: { sunny: true } }]);
    const result = makeVendor(payment).lookup('sku');
    const forecast = readWeather(weather);
    await clock.tickAsync(50);
    assert.deepEqual(await result, { available: true });
    await clock.tickAsync(150);
    assert.deepEqual(await forecast, { sunny: true });
    assert.equal(clock.countTimers(), 0);
  } finally { clock.uninstall(); }
});
EOF
node --test tests/*.test.mjs"
```
Exit: 1
```text
✖ tests/timeouts.test.mjs (101.566908ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 117.307148

✖ failing tests:

test at tests/timeouts.test.mjs:1:1
✖ tests/timeouts.test.mjs (101.566908ms)
  'test failed'

```

```bash
/bin/bash -lc 'node tests/timeouts.test.mjs'
```
Exit: 1
```text
✖ payment lookup aborts at measured 100 ms budget (7.756866ms)
✖ payment charge aborts at measured 100 ms budget (1.010235ms)
✔ fast payment succeeds and weather retains its behavior (2.734928ms)
ℹ tests 3
ℹ suites 0
ℹ pass 1
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 18.650446

✖ failing tests:

test at tests/timeouts.test.mjs:9:3
✖ payment lookup aborts at measured 100 ms budget (7.756866ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + undefined
  - 'rejected'
  
      at TestContext.<anonymous> (file:///tmp/remote-calls-runs/aip/timeout/repo/tests/timeouts.test.mjs:20:14)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: 'rejected',
    operator: 'strictEqual',
    diff: 'simple'
  }

test at tests/timeouts.test.mjs:9:3
✖ payment charge aborts at measured 100 ms budget (1.010235ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + undefined
  - 'rejected'
  
      at TestContext.<anonymous> (file:///tmp/remote-calls-runs/aip/timeout/repo/tests/timeouts.test.mjs:20:14)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: 'rejected',
    operator: 'strictEqual',
    diff: 'simple'
  }

```

```bash
/bin/bash -lc "cat > src/config.json <<'EOF'
{
  \"payment\": {
    \"timeoutMs\": 100,
    \"source\": \"measurement.json: payment.p999Ms (80 ms) + payment.paddingMs (20 ms)\",
    \"reason\": \"Bound each payment lookup and charge using measured tail latency plus padding; use the HTTP client's native cancellation.\"
  }
}
EOF
cat > src/adapters/vendor.js <<'EOF'
import { request } from '../infra/network.js';
import config from '../config.json' with { type: 'json' };

export function makeVendor(network, { dependency = 'payment' } = {}) {
  const timeoutOptions = dependency === 'payment' ? { timeout: config.payment.timeoutMs } : {};
  return {
    lookup: (sku) => request(network, { operation: 'lookup', payload: { sku }, ...timeoutOptions }),
    charge: (order) => request(network, { operation: 'charge', payload: order, ...timeoutOptions }),
  };
}
EOF
python3 /tmp/remote-calls-runs/aip/timeout/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 tests/timeouts.test.mjs (97.784232ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 1\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 109.846023\n"}]}

```

Both payment timeout tests failed before the change, then passed with native cancellation at 100 ms. The supplied check runner also passed syntax, dependency direction, and tests. I’m recording the P0 evidence and P1 results; no retry, breaker, or concurrency procedures were run.


```bash
/bin/bash -lc "cat >> tests/timeouts.test.mjs <<'EOF'

test('other vendor dependencies remain unchanged', async () => {
  const clock = FakeTimers.install();
  try {
    const network = new Network([{ delay: 200, value: { available: true } }]);
    const pending = makeVendor(network, { dependency: 'catalog' }).lookup('sku');
    await clock.tickAsync(200);
    assert.deepEqual(await pending, { available: true });
  } finally { clock.uninstall(); }
});
EOF
python3 /tmp/remote-calls-runs/aip/timeout/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'
node tests/timeouts.test.mjs
python3 - <<'PY'
import json
from pathlib import Path
p=Path('RESULT.json'); r=json.loads(p.read_text()); r['proceduresRun']=['P0','P1']; p.write_text(json.dumps(r,indent=2)+'\\n')
Path('/tmp/remote-calls-runs/aip/timeout/AGENT_REPORT.md').write_text('''# Report

Applied the supplied remote-calls skill; ran P0 then P1 only.

P0: "'`python` was unavailable (exit 127), so ran `python3 /tmp/remote-calls-runs/aip/timeout/skill/scripts/scan_remote_calls.py companion.json .`. Exit 1 correctly reported missing timeout options at untouched.js:2 and vendor.js:4,5; violations and unsupported were empty, clean was false. Actual missingTimeouts and violations are preserved in RESULT.json. Task evidence establishes problem 1. The calls are remote, not local or queue consumers, and have no configured timeout policy. Applicability is true. Native HTTP timeout support is used directly rather than adding a duplicate wrapper. Other incident data did not expand the requested procedures.

P1: scoped both payment operations in vendor.js; weather and other dependency behavior remain unchanged. Configured 100 ms from measurement.json payment p99.9 80 ms plus padding 20 ms, recording source and reason in src/config.json. Adapter passes this budget to native request timeout, which cancels outstanding work. No Cockatiel wrapper is necessary for a client-native timeout.

Added deterministic fake-timer tests in tests/timeouts.test.mjs. Before implementation, both slow-payment assertions failed (still pending at 101 ms); fast payment and weather passed. Commands: `node --test tests/*.test.mjs` (exit 1), then `node tests/timeouts.test.mjs` (exit 1 with both expected assertion failures).

After implementation, ran supplied `python3 /tmp/remote-calls-runs/aip/timeout/skill/scripts/run_check.py '"'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"'`: passed true, both commands exit 0. Repeated after adding independent-dependency coverage; passed. Direct test execution also passes all four tests. Tests verify both payment operations abort at exactly 100 ms, release network activity, issue only one request, allow fast success, and preserve weather and catalog behavior.

Changed only the task-scoped adapter, config, new tests, RESULT.json, and this report. No P2–P4 procedures were run; no protected boundary, companion, measurements, task, or checker was modified.
'"''')
PY
git status --short"
```
Exit: 128
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 tests/timeouts.test.mjs (104.944562ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 1\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 114.615607\n"}]}
✔ payment lookup aborts at measured 100 ms budget (8.382134ms)
✔ payment charge aborts at measured 100 ms budget (0.995175ms)
✔ fast payment succeeds and weather retains its behavior (2.015068ms)
✔ other vendor dependencies remain unchanged (0.772402ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 19.26133
fatal: not a git repository (or any of the parent directories): .git

```

Completed P0 and P1. Payment lookup and charge now use a measured 100 ms native timeout. Weather remains unchanged.

All four tests, syntax checks, and dependency direction checks pass.

Saved evidence in [RESULT.json](/tmp/remote-calls-runs/aip/timeout/repo/RESULT.json) and the report in [AGENT_REPORT.md](/tmp/remote-calls-runs/aip/timeout/AGENT_REPORT.md).

