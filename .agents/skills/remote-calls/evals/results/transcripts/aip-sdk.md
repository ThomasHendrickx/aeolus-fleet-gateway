# Observable transcript: aip-sdk

I’ll read the task, skill, and companion files, then run P0 and follow its gates before making any changes.


```bash
/bin/bash -lc 'pwd && cat TASK.md COMPANION.md companion.json && cat /tmp/remote-calls-runs/aip/sdk/skill/SKILL.md'
```
Exit: 0
```text
/tmp/remote-calls-runs/aip/sdk/repo
The payment SDK already performs up to three attempts, but the adapter also retries it: incident logs show six outbound requests for one availability read. Configure the existing layer so the request stays within the SDK attempt budget. Apply P0, P1, P2.
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
/bin/bash -lc "rg --files -g '"'!node_modules/**'"' -g 'AGENTS.md'; cat /tmp/remote-calls-runs/aip/sdk/skill/scripts/scan_remote_calls.py; cat /tmp/remote-calls-runs/aip/sdk/skill/scripts/run_check.py"
```
Exit: 0
```text
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
/bin/bash -lc 'python /tmp/remote-calls-runs/aip/sdk/skill/scripts/scan_remote_calls.py companion.json .'
```
Exit: 127
```text
/bin/bash: line 1: python: command not found

```

```bash
/bin/bash -lc "rg --files -g '"'!node_modules/**'"' -g '"'!package-lock.json'"'; cat src/adapters/* src/config.json measurement.json package.json"
```
Exit: 0
```text
TASK.md
package.json
src/config.json
src/infra/sdk.js
src/infra/telemetry.js
src/infra/network.js
src/adapters/untouched.js
src/adapters/vendor.js
src/core/checkout.js
measurement.json
companion.json
dependency-check.mjs
COMPANION.md
import { request } from '../infra/network.js';
export const readWeather = (network) => request(network, {operation: 'weather'});
import { retry, handleAll } from 'cockatiel';
import { makeSDK } from '../infra/sdk.js';
export function makeVendor(network, {dependency='payment'}={}) {
 const sdk=makeSDK(network); const outer=retry(handleAll,{maxAttempts:1});
 return {lookup:sku=>outer.execute(()=>sdk.lookup(sku)),charge:order=>sdk.charge(order)};
}
{}
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

```

```bash
/bin/bash -lc 'python3 /tmp/remote-calls-runs/aip/sdk/skill/scripts/scan_remote_calls.py companion.json .; cat src/infra/sdk.js src/infra/network.js; git status --short'
```
Exit: 128
```text
{
  "violations": [],
  "missingTimeouts": [
    {
      "path": "/tmp/remote-calls-runs/aip/sdk/repo/src/adapters/untouched.js",
      "line": 2,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    }
  ],
  "unsupported": [],
  "clean": false
}
import { retry, handleAll } from 'cockatiel';
import { request } from './network.js';
// Existing real retry implementation at the SDK boundary: three total attempts.
export function makeSDK(network) {
 const policy=retry(handleAll, {maxAttempts:2});
 return {lookup: sku => policy.execute(()=>request(network,{operation:'lookup',payload:{sku},timeout:100})),
 charge: order => request(network,{operation:'charge',payload:order,timeout:100})};
}
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
fatal: not a git repository (or any of the parent directories): .git

```

P0 found the duplicate retry layer: the SDK makes up to three attempts, and the adapter can repeat that sequence. The skill’s P0 gate says to configure the existing mechanism and stop, so I won’t run P1 or P2. I’ll remove the adapter retry and test that a lookup stays within three outbound requests. The scanner also found an unbounded weather call outside this task’s scope.


```bash
/bin/bash -lc "mkdir -p tests; node -e \"import('cockatiel').then(()=>console.log('cockatiel available'))\""
```
Exit: 0
```text
cockatiel available

```

```bash
/bin/bash -lc "cat > RESULT.json <<'EOF'
{
  \"missingTimeouts\": [
    {
      \"path\": \"/tmp/remote-calls-runs/aip/sdk/repo/src/adapters/untouched.js\",
      \"line\": 2,
      \"module\": \"../infra/network.js\",
      \"timeoutOption\": \"timeout\"
    }
  ],
  \"violations\": [],
  \"problems\": [1, 5],
  \"applies\": false,
  \"proceduresRun\": [\"P0\"]
}
EOF
cat > tests/vendor.test.mjs <<'EOF'
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeVendor } from '../src/adapters/vendor.js';
import { Network } from '../src/infra/network.js';

test('lookup stops at the existing SDK three-attempt budget', async () => {
  const network = new Network(Array.from({length: 6}, () => ({status: 503})));
  await assert.rejects(makeVendor(network).lookup('sku'), {status: 503});
  assert.equal(network.requests.length, 3);
});

test('lookup can recover on the third SDK attempt', async () => {
  const network = new Network([{status: 503}, {status: 503}, {value: {available: true}}]);
  assert.deepEqual(await makeVendor(network).lookup('sku'), {available: true});
  assert.equal(network.requests.length, 3);
});

test('charge without an idempotency key is attempted once', async () => {
  const network = new Network([{status: 503}]);
  await assert.rejects(makeVendor(network).charge({id: 'order'}), {status: 503});
  assert.equal(network.requests.length, 1);
});
EOF
node --test tests/*.test.mjs"
```
Exit: 1
```text
✖ lookup stops at the existing SDK three-attempt budget (17.419362ms)
✔ lookup can recover on the third SDK attempt (7.184883ms)
✔ charge without an idempotency key is attempted once (1.990004ms)
ℹ tests 3
ℹ suites 0
ℹ pass 2
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 117.320483

✖ failing tests:

test at tests/vendor.test.mjs:6:1
✖ lookup stops at the existing SDK three-attempt budget (17.419362ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  6 !== 3
  
      at TestContext.<anonymous> (file:///tmp/remote-calls-runs/aip/sdk/repo/tests/vendor.test.mjs:9:10)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 6,
    expected: 3,
    operator: 'strictEqual',
    diff: 'simple'
  }

```

```bash
/bin/bash -lc "cat > src/adapters/vendor.js <<'EOF'
import { makeSDK } from '../infra/sdk.js';

export function makeVendor(network, {dependency='payment'}={}) {
 const sdk = makeSDK(network);
 // The SDK owns retries and enforces its three-attempt budget.
 return {lookup: sku => sdk.lookup(sku), charge: order => sdk.charge(order)};
}
EOF
cat > src/config.json <<'EOF'
{
  \"payment\": {
    \"retryOwner\": \"sdk\",
    \"adapterRetries\": 0,
    \"source\": \"TASK.md and src/infra/sdk.js: the SDK already allows three total attempts; the incident recorded six when the adapter retried the SDK sequence.\",
    \"reason\": \"Delegate directly to the SDK so one availability read stays within its existing attempt budget.\"
  }
}
EOF
python3 /tmp/remote-calls-runs/aip/sdk/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 lookup stops at the existing SDK three-attempt budget (9.858514ms)\n\u2714 lookup can recover on the third SDK attempt (7.520805ms)\n\u2714 charge without an idempotency key is attempted once (1.301824ms)\n\u2139 tests 3\n\u2139 suites 0\n\u2139 pass 3\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 123.746202\n"}]}

```

```bash
/bin/bash -lc "cat > /tmp/remote-calls-runs/aip/sdk/AGENT_REPORT.md <<'EOF'
# Agent report

Applied the supplied remote-calls skill. Ran P0 only. The scanner command "'`python3 /tmp/remote-calls-runs/aip/sdk/skill/scripts/scan_remote_calls.py companion.json .` exited 1 and reported one missing timeout in src/adapters/untouched.js, no violations, no unsupported constructs, and clean=false. The first invocation with `python` failed because that executable is absent; reran successfully with python3. RESULT.json preserves the scanner findings and the P0 decision.

Identified problems 1 (scanner'"'s unrelated weather timeout) and 5 (SDK and adapter retries multiply). P0 step 3 stops at an existing platform/SDK mechanism and directs configuring that mechanism. Set applies=false; did not run P1 or P2 despite their request, preserving the skill's gate. No breaker, limiter, timeout expansion, or unrelated weather changes were made.

Removed the adapter's outer Cockatiel retry and delegated directly to the existing SDK, which retains its three-attempt policy. Added payment retry ownership, adapter retry count, source, and reason to src/config.json. Preserved the public API and all boundaries.

Added tests for exhausted lookup attempts, recovery on the third attempt, and a single unkeyed charge attempt. Before the fix, "'`node --test tests/*.test.mjs` failed the cap regression with six requests instead of three (two other tests passed). After the fix, ran the supplied run_check.py with `node dependency-check.mjs` and `npm run check && node --test tests/*.test.mjs`: both commands exited 0, all three tests passed. Running this check helper validates the gate-directed correction; it does not mean P1 or P2 were executed. Installed dependencies were already available.
EOF'
```
Exit: 0
```text

```

Removed the adapter retry; lookups now stay within the SDK’s three-attempt budget.

P0’s existing-SDK gate stopped P1/P2. Recorded the findings and decision in `RESULT.json`, and documented the work in `/tmp/remote-calls-runs/aip/sdk/AGENT_REPORT.md`.

All three regression tests, syntax checks, and dependency-direction checks pass.

