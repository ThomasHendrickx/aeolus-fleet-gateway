# Observable transcript: aip-breaker

I’ll read the task, skill, and companion files, then run P0 and follow its gate decisions.


```bash
/bin/bash -lc 'pwd && cat TASK.md COMPANION.md companion.json /tmp/remote-calls-runs/aip/breaker/skill/SKILL.md'
```
Exit: 0
```text
/tmp/remote-calls-runs/aip/breaker/repo
Outages at the payment provider make checkout hang and other pages slow. Four failures within a second are common in an outage; an outage can last minutes, and payment recovers abruptly. Isolate sustained payment failure, recover when healthy, and make checkout display the declared unavailable state. Catalog is healthy. Apply P0, P1, P2, P3.
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
/bin/bash -lc "rg --files -g '"'!node_modules/**'"' . /tmp/remote-calls-runs/aip/breaker/skill/scripts && cat /tmp/remote-calls-runs/aip/breaker/skill/scripts/*.py"
```
Exit: 0
```text
/tmp/remote-calls-runs/aip/breaker/skill/scripts/scan_remote_calls.py
/tmp/remote-calls-runs/aip/breaker/skill/scripts/__pycache__/scan_remote_calls.cpython-312.pyc
/tmp/remote-calls-runs/aip/breaker/skill/scripts/scan_javascript.cjs
/tmp/remote-calls-runs/aip/breaker/skill/scripts/run_check.py
./TASK.md
./package.json
./package-lock.json
./src/config.json
./companion.json
./dependency-check.mjs
./COMPANION.md
./src/infra/telemetry.js
./src/infra/network.js
./src/adapters/untouched.js
./src/adapters/vendor.js
./measurement.json
./src/core/checkout.js
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
/bin/bash -lc 'python /tmp/remote-calls-runs/aip/breaker/skill/scripts/scan_remote_calls.py companion.json . > p0-scan.json; cat p0-scan.json; cat src/adapters/*.js src/core/*.js src/infra/*.js src/config.json measurement.json package.json'
```
Exit: 0
```text
/bin/bash: line 1: python: command not found
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
// Existing application telemetry boundary. Both exported arrays are event ledgers.
export const logs = [];
export const metrics = [];
export function log(event) { logs.push(event); }
export function metric(event) { metrics.push(event); }
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
/bin/bash -lc 'python3 /tmp/remote-calls-runs/aip/breaker/skill/scripts/scan_remote_calls.py companion.json . > p0-scan.json; cat p0-scan.json; ls node_modules/cockatiel/dist; cat node_modules/cockatiel/dist/SamplingBreaker.d.ts node_modules/cockatiel/dist/CircuitBreakerPolicy.d.ts node_modules/cockatiel/dist/RetryPolicy.d.ts'
```
Exit: 1
```text
{
  "violations": [],
  "missingTimeouts": [
    {
      "path": "/tmp/remote-calls-runs/aip/breaker/repo/src/adapters/untouched.js",
      "line": 2,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/aip/breaker/repo/src/adapters/vendor.js",
      "line": 4,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/aip/breaker/repo/src/adapters/vendor.js",
      "line": 5,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    }
  ],
  "unsupported": [],
  "clean": false
}
BulkheadPolicy.d.ts
BulkheadPolicy.js
BulkheadPolicy.js.map
CircuitBreakerPolicy.d.ts
CircuitBreakerPolicy.js
CircuitBreakerPolicy.js.map
FallbackPolicy.d.ts
FallbackPolicy.js
FallbackPolicy.js.map
NoopPolicy.d.ts
NoopPolicy.js
NoopPolicy.js.map
Policy.d.ts
Policy.js
Policy.js.map
RetryPolicy.d.ts
RetryPolicy.js
RetryPolicy.js.map
TimeoutPolicy.d.ts
TimeoutPolicy.js
TimeoutPolicy.js.map
backoff
breaker
common
errors
index.d.ts
index.js
index.js.map
cat: node_modules/cockatiel/dist/SamplingBreaker.d.ts: No such file or directory
import { IBackoffFactory } from './backoff/Backoff.js';
import { IBreaker } from './breaker/Breaker.js';
import { ExecuteWrapper } from './common/Executor.js';
import { FailureReason, IDefaultPolicyContext, IPolicy } from './Policy.js';
export declare enum CircuitState {
    /**
     * Normal operation. Execution of actions allowed.
     */
    Closed = 0,
    /**
     * The automated controller has opened the circuit. Execution of actions blocked.
     */
    Open = 1,
    /**
     * Recovering from open state, after the automated break duration has
     * expired. Execution of actions permitted. Success of subsequent action/s
     * controls onward transition to Open or Closed state.
     */
    HalfOpen = 2,
    /**
     * Circuit held manually in an open state. Execution of actions blocked.
     */
    Isolated = 3
}
/**
 * Context passed into halfOpenAfter backoff delegate.
 */
export interface IHalfOpenAfterBackoffContext extends IDefaultPolicyContext {
    /**
     * The consecutive number of times the circuit has entered the
     * {@link CircuitState.Open} state.
     */
    attempt: number;
    /**
     * The result of the last method call that caused the circuit to enter the
     * {@link CircuitState.Open} state. Either a thrown error, or a value that we
     * determined should open the circuit.
     */
    result: FailureReason<unknown>;
}
export interface ICircuitBreakerOptions {
    breaker: IBreaker;
    /**
     * When to (potentially) enter the {@link CircuitState.HalfOpen} state from
     * the {@link CircuitState.Open} state. Either a duration in milliseconds or a
     * backoff factory.
     */
    halfOpenAfter: number | IBackoffFactory<IHalfOpenAfterBackoffContext>;
    /**
     * Controls how many calls are sampled while the circuit is half-open before
     * deciding whether to close or reopen it. Defaults to a single call with no
     * permitted failures, matching the traditional circuit breaker behavior.
     */
    halfOpenSampling?: IHalfOpenSamplingOptions;
    /**
     * Initial state from a previous call to {@link CircuitBreakerPolicy.toJSON}.
     */
    initialState?: unknown;
}
export interface IHalfOpenSamplingOptions {
    /**
     * Number of calls to allow through while half-open before closing the circuit
     * if the failure threshold is not exceeded.
     */
    calls: number;
    /**
     * Percentage (from 0 to 1) of half-open calls that may fail before the
     * circuit is reopened.
     */
    threshold: number;
}
export declare class CircuitBreakerPolicy implements IPolicy {
    private readonly options;
    private readonly executor;
    readonly _altReturn: never;
    private readonly breakEmitter;
    private readonly resetEmitter;
    private readonly halfOpenEmitter;
    private readonly stateChangeEmitter;
    private readonly halfOpenAfterBackoffFactory;
    private readonly halfOpenSampling;
    private innerLastFailure?;
    private innerState;
    /**
     * Event emitted when the circuit breaker opens.
     */
    readonly onBreak: import("./common/Event.js").Event<FailureReason<unknown> | {
        isolated: true;
    }>;
    /**
     * Event emitted when the circuit breaker resets.
     */
    readonly onReset: import("./common/Event.js").Event<void>;
    /**
     * Event emitted when the circuit breaker is half open (running a test call).
     * Either `onBreak` on `onReset` will subsequently fire.
     */
    readonly onHalfOpen: import("./common/Event.js").Event<void>;
    /**
     * Fired whenever the circuit breaker state changes.
     */
    readonly onStateChange: import("./common/Event.js").Event<CircuitState>;
    /**
     * @inheritdoc
     */
    get onSuccess(): import("./common/Event.js").Event<import("./Policy.js").ISuccessEvent>;
    /**
     * @inheritdoc
     */
    get onFailure(): import("./common/Event.js").Event<import("./Policy.js").IFailureEvent>;
    /**
     * Gets the current circuit breaker state.
     */
    get state(): CircuitState;
    /**
     * Gets the last reason the circuit breaker failed.
     */
    get lastFailure(): FailureReason<unknown> | undefined;
    constructor(options: ICircuitBreakerOptions, executor: ExecuteWrapper);
    /**
     * Manually holds open the circuit breaker.
     * @returns A handle that keeps the breaker open until `.dispose()` is called.
     */
    isolate(): {
        dispose: () => void;
    };
    /**
     * Executes the given function.
     * @param fn Function to run
     * @throws a {@link BrokenCircuitError} if the circuit is open
     * @throws a {@link IsolatedCircuitError} if the circuit is held
     * open via {@link CircuitBreakerPolicy.isolate}
     * @returns a Promise that resolves or rejects with the function results.
     */
    execute<T>(fn: (context: IDefaultPolicyContext) => PromiseLike<T> | T, signal?: AbortSignal): Promise<T>;
    private executeHalfOpen;
    /**
     * Captures circuit breaker state that can later be used to recreate the
     * breaker by passing `state` to the `circuitBreaker` function. This is
     * useful in cases like serverless functions where you may want to keep
     * the breaker state across multiple executions.
     */
    toJSON(): unknown;
    private recordHalfOpenSuccess;
    private recordHalfOpenFailure;
    private maybeCompleteHalfOpen;
    private open;
    private close;
    private createHalfOpenSamplingOptions;
}
import { IBackoffFactory } from './backoff/Backoff.js';
import { ExecuteWrapper } from './common/Executor.js';
import { FailureReason, IDefaultPolicyContext, IPolicy } from './Policy.js';
/**
 * Context passed into the execute method of the builder.
 */
export interface IRetryContext extends IDefaultPolicyContext {
    /**
     * The retry attempt, starting at 1 for calls into backoffs.
     */
    attempt: number;
}
/**
 * Context passed into backoff delegate.
 */
export interface IRetryBackoffContext<R> extends IRetryContext {
    /**
     * The result of the last method call. Either a thrown error, or a value
     * that we determined should be retried upon.
     */
    result: FailureReason<R>;
}
export interface IRetryPolicyConfig {
    backoff: IBackoffFactory<IRetryBackoffContext<unknown>>;
    maxAttempts: number;
    /**
     * Whether to unreference the internal timer. This means the policy will not
     * keep the Node.js even loop active. Defaults to `false`.
     */
    unref?: boolean;
}
export declare class RetryPolicy implements IPolicy<IRetryContext> {
    private options;
    private readonly executor;
    readonly _altReturn: never;
    private readonly onGiveUpEmitter;
    private readonly onRetryEmitter;
    /**
     * @inheritdoc
     */
    get onSuccess(): import("./common/Event.js").Event<import("./Policy.js").ISuccessEvent>;
    /**
     * @inheritdoc
     */
    get onFailure(): import("./common/Event.js").Event<import("./Policy.js").IFailureEvent>;
    /**
     * Emitter that fires when we retry a call, before any backoff.
     *
     */
    readonly onRetry: import("./common/Event.js").Event<FailureReason<unknown> & {
        delay: number;
        attempt: number;
    }>;
    /**
     * Emitter that fires when we're no longer retrying a call and are giving up.
     */
    readonly onGiveUp: import("./common/Event.js").Event<FailureReason<unknown>>;
    constructor(options: Readonly<IRetryPolicyConfig>, executor: ExecuteWrapper);
    /**
     * When retrying, a referenced timer is created. This means the Node.js event
     * loop is kept active while we're delaying a retried call. Calling this
     * method on the retry builder will unreference the timer, allowing the
     * process to exit even if a retry might still be pending.
     */
    dangerouslyUnref(): RetryPolicy;
    /**
     * Executes the given function with retries.
     * @param fn Function to run
     * @returns a Promise that resolves or rejects with the function results.
     */
    execute<T>(fn: (context: IRetryContext) => PromiseLike<T> | T, signal?: AbortSignal): Promise<T>;
}

```

P0 found missing timeouts in both vendor calls and the unrelated weather adapter, with no domain import violations. Problems 1 and 3 apply. I’ll leave weather unchanged, add measured timeouts to the vendor, allow retries for reads and keyed charges, and add a payment-only breaker based on the incident evidence.


```bash
/bin/bash -lc 'cat node_modules/cockatiel/dist/breaker/SamplingBreaker.{d.ts,js} node_modules/cockatiel/dist/backoff/DelegateBackoff.d.ts node_modules/cockatiel/dist/RetryPolicy.js; cat node_modules/cockatiel/dist/Policy.d.ts | head -100'
```
Exit: 0
```text
import { CircuitState } from '../CircuitBreakerPolicy.js';
import { IBreaker } from './Breaker.js';
export interface ISamplingBreakerOptions {
    /**
     * Percentage (from 0 to 1) of requests that need to fail before we'll
     * open the circuit.
     */
    threshold: number;
    /**
     * Length of time over which to sample.
     */
    duration: number;
    /**
     * Minimum number of RPS needed to be able to (potentially) open the circuit.
     * Useful to avoid unnecessarily tripping under low load.
     */
    minimumRps?: number;
}
export declare class SamplingBreaker implements IBreaker {
    private readonly threshold;
    private readonly minimumRpms;
    private readonly duration;
    private readonly windowSize;
    private windows;
    private currentWindow;
    private currentFailures;
    private currentSuccesses;
    /**
     * @inheritdoc
     */
    get state(): unknown;
    /**
     * @inheritdoc
     */
    set state(value: unknown);
    /**
     * SamplingBreaker breaks if more than `threshold` percentage of calls over the
     * last `samplingDuration`, so long as there's at least `minimumRps` (to avoid
     * opening unnecessarily under low RPS).
     */
    constructor({ threshold, duration: samplingDuration, minimumRps }: ISamplingBreakerOptions);
    /**
     * @inheritdoc
     */
    success(state: CircuitState): void;
    /**
     * @inheritdoc
     */
    failure(state: CircuitState): boolean;
    private resetWindows;
    private rotateWindow;
    private push;
}
import { CircuitState } from '../CircuitBreakerPolicy.js';
export class SamplingBreaker {
    threshold;
    minimumRpms;
    duration;
    windowSize;
    windows = [];
    currentWindow = 0;
    currentFailures = 0;
    currentSuccesses = 0;
    /**
     * @inheritdoc
     */
    get state() {
        return {
            windows: this.windows.map(w => ({ ...w })),
            currentWindow: this.currentWindow,
            currentFailures: this.currentFailures,
            currentSuccesses: this.currentSuccesses,
        };
    }
    /**
     * @inheritdoc
     */
    set state(value) {
        Object.assign(this, structuredClone(value));
    }
    /**
     * SamplingBreaker breaks if more than `threshold` percentage of calls over the
     * last `samplingDuration`, so long as there's at least `minimumRps` (to avoid
     * opening unnecessarily under low RPS).
     */
    constructor({ threshold, duration: samplingDuration, minimumRps }) {
        if (threshold <= 0 || threshold >= 1) {
            throw new RangeError(`SamplingBreaker threshold should be between (0, 1), got ${threshold}`);
        }
        this.threshold = threshold;
        // at least 5 windows, max 1 second each:
        const windowCount = Math.max(5, Math.ceil(samplingDuration / 1000));
        for (let i = 0; i < windowCount; i++) {
            this.windows.push({ startedAt: 0, failures: 0, successes: 0 });
        }
        this.windowSize = Math.round(samplingDuration / windowCount);
        this.duration = this.windowSize * windowCount;
        if (minimumRps) {
            this.minimumRpms = minimumRps / 1000;
        }
        else {
            // for our rps guess, set it so at least 5 failures per second
            // are needed to open the circuit
            this.minimumRpms = 5 / (threshold * 1000);
        }
    }
    /**
     * @inheritdoc
     */
    success(state) {
        if (state === CircuitState.HalfOpen) {
            this.resetWindows();
        }
        this.push(true);
    }
    /**
     * @inheritdoc
     */
    failure(state) {
        this.push(false);
        if (state !== CircuitState.Closed) {
            return true;
        }
        const total = this.currentSuccesses + this.currentFailures;
        // If we don't have enough rps, then the circuit is open.
        // 1. `total / samplingDuration` gets rps
        // 2. We want `rpms < minimumRpms`
        // 3. Simplifies to `total < samplingDuration * minimumRps`
        if (total < this.duration * this.minimumRpms) {
            return false;
        }
        // If we're above threshold, open the circuit
        // 1. `failures / total > threshold`
        // 2. `failures > threshold * total`
        if (this.currentFailures > this.threshold * total) {
            return true;
        }
        return false;
    }
    resetWindows() {
        this.currentFailures = 0;
        this.currentSuccesses = 0;
        for (const window of this.windows) {
            window.failures = 0;
            window.successes = 0;
            window.startedAt = 0;
        }
    }
    rotateWindow(now) {
        const next = (this.currentWindow + 1) % this.windows.length;
        this.currentFailures -= this.windows[next].failures;
        this.currentSuccesses -= this.windows[next].successes;
        const window = (this.windows[next] = { failures: 0, successes: 0, startedAt: now });
        this.currentWindow = next;
        return window;
    }
    push(success) {
        const now = Date.now();
        // Get the current time period window, advance if necessary
        let window = this.windows[this.currentWindow];
        if (now - window.startedAt >= this.windowSize) {
            window = this.rotateWindow(now);
        }
        // Increment current counts
        if (success) {
            window.successes++;
            this.currentSuccesses++;
        }
        else {
            window.failures++;
            this.currentFailures++;
        }
    }
}
//# sourceMappingURL=SamplingBreaker.js.mapimport { IBackoff, IBackoffFactory } from './Backoff.js';
export type DelegateBackoffFn<T, S = void> = (context: T, state?: S) => {
    delay: number;
    state: S;
} | number;
export declare class DelegateBackoff<T, S = void> implements IBackoffFactory<T> {
    private readonly fn;
    /**
     * Backoff that delegates to a user-provided function. The function takes
     * the backoff context, and can optionally take (and return) a state value
     * that will be passed into subsequent backoff requests.
     */
    constructor(fn: DelegateBackoffFn<T, S>);
    /**
     * @inheritdoc
     */
    next(context: T): IBackoff<T>;
}
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
//# sourceMappingURL=RetryPolicy.js.mapimport { IBackoffFactory } from './backoff/Backoff.js';
import { BulkheadPolicy } from './BulkheadPolicy.js';
import { CircuitBreakerPolicy, ICircuitBreakerOptions } from './CircuitBreakerPolicy.js';
import { Event } from './common/Event.js';
import { FallbackPolicy } from './FallbackPolicy.js';
import { NoopPolicy } from './NoopPolicy.js';
import { IRetryBackoffContext, RetryPolicy } from './RetryPolicy.js';
import { TimeoutPolicy, TimeoutStrategy } from './TimeoutPolicy.js';
type Constructor<T> = new (...args: any) => T;
export interface IBasePolicyOptions {
    errorFilter: (error: unknown) => boolean;
    resultFilter: (result: unknown) => boolean;
}
/**
 * The reason for a call failure. Either an error, or the a value that was
 * marked as a failure (when using result filtering).
 */
export type FailureReason<ReturnType> = {
    error: unknown;
} | {
    value: ReturnType;
};
/**
 * Event emitted on the `onFailure` calls.
 */
export interface IFailureEvent {
    /**
     * Call duration, in milliseconds (with nanosecond precision, as the OS allows).
     */
    duration: number;
    /**
     * Whether the error was handled by the policy.
     */
    handled: boolean;
    /**
     * The reason for the error.
     */
    reason: FailureReason<unknown>;
}
/**
 * Event emitted on the `onSuccess` calls.
 */
export interface ISuccessEvent {
    /**
     * Call duration, in milliseconds (with nanosecond precision, as the OS allows).
     */
    duration: number;
}
export interface IDefaultPolicyContext {
    /**
     * Abort signal for the operation. This is propagated through multiple
     * retry policies.
     */
    signal: AbortSignal;
}
/**
 * IPolicy is the type of all policies that Cockatiel provides. It describes
 * an execute() function which takes a generic argument.
 */
export interface IPolicy<ContextType extends IDefaultPolicyContext = IDefaultPolicyContext, AltReturn = never> {
    /**
     * Virtual property only used for TypeScript--will not actually be defined.
     * @deprecated This property does not exist
     */
    readonly _altReturn: AltReturn;
    /**
     * Fires on the policy when a request successfully completes and some
     * successful value will be returned. In a retry policy, this is fired once
     * even if the request took multiple retries to succeed.
     */
    readonly onSuccess: Event<ISuccessEvent>;
    /**
     * Fires on the policy when a request fails *due to a handled reason* fails
     * and will give rejection to the called.
     */
    readonly onFailure: Event<IFailureEvent>;
    /**
     * Runs the function through behavior specified by the policy.
     */
    execute<T>(fn: (context: ContextType) => PromiseLike<T> | T, signal?: AbortSignal): Promise<T | AltReturn>;
}
export interface IMergedPolicy<A extends IDefaultPolicyContext, B, W extends IPolicy<any, any>[]> extends IPolicy<A, B> {
    readonly wrapped: W;
}
type MergePolicies<A, B> = A extends IPolicy<infer A1, any> ? B extends IPolicy<infer B1, any> ? IMergedPolicy<A1 & B1, A['_altReturn'] | B['_altReturn'], B extends IMergedPolicy<any, any, infer W> ? [A, ...W] : [A, B]> : never : never;
export declare class Policy {
    readonly options: Readonly<IBasePolicyOptions>;
    /**
     * Factory that builds a base set of filters that can be used in circuit
     * breakers, retries, etc.
     */
    constructor(options: Readonly<IBasePolicyOptions>);
    /**
     * Allows the policy to additionally handles errors of the given type.
     *
     * @param cls Class constructor to check that the error is an instance of.
     * @param predicate If provided, a function to be called with the error
     * which should return "true" if we want to handle this error.
     * @example
     * ```js

```

```bash
/bin/bash -lc "mkdir -p tests
python3 - <<'PY'
import json
s=json.load(open('p0-scan.json')); json.dump({**{k:s[k] for k in ['missingTimeouts','violations']},'problems':[1,3],'applies':True,'proceduresRun':['P0']},open('RESULT.json','w'),indent=2)
PY
cat > tests/vendor.test.mjs <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import FakeTimers from '@sinonjs/fake-timers';
import { makeVendor } from '../src/adapters/vendor.js';
import { Network } from '../src/infra/network.js';

test('unkeyed charge has a measured native timeout and no retry', async () => {
 const clock = FakeTimers.install();
 try {
  const n = new Network([{delay:10000}]);
  const result = makeVendor(n).charge({}).catch(e => e);
  await clock.tickAsync(110);
  assert.equal(n.active, 0);
  assert.ok(await result instanceof Error);
  assert.equal(n.requests.length,1);
 } finally { clock.uninstall(); }
});
EOF
node --test tests/*.test.mjs"
```
Exit: 1
```text
✖ tests/vendor.test.mjs (82.587301ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 94.454315

✖ failing tests:

test at tests/vendor.test.mjs:1:1
✖ tests/vendor.test.mjs (82.587301ms)
  'test failed'

```

```bash
/bin/bash -lc "python3 - <<'PY'
import json
m=json.load(open('measurement.json')); c={}
for d,v in m.items():
 c[d]={'timeoutMs':v['p999Ms']+v['paddingMs'],'source':'measurement.json: p999Ms + paddingMs','requestBudgetMs':v['requestBudgetMs']}
c['payment']['retry']={'maxRetries':3,'baseMs':40,'budgetMs':2400,'reason':'measurement.json transientRetryCap, backoffBaseMs, retryBudgetMs; full jitter; reserve native timeout within page budget'}
c['payment']['breaker']={**m['payment']['breaker'],'reason':m['payment']['reason']}
json.dump(c,open('src/config.json','w'),indent=2)
p='src/adapters/vendor.js'; s=open(p).read(); s=\"import { readFileSync } from 'node:fs';\\nconst config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));\\n\"+s;s=s.replace(\"operation: 'lookup',\", \"timeout: config[dependency].timeoutMs, operation: 'lookup',\").replace(\"operation: 'charge',\", \"timeout: config[dependency].timeoutMs, operation: 'charge',\");open(p,'w').write(s)
PY
python3 /tmp/remote-calls-runs/aip/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs' > p1-check.json
cat p1-check.json
cat >> tests/vendor.test.mjs <<'EOF'

test('eligible retries recover, cap attempts, and honour Retry-After', async () => {
 const clock = FakeTimers.install();
 try {
  const n = new Network([{status:503,headers:{'retry-after':'1'}},{status:200}]);
  const p = makeVendor(n).lookup('x');
  await clock.tickAsync(999); assert.equal(n.requests.length,1);
  await clock.tickAsync(2); await p; assert.equal(n.requests.length,2);
  const cap = new Network(Array(10).fill({status:503}));
  const q = makeVendor(cap,{dependency:'payment'}).lookup('x').catch(e=>e);
  await clock.tickAsync(3000); assert.ok(await q instanceof Error);
  assert.equal(cap.requests.length,4);
 } finally { clock.uninstall(); }
});
EOF
node --test tests/*.test.mjs"
```
Exit: 1
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 unkeyed charge has a measured native timeout and no retry (6.747334ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 1\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 104.72626\n"}]}
(node:2769618) PromiseRejectionHandledWarning: Promise rejection was handled asynchronously (rejection id: 1)
(Use `node --trace-warnings ...` to show where the warning was created)
✖ tests/vendor.test.mjs (88.996829ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 102.134246

✖ failing tests:

test at tests/vendor.test.mjs:1:1
✖ tests/vendor.test.mjs (88.996829ms)
  'test failed'

```

The timeout and retry stages passed the supplied checks. The retry gate allows lookup and keyed charges; unkeyed charges make one attempt. Payment’s incident measurements justify a breaker, while catalog has no evidence for one. I’m now adding the checkout fallback and testing opening, recovery, isolation, and telemetry.


```bash
/bin/bash -lc "cat src/adapters/vendor.js; cat node_modules/cockatiel/dist/CircuitBreakerPolicy.js | sed -n '130,240p'; node --version; cat package.json; ps -eo pid,args | rg 'node --test|vendor.test'"
```
Exit: 0
```text
import { readFileSync } from 'node:fs';
import { handleWhen, retry, DelegateBackoff, circuitBreaker, SamplingBreaker, CircuitState, BrokenCircuitError }  from 'cockatiel';
import { log, metric } from '../infra/telemetry.js';
import { request } from '../infra/network.js';
const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
export const isRemoteFault = e => e?.status === 429 || (e?.status >= 500 && e?.status <= 599)
  || e?.message === 'network aborted' || ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN'].includes(e?.code);
export function makeVendor(network, { dependency = 'payment' } = {}) {
 const settings = config[dependency];
 if (!settings) throw new Error(`Unknown dependency: ${dependency}`);
 const b = settings.breaker;
 const breaker = b && circuitBreaker(handleWhen(isRemoteFault), {
  breaker: new SamplingBreaker({threshold:b.failureRate, duration:b.windowMs, minimumRps:b.minimumCalls * 1000 / b.windowMs}),
  halfOpenAfter:b.openMs, halfOpenSampling:{calls:b.halfOpenTrials, threshold:0},
 });
 breaker?.onStateChange(state => {
  const event={dependency, state:CircuitState[state], event:'circuit_state_change'};
  log(event); metric(event);
 });
 async function call(operation, payload, eligible) {
  const native = () => request(network, {operation, payload, timeout: settings.timeoutMs});
  const send = () => breaker ? breaker.execute(native) : native();
  if (!eligible || !settings.retry) return send();
  const r = settings.retry;
  const started = Date.now();
  let delay = 0;
  let failures = 0;
  const policy = retry(handleWhen(e => {
   if (e instanceof BrokenCircuitError || breaker?.state === CircuitState.Open || !isRemoteFault(e)) return false;
   delay = Math.max(Math.random() * r.baseMs * 2 ** failures++, Math.max(0, Number(e.headers?.['retry-after']) || 0) * 1000);
   return Date.now() - started + delay + settings.timeoutMs <= Math.min(r.budgetMs, settings.requestBudgetMs);
  }), {maxAttempts:r.maxRetries, backoff:new DelegateBackoff(() => delay)});
  return policy.execute(send);
 }
 async function exposed(...args) {
  try { return await call(...args); }
  catch(error) {
   if (isRemoteFault(error) || error instanceof BrokenCircuitError) {
    const unavailable = new Error(`${dependency} temporarily unavailable`, {cause:error});
    unavailable.code = 'DEPENDENCY_UNAVAILABLE'; throw unavailable;
   }
   throw error;
  }
 }
 return {
  lookup: sku => exposed('lookup', {sku}, true),
  charge: order => exposed('charge', order, Boolean(order.idempotencyKey)),
 };
}
                    return;
                }
                disposed = true;
                if (this.innerState.value === CircuitState.Isolated && !--this.innerState.counters) {
                    this.innerState = { value: CircuitState.Closed };
                    this.resetEmitter.emit();
                    this.stateChangeEmitter.emit(CircuitState.Closed);
                }
            },
        };
    }
    /**
     * Executes the given function.
     * @param fn Function to run
     * @throws a {@link BrokenCircuitError} if the circuit is open
     * @throws a {@link IsolatedCircuitError} if the circuit is held
     * open via {@link CircuitBreakerPolicy.isolate}
     * @returns a Promise that resolves or rejects with the function results.
     */
    async execute(fn, signal = neverAbortedSignal) {
        const state = this.innerState;
        switch (state.value) {
            case CircuitState.Closed:
                const result = await this.executor.invoke(fn, { signal });
                if ('success' in result) {
                    this.options.breaker.success(state.value);
                }
                else {
                    this.innerLastFailure = result;
                    if (this.options.breaker.failure(state.value)) {
                        this.open(result, signal);
                    }
                }
                return returnOrThrow(result);
            case CircuitState.HalfOpen:
                return this.executeHalfOpen(fn, signal, state);
            case CircuitState.Open:
                if (Date.now() - state.openedAt < state.backoff.duration) {
                    throw new BrokenCircuitError();
                }
                const halfOpenState = {
                    value: CircuitState.HalfOpen,
                    backoff: state.backoff,
                    attemptNo: state.attemptNo + 1,
                    decision: defer(),
                    inFlight: 0,
                    successes: 0,
                    failures: 0,
                };
                this.innerState = halfOpenState;
                this.halfOpenEmitter.emit();
                this.stateChangeEmitter.emit(CircuitState.HalfOpen);
                return this.executeHalfOpen(fn, signal, halfOpenState);
            case CircuitState.Isolated:
                throw new IsolatedCircuitError();
            default:
                throw new Error(`Unexpected circuit state ${state}`);
        }
    }
    async executeHalfOpen(fn, signal, state) {
        if (this.innerState !== state) {
            return this.execute(fn, signal);
        }
        if (state.successes + state.failures + state.inFlight >= this.halfOpenSampling.calls) {
            await state.decision.promise;
            if (this.state === CircuitState.Closed && signal.aborted) {
                throw new TaskCancelledError();
            }
            return this.execute(fn, signal);
        }
        state.inFlight++;
        let result;
        try {
            result = await this.executor.invoke(fn, { signal });
        }
        catch (err) {
            // It's an error, but not one the circuit is meant to retry, so
            // for our purposes it's a success. Task failed successfully!
            this.recordHalfOpenSuccess(state);
            throw err;
        }
        if ('success' in result) {
            this.recordHalfOpenSuccess(state);
        }
        else {
            this.innerLastFailure = result;
            this.recordHalfOpenFailure(state, result, signal);
        }
        return returnOrThrow(result);
    }
    /**
     * Captures circuit breaker state that can later be used to recreate the
     * breaker by passing `state` to the `circuitBreaker` function. This is
     * useful in cases like serverless functions where you may want to keep
     * the breaker state across multiple executions.
     */
    toJSON() {
        const state = this.innerState;
        let ownState;
        if (state.value === CircuitState.HalfOpen) {
            ownState = {
                value: CircuitState.Open,
                openedAt: 0,
                attemptNo: state.attemptNo,
            };
        }
        else if (state.value === CircuitState.Open) {
            ownState = {
                value: CircuitState.Open,
                openedAt: state.openedAt,
                attemptNo: state.attemptNo,
v26.12.0
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
2779020 node --test tests/vendor.test.mjs
2779321 /usr/bin/node --test-concurrency=0 --experimental-addon-modules --test-coverage-functions=0 --inspect-publish-uid=stderr,http --inspect-port=127.0.0.1:9229 --stack-trace-limit=10 --report-signal=SIGUSR2 --test-coverage-lines=0 --use-largepages=off --secure-heap-min=2 --max-http-header-size=16384 --test-isolation=process --heap-prof-interval=524288 --cpu-prof-interval=1000 --trace-event-file-pattern=node_trace.${rotation}.log --test-coverage-branches=0 --network-family-autoselection-attempt-timeout=500 --tls-cipher-list=TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA --test-timeout=0 --node-snapshot --secure-heap=0 --watch-kill-signal=SIGTERM --heapsnapshot-near-heap-limit=0 --v8-pool-size=4 tests/vendor.test.mjs
2789144 /bin/bash -lc python3 - <<'PY' p='src/adapters/vendor.js';s=open(p).read().replace("DelegateBackoff }", "DelegateBackoff, circuitBreaker, SamplingBreaker, CircuitState, BrokenCircuitError } ");s=s.replace("import { request }", "import { log, metric } from '../infra/telemetry.js';\nimport { request }");s=s.replace(" async function call", " const b = settings.breaker;\n const breaker = b && circuitBreaker(handleWhen(isRemoteFault), {\n  breaker: new SamplingBreaker({threshold:b.failureRate, duration:b.windowMs, minimumRps:b.minimumCalls * 1000 / b.windowMs}),\n  halfOpenAfter:b.openMs, halfOpenSampling:{calls:b.halfOpenTrials, threshold:0},\n });\n breaker?.onStateChange(state => {\n  const event={dependency, state:CircuitState[state], event:'circuit_state_change'};\n  log(event); metric(event);\n });\n async function call");s=s.replace("  const send = () => request(network, {operation, payload, timeout: settings.timeoutMs});", "  const native = () => request(network, {operation, payload, timeout: settings.timeoutMs});\n  const send = () => breaker ? breaker.execute(native) : native();");s=s.replace("if (!isRemoteFault(e))", "if (e instanceof BrokenCircuitError || breaker?.state === CircuitState.Open || !isRemoteFault(e))");s=s.replace("  lookup: sku => call('lookup', {sku}, true),\n  charge: order => call('charge', order, Boolean(order.idempotencyKey)),", "  lookup: sku => exposed('lookup', {sku}, true),\n  charge: order => exposed('charge', order, Boolean(order.idempotencyKey)),");s=s.replace(" return {\n  lookup:", " async function exposed(...args) {\n  try { return await call(...args); }\n  catch(error) {\n   if (isRemoteFault(error) || error instanceof BrokenCircuitError) {\n    const unavailable = new Error(`${dependency} temporarily unavailable`, {cause:error});\n    unavailable.code = 'DEPENDENCY_UNAVAILABLE'; throw unavailable;\n   }\n   throw error;\n  }\n }\n return {\n  lookup:");open(p,'w').write(s) p='src/core/checkout.js';s=open(p).read().replace("  const stock", "  try {\n  const stock");s=s.replace("  return { status: 'confirmed' };", "  return { status: 'confirmed' };\n  } catch (error) {\n    if (error.code === 'DEPENDENCY_UNAVAILABLE') return {\n      status: 'temporarily_unavailable',\n      message: 'Payments are temporarily unavailable. Please try again later.',\n    };\n    throw error;\n  }");open(p,'w').write(s) PY python3 /tmp/remote-calls-runs/aip/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs' > p3-check.json cat p3-check.json
2789157 python3 /tmp/remote-calls-runs/aip/breaker/skill/scripts/run_check.py node dependency-check.mjs npm run check && node --test tests/*.test.mjs
2789205 /bin/sh -c npm run check && node --test tests/*.test.mjs
2789285 node --test tests/vendor.test.mjs
2789294 /usr/bin/node --test-concurrency=0 --experimental-addon-modules --test-coverage-functions=0 --inspect-publish-uid=stderr,http --inspect-port=127.0.0.1:9229 --stack-trace-limit=10 --report-signal=SIGUSR2 --test-coverage-lines=0 --use-largepages=off --secure-heap-min=2 --max-http-header-size=16384 --test-isolation=process --heap-prof-interval=524288 --cpu-prof-interval=1000 --trace-event-file-pattern=node_trace.${rotation}.log --test-coverage-branches=0 --network-family-autoselection-attempt-timeout=500 --tls-cipher-list=TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA --test-timeout=0 --node-snapshot --secure-heap=0 --watch-kill-signal=SIGTERM --heapsnapshot-near-heap-limit=0 --v8-pool-size=4 tests/vendor.test.mjs
2790725 /bin/bash -lc cat src/adapters/vendor.js; cat node_modules/cockatiel/dist/CircuitBreakerPolicy.js | sed -n '130,240p'; node --version; cat package.json; ps -eo pid,args | rg 'node --test|vendor.test'
2790738 rg node --test|vendor.test

```

```bash
/bin/bash -lc "cat > src/adapters/vendor.js <<'EOF'
import { readFileSync } from 'node:fs';
import { handleWhen, retry, DelegateBackoff } from 'cockatiel';
import { request } from '../infra/network.js';
const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
export const isRemoteFault = e => e?.status === 429 || (e?.status >= 500 && e?.status <= 599)
  || e?.message === 'network aborted' || ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN'].includes(e?.code);
export function makeVendor(network, { dependency = 'payment' } = {}) {
 const settings = config[dependency];
 if ("'!settings) throw new Error(`Unknown dependency: ${dependency}`);
 async function call(operation, payload, eligible) {
  const send = () => request(network, {operation, payload, timeout: settings.timeoutMs});
  if (!eligible || !settings.retry) return send();
  const r = settings.retry;
  const started = Date.now();
  let delay = 0;
  let failures = 0;
  const policy = retry(handleWhen(e => {
   if (!isRemoteFault(e)) return false;
   delay = Math.max(Math.random() * r.baseMs * 2 ** failures++, Math.max(0, Number(e.headers?.['"'retry-after']) || 0) * 1000);
   return Date.now() - started + delay + settings.timeoutMs <= Math.min(r.budgetMs, settings.requestBudgetMs);
  }), {maxAttempts:r.maxRetries, backoff:new DelegateBackoff(() => delay)});
  return policy.execute(send);
 }
 return {
  lookup: sku => call('lookup', {sku}, true),
  charge: order => call('charge', order, Boolean(order.idempotencyKey)),
 };
}
EOF
python3 /tmp/remote-calls-runs/aip/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs' > p2-check.json
cat p2-check.json
cat >> tests/vendor.test.mjs <<'EOF'

import { checkout } from '../src/core/checkout.js';
import { logs, metrics } from '../src/infra/telemetry.js';
test('payment breaker opens, isolates catalog, shows fallback, and recovers with one trial', async () => {
 const clock = FakeTimers.install();
 try {
  logs.length = metrics.length = 0;
  const n = new Network([...Array(4).fill({status:503}),{delay:50},{status:200}]);
  const vendor = makeVendor(n);
  for(let i=0;i<4;i++) { const p=vendor.charge({}).catch(e=>e); await clock.tickAsync(1); await p; }
  const fallback = await checkout(vendor,{sku:'x'});
  assert.deepEqual(fallback,{status:'temporarily_unavailable',message:'Payments are temporarily unavailable. Please try again later.'});
  assert.equal(n.requests.length,4);
  const catalog = new Network(); const c = makeVendor(catalog,{dependency:'catalog'}).lookup('x');
  await clock.tickAsync(1); await c;
  await clock.tickAsync(200);
  const trial=vendor.charge({}); await clock.tickAsync(1);
  await assert.rejects(vendor.charge({})); assert.equal(n.requests.length,5);
  await clock.tickAsync(50); await trial;
  const healthy=vendor.charge({}); await clock.tickAsync(1); await healthy;
  assert.deepEqual(logs.map(e=>e.state),['Open','HalfOpen','Closed']);
  assert.deepEqual(metrics,logs);
 } finally {clock.uninstall();}
});

test('client errors never open the circuit', async () => {
 const clock=FakeTimers.install();
 try {
  const n=new Network(Array(8).fill({status:400})); const v=makeVendor(n);
  for(let i=0;i<8;i++){const p=v.charge({}).catch(e=>e); await clock.tickAsync(1); assert.equal((await p).status,400);}
  assert.equal(n.requests.length,8);
 }finally{clock.uninstall();}
});
EOF
node --test tests/*.test.mjs"
```
Exit: 1
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 tests/vendor.test.mjs (152.387409ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 1\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 167.444431\n"}]}

Interrupted while running:

⚠ tests/vendor.test.mjs (tests/vendor.test.mjs:1:1)
✖ tests/vendor.test.mjs (40359.842655ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 0
ℹ cancelled 1
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 40370.809284

✖ failing tests:

test at tests/vendor.test.mjs:1:1
✖ tests/vendor.test.mjs (40359.842655ms)
  'Promise resolution is still pending but the event loop has already resolved'

```

```bash
/bin/bash -lc "python3 - <<'PY'
p='src/adapters/vendor.js';s=open(p).read().replace(\"DelegateBackoff }\", \"DelegateBackoff, circuitBreaker, SamplingBreaker, CircuitState, BrokenCircuitError } \");s=s.replace(\"import { request }\", \"import { log, metric } from '../infra/telemetry.js';\\nimport { request }\");s=s.replace(\" async function call\", \" const b = settings.breaker;\\n const breaker = b && circuitBreaker(handleWhen(isRemoteFault), {\\n  breaker: new SamplingBreaker({threshold:b.failureRate, duration:b.windowMs, minimumRps:b.minimumCalls * 1000 / b.windowMs}),\\n  halfOpenAfter:b.openMs, halfOpenSampling:{calls:b.halfOpenTrials, threshold:0},\\n });\\n breaker?.onStateChange(state => {\\n  const event={dependency, state:CircuitState[state], event:'circuit_state_change'};\\n  log(event); metric(event);\\n });\\n async function call\");s=s.replace(\"  const send = () => request(network, {operation, payload, timeout: settings.timeoutMs});\", \"  const native = () => request(network, {operation, payload, timeout: settings.timeoutMs});\\n  const send = () => breaker ? breaker.execute(native) : native();\");s=s.replace(\"if ("'!isRemoteFault(e))", "if (e instanceof BrokenCircuitError || breaker?.state === CircuitState.Open || !isRemoteFault(e))");s=s.replace("  lookup: sku => call('"'lookup', {sku}, true),\\n  charge: order => call('charge', order, Boolean(order.idempotencyKey)),\", \"  lookup: sku => exposed('lookup', {sku}, true),\\n  charge: order => exposed('charge', order, Boolean(order.idempotencyKey)),\");s=s.replace(\" return {\\n  lookup:\", \" async function exposed(...args) {\\n  try { return await call(...args); }\\n  catch(error) {\\n   if (isRemoteFault(error) || error instanceof BrokenCircuitError) {\\n    const unavailable = new Error("'`${dependency} temporarily unavailable`, {cause:error});'"\\n    unavailable.code = 'DEPENDENCY_UNAVAILABLE'; throw unavailable;\\n   }\\n   throw error;\\n  }\\n }\\n return {\\n  lookup:\");open(p,'w').write(s)
p='src/core/checkout.js';s=open(p).read().replace(\"  const stock\", \"  try {\\n  const stock\");s=s.replace(\"  return { status: 'confirmed' };\", \"  return { status: 'confirmed' };\\n  } catch (error) {\\n    if (error.code === 'DEPENDENCY_UNAVAILABLE') return {\\n      status: 'temporarily_unavailable',\\n      message: 'Payments are temporarily unavailable. Please try again later.',\\n    };\\n    throw error;\\n  }\");open(p,'w').write(s)
PY
python3 /tmp/remote-calls-runs/aip/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs' > p3-check.json
cat p3-check.json"
```
Exit: 0
```text
{"passed": false, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 1, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\nInterrupted while running:\n\n\u26a0 tests/vendor.test.mjs (tests/vendor.test.mjs:1:1)\n\u2716 tests/vendor.test.mjs (12312.577014ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 0\n\u2139 fail 0\n\u2139 cancelled 1\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 12318.112366\n\n\u2716 failing tests:\n\ntest at tests/vendor.test.mjs:1:1\n\u2716 tests/vendor.test.mjs (12312.577014ms)\n  'Promise resolution is still pending but the event loop has already resolved'\n"}]}

```

```bash
/bin/bash -lc "kill 2779020 2779321 2789285 2789294
python3 - <<'PY'
p='src/adapters/vendor.js';s=open(p).read().replace(\"const send = () => breaker ? breaker.execute(native) : native();\", \"const send = () => {\\n   // Cockatiel queues excess half-open callers; this port promises fail-fast.\\n   if (breaker?.state === CircuitState.HalfOpen) throw new BrokenCircuitError();\\n   return breaker ? breaker.execute(native) : native();\\n  };\");open(p,'w').write(s)
PY
python3 /tmp/remote-calls-runs/aip/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs' > p3-check.json
cat p3-check.json"
```
Exit: 0
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 tests/vendor.test.mjs (82.480699ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 1\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 90.863812\n"}]}

```

```bash
/bin/bash -lc "python3 - <<'PY'
p='tests/vendor.test.mjs';s=open(p).read().replace('FakeTimers.install()', \"FakeTimers.install({toFake:['Date','setTimeout','clearTimeout']})\");open(p,'w').write(s)
PY
node --test tests/*.test.mjs"
```
Exit: 0
```text
✔ unkeyed charge has a measured native timeout and no retry (5.229868ms)
✔ eligible retries recover, cap attempts, and honour Retry-After (2.597966ms)
✔ payment breaker opens, isolates catalog, shows fallback, and recovers with one trial (3.507434ms)
✔ client errors never open the circuit (1.206941ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 87.746025

```

```bash
/bin/bash -lc "cat >> tests/vendor.test.mjs <<'EOF'

test('keyed charges retry; Retry-After beyond budget fails without retry', async () => {
 const clock=FakeTimers.install({toFake:['Date','setTimeout','clearTimeout']});
 try {
  const n=new Network([{status:503},{status:200}]);
  const p=makeVendor(n).charge({idempotencyKey:'order-1'});
  await clock.tickAsync(100); await p;
  assert.equal(n.requests.length,2);
  assert.equal(n.requests[1].payload.idempotencyKey,'order-1');
  const slow=new Network([{status:429,headers:{'retry-after':'10'}}]);
  const q=makeVendor(slow).lookup('x').catch(e=>e);
  await clock.tickAsync(1); assert.equal((await q).code,'DEPENDENCY_UNAVAILABLE');
  await clock.tickAsync(10000); assert.equal(slow.requests.length,1);
 }finally{clock.uninstall();}
});

test('rate breaker requires minimum traffic, counts successes, and reopens after failed trial', async () => {
 const clock=FakeTimers.install({toFake:['Date','setTimeout','clearTimeout']});
 try {
  logs.length=metrics.length=0;
  const n=new Network([{status:503},{status:200},{status:503},{status:200},{status:503},{status:503}]);
  const v=makeVendor(n);
  for(let i=0;i<4;i++){const p=v.charge({}).catch(e=>e);await clock.tickAsync(1);await p;}
  assert.equal(logs.length,0); // Two faults in four calls: rate is not over 50%.
  const p=v.charge({}).catch(e=>e);await clock.tickAsync(1);await p;
  assert.equal(logs.at(-1).state,'Open');
  await clock.tickAsync(200);
  const q=v.charge({}).catch(e=>e);await clock.tickAsync(1);await q;
  assert.equal(logs.at(-1).state,'Open');
  await assert.rejects(v.lookup('x')); assert.equal(n.requests.length,6);
 }finally{clock.uninstall();}
});

test('timed out eligible lookup remains bounded and cancels every native request', async () => {
 const clock=FakeTimers.install({toFake:['Date','setTimeout','clearTimeout']});
 try {
  const n=new Network(Array(5).fill({delay:10000}));
  const p=makeVendor(n).lookup('x').catch(e=>e);
  await clock.tickAsync(1000);
  assert.equal((await p).code,'DEPENDENCY_UNAVAILABLE');
  assert.equal(n.requests.length,4); assert.equal(n.active,0);
  for(const r of n.requests) assert.equal(r.end-r.start,100);
 }finally{clock.uninstall();}
});
EOF
python3 /tmp/remote-calls-runs/aip/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs' > p3-check.json
cat p3-check.json
 git diff --stat"
```
Exit: 129
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 unkeyed charge has a measured native timeout and no retry (5.965797ms)\n\u2714 eligible retries recover, cap attempts, and honour Retry-After (2.828464ms)\n\u2714 payment breaker opens, isolates catalog, shows fallback, and recovers with one trial (4.726803ms)\n\u2714 client errors never open the circuit (1.482126ms)\n\u2714 keyed charges retry; Retry-After beyond budget fails without retry (0.980721ms)\n\u2714 rate breaker requires minimum traffic, counts successes, and reopens after failed trial (1.403898ms)\n\u2714 timed out eligible lookup remains bounded and cancels every native request (1.440807ms)\n\u2139 tests 7\n\u2139 suites 0\n\u2139 pass 7\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 96.617305\n"}]}
warning: Not a git repository. Use --no-index to compare two paths outside a working tree
usage: git diff --no-index [<options>] <path> <path>

Diff output format options
    -p, --patch           generate patch
    -s, --no-patch        suppress diff output
    -u                    generate patch
    -U, --unified[=<n>]   generate diffs with <n> lines context
    -W, --[no-]function-context
                          generate diffs with <n> lines context
    --raw                 generate the diff in raw format
    --patch-with-raw      synonym for '-p --raw'
    --patch-with-stat     synonym for '-p --stat'
    --numstat             machine friendly --stat
    --shortstat           output only the last line of --stat
    -X, --dirstat[=<param1,param2>...]
                          output the distribution of relative amount of changes for each sub-directory
    --cumulative          synonym for --dirstat=cumulative
    --dirstat-by-file[=<param1,param2>...]
                          synonym for --dirstat=files,param1,param2...
    --check               warn if changes introduce conflict markers or whitespace errors
    --summary             condensed summary such as creations, renames and mode changes
    --name-only           show only names of changed files
    --name-status         show only names and status of changed files
    --stat[=<width>[,<name-width>[,<count>]]]
                          generate diffstat
    --stat-width <width>  generate diffstat with a given width
    --stat-name-width <width>
                          generate diffstat with a given name width
    --stat-graph-width <width>
                          generate diffstat with a given graph width
    --stat-count <count>  generate diffstat with limited lines
    --[no-]compact-summary
                          generate compact summary in diffstat
    --binary              output a binary diff that can be applied
    --[no-]full-index     show full pre- and post-image object names on the "index" lines
    --[no-]color[=<when>] show colored diff
    --ws-error-highlight <kind>
                          highlight whitespace errors in the 'context', 'old' or 'new' lines in the diff
    -z                    do not munge pathnames and use NULs as output field terminators in --raw or --numstat
    --[no-]abbrev[=<n>]   use <n> digits to display object names
    --src-prefix <prefix> show the given source prefix instead of "a/"
    --dst-prefix <prefix> show the given destination prefix instead of "b/"
    --line-prefix <prefix>
                          prepend an additional prefix to every line of output
    --no-prefix           do not show any source or destination prefix
    --default-prefix      use default prefixes a/ and b/
    --inter-hunk-context <n>
                          show context between diff hunks up to the specified number of lines
    --output-indicator-new <char>
                          specify the character to indicate a new line instead of '+'
    --output-indicator-old <char>
                          specify the character to indicate an old line instead of '-'
    --output-indicator-context <char>
                          specify the character to indicate a context instead of ' '

Diff rename options
    -B, --break-rewrites[=<n>[/<m>]]
                          break complete rewrite changes into pairs of delete and create
    -M, --find-renames[=<n>]
                          detect renames
    -D, --irreversible-delete
                          omit the preimage for deletes
    -C, --find-copies[=<n>]
                          detect copies
    --[no-]find-copies-harder
                          use unmodified files as source to find copies
    --no-renames          disable rename detection
    --[no-]rename-empty   use empty blobs as rename source
    --[no-]follow         continue listing the history of a file beyond renames
    -l <n>                prevent rename/copy detection if the number of rename/copy targets exceeds given limit

Diff algorithm options
    --minimal             produce the smallest possible diff
    -w, --ignore-all-space
                          ignore whitespace when comparing lines
    -b, --ignore-space-change
                          ignore changes in amount of whitespace
    --ignore-space-at-eol ignore changes in whitespace at EOL
    --ignore-cr-at-eol    ignore carrier-return at the end of line
    --ignore-blank-lines  ignore changes whose lines are all blank
    -I, --[no-]ignore-matching-lines <regex>
                          ignore changes whose all lines match <regex>
    --[no-]indent-heuristic
                          heuristic to shift diff hunk boundaries for easy reading
    --patience            generate diff using the "patience diff" algorithm
    --histogram           generate diff using the "histogram diff" algorithm
    --diff-algorithm <algorithm>
                          choose a diff algorithm
    --anchored <text>     generate diff using the "anchored diff" algorithm
    --word-diff[=<mode>]  show word diff, using <mode> to delimit changed words
    --word-diff-regex <regex>
                          use <regex> to decide what a word is
    --color-words[=<regex>]
                          equivalent to --word-diff=color --word-diff-regex=<regex>
    --[no-]color-moved[=<mode>]
                          moved lines of code are colored differently
    --[no-]color-moved-ws <mode>
                          how white spaces are ignored in --color-moved

Other diff options
    --[no-]relative[=<prefix>]
                          when run from subdir, exclude changes outside and show relative paths
    -a, --[no-]text       treat all files as text
    -R                    swap two inputs, reverse the diff
    --[no-]exit-code      exit with 1 if there were differences, 0 otherwise
    --[no-]quiet          disable all output of the program
    --[no-]ext-diff       allow an external diff helper to be executed
    --[no-]textconv       run external text conversion filters when comparing binary files
    --ignore-submodules[=<when>]
                          ignore changes to submodules in the diff generation
    --submodule[=<format>]
                          specify how differences in submodules are shown
    --ita-invisible-in-index
                          hide 'git add -N' entries from the index
    --ita-visible-in-index
                          treat 'git add -N' entries as real in the index
    -S <string>           look for differences that change the number of occurrences of the specified string
    -G <regex>            look for differences that change the number of occurrences of the specified regex
    --pickaxe-all         show all changes in the changeset with -S or -G
    --pickaxe-regex       treat <string> in -S as extended POSIX regular expression
    -O <file>             control the order in which files appear in the output
    --rotate-to <path>    show the change in the specified path first
    --skip-to <path>      skip the output to the specified path
    --find-object <object-id>
                          look for differences that change the number of occurrences of the specified object
    --diff-filter [(A|C|D|M|R|T|U|X|B)...[*]]
                          select files by diff type
    --output <file>       output to a specific file


```

All seven tests now pass, including timeout cancellation, retry limits and budgets, minimum breaker traffic, recovery, catalog isolation, fallback, and telemetry. Cockatiel queues excess half-open callers, so the adapter rejects them immediately to keep checkout bounded. I’m saving the P0 evidence and procedure report.


```bash
/bin/bash -lc "cat > src/core/checkout.js <<'EOF'
export async function checkout(vendor, order) {
  try {
    const stock = await vendor.lookup(order.sku);
    if ("'!stock.available) return { status: '"'unavailable' };
    await vendor.charge(order);
    return { status: 'confirmed' };
  } catch (error) {
    if (error.code === 'DEPENDENCY_UNAVAILABLE') return {
      status: 'temporarily_unavailable',
      message: 'Payments are temporarily unavailable. Please try again later.',
    };
    throw error;
  }
}
EOF
python3 - <<'PY'
import json
p='RESULT.json';r=json.load(open(p));r['proceduresRun']=['P0','P1','P2','P3'];json.dump(r,open(p,'w'),indent=2)
PY
python3 /tmp/remote-calls-runs/aip/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs' > p3-check.json
cat > /tmp/remote-calls-runs/aip/breaker/AGENT_REPORT.md <<'EOF'
Applied the supplied remote-calls skill directly, without delegation. Procedures run: P0, P1, P2, P3. P4 was not requested or run.

P0: ran "'`python3 /tmp/remote-calls-runs/aip/breaker/skill/scripts/scan_remote_calls.py companion.json .`. Exit 1: three missing timeouts (vendor lookup/charge and unrelated weather), no violations or unsupported syntax. Original scanner output is in p0-scan.json; RESULT.json preserves those actual findings, problems [1,3], applicability true, and procedures run. Initial `python` invocation failed because only python3 is installed. External HTTP calls and sustained payment failure meet applicability; no exclusion applies.

P1 scoped vendor calls only; weather stays unchanged. Both dependency timeouts are 100 ms, from measured p99.9 80 ms plus padding 20 ms. Added a timeout test before implementation, observed failure, then configured native request timeouts. Supplied run_check.py ran dependency direction and resilience commands successfully (p1-check.json).

P2 gate: lookup is idempotent; charge is eligible only with an idempotency key, otherwise stops at no retry. No existing retry layer in the boundary. Added retry scenarios before implementation (failed), then Cockatiel capped retries, exponential full jitter, Retry-After seconds, and a budget that reserves the next native timeout. Payment values come from measurements; catalog has no retry policy because the task identifies it as healthy. Supplied checks passed (p2-check.json).

P3 gate: payment'"'s four failures per second, sustained outages, and cross-page slowdown justify its breaker; healthy catalog does not qualify. Config records measured failure rate, window, minimum calls, open duration, single trial and reasons. Added breaker/fallback tests before implementation; the preimplementation run could not complete and was terminated. Implemented Cockatiel SamplingBreaker inside retry, outside native timeout, with fault-only classification and state log/metric events. Half-open excess calls fail immediately instead of using Cockatiel's default waiting behavior. Adapter translates provider faults into a declared unavailable error; checkout renders the exact companion fallback. Client errors propagate without tripping.

Final validation: run_check.py with "'`node dependency-check.mjs` and `npm run check && node --test tests/*.test.mjs` passed; seven tests passed (p3-check.json). Fixed fake-timer configuration to mock only Date/setTimeout/clearTimeout after noticing the initial broad mocking hid individual test reporting. Coverage includes unkeyed and keyed writes, retry cap and Retry-After/budget, timeout cancellation, rate/minimum traffic, open fast failure, catalog independence, single half-open admission, recovery/reopening, client errors and telemetry. A git diff command was unavailable because the supplied directory is not a Git repository.

Changed only vendor adapter, core checkout fallback, config, and new tests; added procedure evidence files. No boundary, checker, measurement, companion, or task modifications.
EOF
cat p3-check.json'
```
Exit: 0
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 unkeyed charge has a measured native timeout and no retry (5.370086ms)\n\u2714 eligible retries recover, cap attempts, and honour Retry-After (2.454169ms)\n\u2714 payment breaker opens, isolates catalog, shows fallback, and recovers with one trial (3.369045ms)\n\u2714 client errors never open the circuit (1.210022ms)\n\u2714 keyed charges retry; Retry-After beyond budget fails without retry (0.826889ms)\n\u2714 rate breaker requires minimum traffic, counts successes, and reopens after failed trial (1.13975ms)\n\u2714 timed out eligible lookup remains bounded and cancels every native request (1.08815ms)\n\u2139 tests 7\n\u2139 suites 0\n\u2139 pass 7\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 82.986315\n"}]}

```

Completed P0–P3: added measured timeouts, eligible retries, a payment circuit breaker, telemetry, and checkout’s declared unavailable fallback. Catalog remains independent.

Dependency checks, syntax checks, and all seven tests pass.

Saved evidence in [RESULT.json](/tmp/remote-calls-runs/aip/breaker/repo/RESULT.json) and details in [AGENT_REPORT.md](/tmp/remote-calls-runs/aip/breaker/AGENT_REPORT.md).

