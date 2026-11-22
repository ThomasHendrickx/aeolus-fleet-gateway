# Observable transcript: skill-md-scan

I’ll read the task, skill, and companion inputs, then run P0 and save its evidence before following the remaining gates.

```bash
/bin/bash -lc "pwd && rg --files -g 'AGENTS.md' -g 'TASK.md' -g 'COMPANION.md' -g 'companion.json' && cat TASK.md COMPANION.md companion.json && cat /tmp/remote-calls-runs/skill-md/scan/skill/SKILL.md"
```
Exit: 0
```text
/tmp/remote-calls-runs/skill-md/scan/repo
TASK.md
companion.json
COMPANION.md
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
description: Use when writing or changing an adapter that makes any outbound remote call to an HTTP API, SDK or remote service; configure timeouts, retries, circuit breakers and per-dependency concurrency limits.
---

# Problem

Matters when one or more holds:
1. A remote call can hang, holding connections or request slots. Signal: an outbound call with no timeout, or the library default.
2. Transient faults fail requests that would succeed a moment later. Signal: intermittent 503s or connection resets, no retry.
3. A dependency in sustained failure keeps being called, so callers wait, resources run out and the failure spreads. Signal: errors on one dependency followed by latency or errors on unrelated endpoints.
4. One slow dependency starves calls to others. Signal: one pool or limiter shared by several dependencies.
5. Retries multiply across layers or repeat non-idempotent operations. Signal: retries in both the SDK and the caller; a retried create making duplicates.

# Solution

- Every remote call has a timeout set from the dependency's measured latency. (1)
- Transient faults: capped retries with exponential backoff and jitter, within a retry budget, at one layer, for idempotent operations only. (2, 5)
- Sustained faults: a circuit breaker per dependency that fails fast while open, with a declared fallback. (3)
- Starvation: a concurrency limit per dependency (bulkhead). (4)
- All of it wraps the driven adapter, never the domain (`ports-and-adapters`). (1-5)

# Not needed when

The resource is local or in-process. The call runs in a queue or outbox consumer that already retries and dead-letters (`domain-events`). The SDK or platform already provides the mechanism: configure that one, do not wrap twice.

# Rules

1. Every remote call has a timeout from the dependency's measured latency (for example p99.9 plus padding), never the library default.
2. Retry only idempotent operations or calls with an idempotency key; at one layer; capped attempts; exponential backoff with jitter; within a retry budget; honour `Retry-After`.
3. A breaker exists only for a dependency showing problem 3; one per dependency or shard, never shared.
4. A breaker counts fault signals only (timeouts, connection errors, 5xx, 429), never client or business errors.
5. A breaker trips on a failure rate over a time window with a minimum number of calls; half-open lets a limited number of trial calls through.
6. Composition: timeout inside the breaker inside the retry; no retry while the breaker is open.
7. Every breaker and limit has a declared fallback per call site (fail fast with a clear error, stale data, or queue for later), visible to the user (`web-frontend`).
8. Resilience wraps the port in the driven adapter (a decorator); never in the domain or use case.
9. Use the resilience library the companion declares; never hand-roll a breaker.
10. Every breaker state change is logged and exported as a metric.
11. Every value (timeout, threshold, budget, limit) is per-dependency config with its source measurement or stated reason.

# Failure modes

1. A remote call with no timeout or the library default.
2. Retries at several layers (SDK, caller, gateway).
3. Retried non-idempotent writes creating duplicates.
4. Immediate retries without jitter: synchronised retry storms.
5. A breaker around a local resource or business exceptions.
6. One breaker shared by independent dependencies or shards.
7. A breaker tripping on client or validation errors.
8. An open breaker with no fallback: a raw exception reaches the user.
9. Breaker state changes not logged or exported: invisible modal behaviour.
10. A breaker wrapped around a consumer that already retries and dead-letters.
11. A hand-rolled breaker.
12. A retry outside the breaker that keeps retrying while it is open.

# Procedures

Companion inputs: `paths.domain`, `paths.adapters`, `outboundClients` (each client module and its timeout option name), `resilience.library`, `resilience.config`, `measurement` (latency percentiles per dependency), `checks.dependencyDirection`, `checks.resilienceTests`.

## P0 Applicability gate (entry)

1. script: parse `paths.adapters` for calls to `outboundClients` without their timeout option -> `missingTimeouts[]`; parse `paths.domain` for imports of `resilience.library` -> `violations[]` (rule 8).
2. agent: check the task for problems 1-5 -> `problems[]`.
3. agent: local resource, queue consumer with retry and dead-letter, or a platform mechanism -> stop and configure that; no problems -> stop; else -> `applies`.

## P1 Timeouts

1. agent: scope = the remote calls the task touches; every other call stays unchanged -> scope list.
2. agent: timeout per call from `measurement`; none -> an assumed value with its reason in `resilience.config` -> timeout spec.
3. agent: scenario: dependency slower than the timeout -> the call fails within timeout plus margin -> failing test.
4. agent: set the timeout in the adapter from config.
5. script: run `checks.dependencyDirection` and `checks.resilienceTests`.

## P2 Retries

1. agent: idempotent or idempotency key? Neither -> no retry, stop.
2. agent: existing retry layer (SDK, gateway)? Yes -> configure it, stop.
3. agent: scenarios: transient fault then success; fault past the cap; `Retry-After` honoured -> failing tests.
4. agent: capped exponential backoff with jitter and a budget, in the adapter via `resilience.library`.
5. script: run `checks.dependencyDirection` and `checks.resilienceTests`.

## P3 Circuit breaker

1. agent: evidence of problem 3 for this dependency; none -> stop.
2. agent: breaker per dependency or shard: fault signals, window, failure rate, minimum calls, open duration, half-open trials, each with its reason in `resilience.config` -> breaker spec.
3. agent: fallback per call site, shown to the user -> fallback spec.
4. agent: scenarios: over threshold -> open and fail fast without calling; after open duration -> one trial; trial success -> closed; client errors never trip; open -> fallback; no retry while open; state change logged and exported -> failing tests.
5. agent: compose in the adapter: timeout inside breaker inside retry.
6. agent: emit state changes as a log line and a metric.
7. script: run `checks.dependencyDirection` and `checks.resilienceTests`.

## P4 Bulkhead

1. agent: evidence of problem 4; none -> stop.
2. agent: concurrency limit and queue size per dependency, with reasons.
3. agent: scenarios: A saturated at its limit -> calls to B succeed; over the limit -> fail fast with the fallback -> failing tests.
4. agent: a separate limiter per dependency in the adapter.
5. script: run `checks.dependencyDirection` and `checks.resilienceTests`.

```

```bash
/bin/bash -lc "rg --files /tmp/remote-calls-runs/skill-md/scan/skill && rg --files -g '"'!node_modules/**'"' && cat measurement.json package.json && rg --files src | xargs -r -n 1 sh -c 'echo \""'$0"; cat "$0"'"'"
```
Exit: 0
```text
/tmp/remote-calls-runs/skill-md/scan/skill/SKILL.md
/tmp/remote-calls-runs/skill-md/scan/skill/scripts/__pycache__/scan_remote_calls.cpython-312.pyc
/tmp/remote-calls-runs/skill-md/scan/skill/scripts/run_check.py
/tmp/remote-calls-runs/skill-md/scan/skill/scripts/scan_remote_calls.py
/tmp/remote-calls-runs/skill-md/scan/skill/scripts/scan_javascript.cjs
TASK.md
companion.json
package.json
dependency-check.mjs
COMPANION.md
measurement.json
src/config.json
src/infra/telemetry.js
src/infra/network.js
src/adapters/untouched.js
src/adapters/vendor.js
src/core/leak.js
src/core/checkout.js
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
    "@sinonjs/fake-timers": "15.0.0",
    "acorn": "8.15.0"
  }
}
src/core/leak.js
import { retry } from 'cockatiel';
export const leakedPolicy = retry;
src/core/checkout.js
export async function checkout(vendor, order) {
  const stock = await vendor.lookup(order.sku);
  if (!stock.available) return { status: 'unavailable' };
  await vendor.charge(order);
  return { status: 'confirmed' };
}
src/config.json
{}
src/infra/network.js
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
src/infra/telemetry.js
// Existing application telemetry boundary. Both exported arrays are event ledgers.
export const logs = [];
export const metrics = [];
export function log(event) { logs.push(event); }
export function metric(event) { metrics.push(event); }
src/adapters/untouched.js
import { request } from '../infra/network.js';
export const readWeather = (network) => request(network, {operation: 'weather'});
src/adapters/vendor.js
import { request } from '../infra/network.js';
export function makeVendor(network, { dependency = 'payment' } = {}) {
  return {
    lookup: (sku) => request(network, { operation: 'lookup', payload: { sku } }),
    charge: (order) => request(network, { operation: 'charge', payload: order }),
  };
}

```

```bash
/bin/bash -lc 'cat /tmp/remote-calls-runs/skill-md/scan/skill/scripts/scan_remote_calls.py /tmp/remote-calls-runs/skill-md/scan/skill/scripts/run_check.py'
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
/bin/bash -lc 'python3 /tmp/remote-calls-runs/skill-md/scan/skill/scripts/scan_remote_calls.py companion.json . > P0_SCAN.json; scan_exit=$?; cat P0_SCAN.json; exit "$scan_exit"'
```
Exit: 1
```text
{
  "violations": [
    {
      "path": "/tmp/remote-calls-runs/skill-md/scan/repo/src/core/leak.js",
      "line": 1,
      "module": "cockatiel"
    }
  ],
  "missingTimeouts": [
    {
      "path": "/tmp/remote-calls-runs/skill-md/scan/repo/src/adapters/untouched.js",
      "line": 2,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/skill-md/scan/repo/src/adapters/vendor.js",
      "line": 4,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/skill-md/scan/repo/src/adapters/vendor.js",
      "line": 5,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    }
  ],
  "unsupported": [
    {
      "path": "/tmp/remote-calls-runs/skill-md/scan/repo/src/core/leak.js",
      "line": 2,
      "reason": "assigned client alias requires flow analysis"
    }
  ],
  "clean": false
}

```

P0 found three calls without timeouts and one domain import of `cockatiel`. The task supports problems 1 and 3: hanging calls and provider failures slowing unrelated pages. The gate applies. Since the task requests P0 only, I’ll stop there and leave application files unchanged. The saved scan output also includes an unsupported alias-analysis finding.

```bash
/bin/bash -lc "python3 - <<'PY'
import json
from pathlib import Path
scan = json.loads(Path('P0_SCAN.json').read_text())
result = {key: scan[key] for key in ('missingTimeouts', 'violations')}
result.update(problems=[1, 3], applies=True, proceduresRun=['P0'])
Path('RESULT.json').write_text(json.dumps(result, indent=2) + '\\n')
PY
npm run check"
```
Exit: 0
```text

> check
> node --check src/adapters/vendor.js && node --check src/core/checkout.js


```

```bash
/bin/bash -lc "cat > /tmp/remote-calls-runs/skill-md/scan/AGENT_REPORT.md <<'EOF'
# Applicability investigation

Applied the supplied remote-calls skill. Ran only P0, as TASK.md requests; P1–P4 were not run. All commands ran from /tmp/remote-calls-runs/skill-md/scan/repo.

Command: "'`python3 /tmp/remote-calls-runs/skill-md/scan/skill/scripts/scan_remote_calls.py companion.json . > P0_SCAN.json`. Exit 1 indicates scan findings. Actual stdout is preserved in `repo/P0_SCAN.json`: three missing timeout settings (untouched.js:2, vendor.js:4 and :5), one layering violation (core/leak.js:1 imports cockatiel), and one unsupported construct (core/leak.js:2, assigned client alias requires flow analysis). This is not a clean scan.

P0 task assessment: problems [1, 3]. Checkout hangs during provider outages, and those outages slow other pages. There is no demonstrated transient-recovery issue, shared limiter, or duplicate/multilayer retry issue to establish problems 2, 4, or 5. The calls cross an external HTTP boundary; no local-resource, retrying queue consumer, or existing platform resilience mechanism excludes applicability. Thus applies=true. Stopped after the requested applicability gate, despite its positive result.

Wrote `repo/RESULT.json` with the scanner'"'s actual missingTimeouts and violations, problems [1, 3], applies=true, and proceduresRun=[\"P0\"]. Preserved the full scan output separately so its unsupported finding is retained.

Validation: "'`npm run check` passed (exit 0). No application changes or new behavioral tests were needed for this inventory-only task. Application files, external boundaries, companion inputs, measurements, supplied checker, and task were left unchanged. New repository artifacts: RESULT.json and P0_SCAN.json.
EOF
python3 -m json.tool RESULT.json > /dev/null'
```
Exit: 0
```text

```

Ran P0 only. Applicability is true for problems 1 and 3. Found three missing timeouts and one layering violation; preserved the scanner’s unsupported-analysis finding.

Saved `RESULT.json`, full evidence in `P0_SCAN.json`, and the report in `../AGENT_REPORT.md`. `npm run check` passed. Application files remain unchanged.

