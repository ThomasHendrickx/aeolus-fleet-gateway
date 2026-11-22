# Observable transcript: aip-scan

I’ll read the supplied task, skill, and companion files, then run P0 and follow its gates.


```bash
/bin/bash -lc 'cat TASK.md COMPANION.md companion.json /tmp/remote-calls-runs/aip/scan/skill/SKILL.md'
```
Exit: 0
```text
Investigate checkout: outages at the payment provider make checkout hang and other pages slow. First inventory missing timeout settings and layering violations. Run the applicability gate only, record the evidence and leave application files unchanged.
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
/bin/bash -lc "pwd; rg --files -g '"'!node_modules'"' -g 'AGENTS.md' -g 'measurement.json' -g 'src/**' -g 'package.json'; cat /tmp/remote-calls-runs/aip/scan/skill/scripts/scan_remote_calls.py"
```
Exit: 0
```text
/tmp/remote-calls-runs/aip/scan/repo
package.json
measurement.json
src/config.json
src/infra/telemetry.js
src/infra/network.js
src/adapters/vendor.js
src/adapters/untouched.js
src/core/leak.js
src/core/checkout.js
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

```

```bash
/bin/bash -lc 'python /tmp/remote-calls-runs/aip/scan/skill/scripts/scan_remote_calls.py companion.json .'
```
Exit: 127
```text
/bin/bash: line 1: python: command not found

```

```bash
/bin/bash -lc 'cat src/adapters/*.js src/core/*.js measurement.json package.json src/config.json; git status --short'
```
Exit: 128
```text
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
import { retry } from 'cockatiel';
export const leakedPolicy = retry;
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
{}
fatal: not a git repository (or any of the parent directories): .git

```

```bash
/bin/bash -lc 'python3 /tmp/remote-calls-runs/aip/scan/skill/scripts/scan_remote_calls.py companion.json .'
```
Exit: 1
```text
{
  "violations": [
    {
      "path": "/tmp/remote-calls-runs/aip/scan/repo/src/core/leak.js",
      "line": 1,
      "module": "cockatiel"
    }
  ],
  "missingTimeouts": [
    {
      "path": "/tmp/remote-calls-runs/aip/scan/repo/src/adapters/untouched.js",
      "line": 2,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/aip/scan/repo/src/adapters/vendor.js",
      "line": 4,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/aip/scan/repo/src/adapters/vendor.js",
      "line": 5,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    }
  ],
  "unsupported": [
    {
      "path": "/tmp/remote-calls-runs/aip/scan/repo/src/core/leak.js",
      "line": 2,
      "reason": "assigned client alias requires flow analysis"
    }
  ],
  "clean": false
}

```

P0 found three calls without timeouts and one domain import of `cockatiel`. The scanner also flagged an alias it could not fully analyze. The evidence supports problems 1 and 3, so the skill applies. The task requests only the applicability gate; I’ll save the evidence and leave application files unchanged.


```bash
/bin/bash -lc "python3 - <<'PY'
import json, subprocess
from pathlib import Path
command = ['python3', '/tmp/remote-calls-runs/aip/scan/skill/scripts/scan_remote_calls.py', 'companion.json', '.']
scan = subprocess.run(command, capture_output=True, text=True)
result = json.loads(scan.stdout)
result.update(problems=[1, 3], applies=True, proceduresRun=['P0'])
Path('RESULT.json').write_text(json.dumps(result, indent=2) + '\\n')
print('Saved actual scanner output and P0 decision to RESULT.json; scanner exit:', scan.returncode)
PY
npm run check
node dependency-check.mjs"
```
Exit: 1
```text
Saved actual scanner output and P0 decision to RESULT.json; scanner exit: 1

> check
> node --check src/adapters/vendor.js && node --check src/core/checkout.js

src/core/leak.js: cockatiel

```

```bash
/bin/bash -lc "cat > /tmp/remote-calls-runs/aip/scan/AGENT_REPORT.md <<'EOF'
# Applicability investigation

Applied the supplied remote-calls skill. Ran P0 only (scan, problem assessment, applicability decision). TASK.md explicitly requests the applicability gate only and unchanged application files; P1–P4 were not run.

Commands ran from /tmp/remote-calls-runs/aip/scan/repo:
- Initial scanner invocation with "'`python` failed because that executable is absent (exit 127). Used `python3` successfully.
- `python3 /tmp/remote-calls-runs/aip/scan/skill/scripts/scan_remote_calls.py companion.json .` completed with exit 1: three missing timeout settings (untouched.js:2, vendor.js:4 and :5), one domain-layer cockatiel import (core/leak.js:1), and one unsupported assigned alias (core/leak.js:2). The actual JSON output, including unsupported and clean fields, is preserved in RESULT.json together with the P0 decision. The script was rerun to capture its output directly into that file.
- `npm run check` passed syntax checks.
- `node dependency-check.mjs` exited 1, reporting the existing core/leak.js cockatiel import. These baseline checks do not constitute later skill procedures.

P0 decision: problems [1, 3], applies true. Adapter requests omit timeouts (problem 1); the task reports payment outages slowing other pages, and measurement.json describes four consecutive remote 503s exhausting checkout slots (problem 3). Calls use an external HTTP boundary; supplied evidence establishes no queue consumer or existing platform resilience mechanism requiring an exclusion. There is insufficient evidence of transient recovery, a shared limiter, or duplicate/multilayer retries to assert problems 2, 4, or 5. The unsupported alias remains explicitly recorded, rather than treated as a clean scan.

Stopped after P0 as requested. Created RESULT.json and this report. No application, boundary, measurement, companion, checker, or task files were changed. No new tests were necessary for an inventory-only task.
EOF'
```
Exit: 0
```text

```

Completed P0 only. Found three missing timeouts and one layering violation. Problems `[1, 3]` apply; application files remain unchanged.

Saved [RESULT.json](/tmp/remote-calls-runs/aip/scan/repo/RESULT.json) and [report](/tmp/remote-calls-runs/aip/scan/AGENT_REPORT.md).

Syntax checks passed. The dependency check failed on the existing domain import of `cockatiel`.

