# Observable transcript: skill-md-breaker

I’ll read the supplied task, skill, and companion files, then run P0 and follow the skill’s gates.

```bash
/bin/bash -lc "pwd && rg --files -g 'AGENTS.md' -g 'TASK.md' -g 'COMPANION.md' -g 'companion.json' -g '*' . /tmp/remote-calls-runs/skill-md/breaker/skill"
```
Exit: 0
```text
/tmp/remote-calls-runs/skill-md/breaker/repo
/tmp/remote-calls-runs/skill-md/breaker/skill/SKILL.md
/tmp/remote-calls-runs/skill-md/breaker/skill/scripts/__pycache__/scan_remote_calls.cpython-312.pyc
/tmp/remote-calls-runs/skill-md/breaker/skill/scripts/run_check.py
/tmp/remote-calls-runs/skill-md/breaker/skill/scripts/scan_remote_calls.py
/tmp/remote-calls-runs/skill-md/breaker/skill/scripts/scan_javascript.cjs
./measurement.json
./companion.json
./dependency-check.mjs
./COMPANION.md
./TASK.md
./package.json
./package-lock.json
./src/config.json
./src/adapters/untouched.js
./src/adapters/vendor.js
./src/core/checkout.js
./src/infra/telemetry.js
./src/infra/network.js

```

```bash
/bin/bash -lc 'cat TASK.md COMPANION.md companion.json /tmp/remote-calls-runs/skill-md/breaker/skill/SKILL.md'
```
Exit: 0
```text
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
/bin/bash -lc 'cat /tmp/remote-calls-runs/skill-md/breaker/skill/scripts/run_check.py; cat measurement.json package.json src/adapters/*.js src/core/*.js src/infra/*.js src/config.json dependency-check.mjs; python /tmp/remote-calls-runs/skill-md/breaker/skill/scripts/scan_remote_calls.py --help'
```
Exit: 127
```text
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
import { parse } from 'acorn';
import { readdirSync, readFileSync } from 'node:fs';
function files(dir) {return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${dir}/${e.name}`):[`${dir}/${e.name}`]);}
const violations=[];
for(const f of files('src/core').filter(f=>f.endsWith('.js'))) {
 const ast=parse(readFileSync(f,'utf8'),{ecmaVersion:'latest',sourceType:'module'});
 for(const n of ast.body) if(n.type==='ImportDeclaration' && (n.source.value==='cockatiel'||n.source.value.includes('/adapters/'))) violations.push(f+': '+n.source.value);
}
if(violations.length) {console.error(violations.join('\n'));process.exit(1);}
/bin/bash: line 1: python: command not found

```

```bash
/bin/bash -lc 'python3 /tmp/remote-calls-runs/skill-md/breaker/skill/scripts/scan_remote_calls.py --help; cat /tmp/remote-calls-runs/skill-md/breaker/skill/scripts/scan_remote_calls.py'
```
Exit: 0
```text
Traceback (most recent call last):
  File "/tmp/remote-calls-runs/skill-md/breaker/skill/scripts/scan_remote_calls.py", line 129, in <module>
    sys.exit(main())
             ^^^^^^
  File "/tmp/remote-calls-runs/skill-md/breaker/skill/scripts/scan_remote_calls.py", line 83, in main
    companion = json.loads(Path(sys.argv[1]).read_text())
                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.12/pathlib.py", line 1029, in read_text
    with self.open(mode='r', encoding=encoding, errors=errors) as f:
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.12/pathlib.py", line 1015, in open
    return io.open(self, mode, buffering, encoding, errors, newline)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
FileNotFoundError: [Errno 2] No such file or directory: '--help'
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
/bin/bash -lc 'npm install --ignore-scripts'
```
Exit: 0
```text
npm warn reify Removing non-directory /tmp/remote-calls-runs/skill-md/breaker/repo/node_modules

added 5 packages, and audited 6 packages in 503ms

found 0 vulnerabilities

```

```bash
/bin/bash -lc 'python3 /tmp/remote-calls-runs/skill-md/breaker/skill/scripts/scan_remote_calls.py companion.json . > /tmp/p0-scan.json; cat /tmp/p0-scan.json'
```
Exit: 0
```text
{
  "violations": [],
  "missingTimeouts": [
    {
      "path": "/tmp/remote-calls-runs/skill-md/breaker/repo/src/adapters/untouched.js",
      "line": 2,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/skill-md/breaker/repo/src/adapters/vendor.js",
      "line": 4,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/skill-md/breaker/repo/src/adapters/vendor.js",
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
/bin/bash -lc "rg -n 'class SamplingBreaker|class.*Backoff|retry\\(|circuitBreaker|halfOpenAfter|onStateChange|interface ISampling' node_modules/cockatiel/dist/*.d.ts"
```
Exit: 0
```text
node_modules/cockatiel/dist/Policy.d.ts:105:     *  .retry()
node_modules/cockatiel/dist/Policy.d.ts:122:     *  .retry()
node_modules/cockatiel/dist/Policy.d.ts:139:     *  .retry()
node_modules/cockatiel/dist/Policy.d.ts:156:     *  .retry()
node_modules/cockatiel/dist/Policy.d.ts:197: * const retry = retry(handleAll, { maxAttempts: 3 });
node_modules/cockatiel/dist/Policy.d.ts:269: * const policy = retry(handleAll, { backoff: new ExponentialBackoff() });
node_modules/cockatiel/dist/Policy.d.ts:275:export declare function retry(policy: Policy, opts: {
node_modules/cockatiel/dist/Policy.d.ts:290: *  .circuitBreaker(10_000, new SamplingBreaker(0.2, 30 * 1000));
node_modules/cockatiel/dist/Policy.d.ts:297: * @param halfOpenAfter Time after failures to try to open the circuit
node_modules/cockatiel/dist/Policy.d.ts:302:export declare function circuitBreaker(policy: Policy, opts: ICircuitBreakerOptions): CircuitBreakerPolicy;
node_modules/cockatiel/dist/CircuitBreakerPolicy.d.ts:26: * Context passed into halfOpenAfter backoff delegate.
node_modules/cockatiel/dist/CircuitBreakerPolicy.d.ts:48:    halfOpenAfter: number | IBackoffFactory<IHalfOpenAfterBackoffContext>;
node_modules/cockatiel/dist/CircuitBreakerPolicy.d.ts:80:    private readonly halfOpenAfterBackoffFactory;
node_modules/cockatiel/dist/CircuitBreakerPolicy.d.ts:102:    readonly onStateChange: import("./common/Event.js").Event<CircuitState>;
node_modules/cockatiel/dist/CircuitBreakerPolicy.d.ts:139:     * breaker by passing `state` to the `circuitBreaker` function. This is

```

```bash
/bin/bash -lc 'cat node_modules/cockatiel/dist/breaker/SamplingBreaker.d.ts node_modules/cockatiel/dist/RetryPolicy.d.ts node_modules/cockatiel/dist/CircuitBreakerPolicy.d.ts'
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

```

P0 found three calls without timeouts and no domain imports of Cockatiel. Problems 1 and 3 apply, so the gate permits work. I’ll scope changes to vendor lookup and charge, leaving weather unchanged. The measured timeout is 100 ms. Lookup and keyed charges qualify for retries; unkeyed charges do not. Only payment has evidence for a circuit breaker.

```bash
/bin/bash -lc 'node --version; cat node_modules/cockatiel/dist/backoff/DelegateBackoff.d.ts node_modules/cockatiel/dist/breaker/SamplingBreaker.js'
```
Exit: 0
```text
v26.12.0
import { IBackoff, IBackoffFactory } from './Backoff.js';
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
//# sourceMappingURL=SamplingBreaker.js.map
```

```bash
/bin/bash -lc "python3 - <<'PY'
p='tests/resilience.test.mjs'
s=open(p).read().replace(\"const result=promise.then(value=>({value}),error=>({error})); await clock.tickAsync(ms); return result;\", \"let result; promise.then(value=>{result={value};},error=>{result={error};}); await clock.tickAsync(ms); assert.ok(result, 'call must settle within budget'); return result;\")
open(p,'w').write(s)
PY
python3 /tmp/remote-calls-runs/skill-md/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
{"passed": false, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 1, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2716 tests/resilience.test.mjs (93.982605ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 0\n\u2139 fail 1\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 106.140131\n\n\u2716 failing tests:\n\ntest at tests/resilience.test.mjs:1:1\n\u2716 tests/resilience.test.mjs (93.982605ms)\n  'test failed'\n"}]}

```

```bash
/bin/bash -lc "python3 - <<'PY'
import json
m=json.load(open('measurement.json'))
c={}
for d,v in m.items():
 c[d]={'timeoutMs':v['p999Ms']+v['paddingMs'],'timeoutSource':'measurement.json: p999Ms + paddingMs'}
c['payment'].update(retry={'maxRetries':3,'baseMs':40,'budgetMs':2400,'source':'measurement.json transientRetryCap, backoffBaseMs, retryBudgetMs; full jitter; reserve one timeout before retry'},breaker={**m['payment']['breaker'],'source':'measurement.json breaker and incident: four failures per second, probe recovery every 200ms; one half-open trial'})
c['catalog']['retry']={'maxRetries':3,'baseMs':40,'budgetMs':2400,'source':'Assumed same retry envelope as payment within measured 2500ms request budget; idempotent calls only'}
json.dump(c,open('src/config.json','w'),indent=2)
p='src/adapters/vendor.js';s=open(p).read();s=\"import { readFileSync } from 'node:fs';\\nconst config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));\\n\"+s;s=s.replace(\"operation: 'lookup',\", \"timeout: config[dependency].timeoutMs, operation: 'lookup',\").replace(\"operation: 'charge',\", \"timeout: config[dependency].timeoutMs, operation: 'charge',\");open(p,'w').write(s)
r=json.load(open('RESULT.json'));r['proceduresRun'].append('P1');json.dump(r,open('RESULT.json','w'),indent=2)
PY
python3 /tmp/remote-calls-runs/skill-md/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 native timeout cancels unkeyed charge within 100ms (8.209ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 1\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 145.146416\n"}]}

```

```bash
/bin/bash -lc "cat >> tests/resilience.test.mjs <<'EOF'
test('idempotent retries, cap, Retry-After and budget',()=>timed(async clock=>{
 let n=new Network([{status:503},{status:200}]); assert.ok((await settle(clock,makeVendor(n).lookup('a'))).value); assert.equal(n.requests.length,2);
 n=new Network(Array(6).fill({status:503})); assert.ok((await settle(clock,makeVendor(n,{dependency:'catalog'}).lookup('a'))).error); assert.equal(n.requests.length,4);
 n=new Network([{status:429,headers:{'retry-after':'1'}},{}]); await settle(clock,makeVendor(n).charge({idempotencyKey:'k'})); assert.ok(n.requests[1].start-n.requests[0].end>=1000);
 n=new Network([{status:503,headers:{'retry-after':'10'}}]); assert.ok((await settle(clock,makeVendor(n).lookup('a'))).error); assert.equal(n.requests.length,1);
 n=new Network([{status:503},{}]); assert.ok((await settle(clock,makeVendor(n).charge({}))).error); assert.equal(n.requests.length,1);
}));
EOF
python3 /tmp/remote-calls-runs/skill-md/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
{"passed": false, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 1, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2716 tests/resilience.test.mjs (136.374303ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 0\n\u2139 fail 1\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 152.502394\n\n\u2716 failing tests:\n\ntest at tests/resilience.test.mjs:1:1\n\u2716 tests/resilience.test.mjs (136.374303ms)\n  'test failed'\n"}]}

```

```bash
/bin/bash -lc "cat > src/adapters/vendor.js <<'EOF'
import { readFileSync } from 'node:fs';
import { handleWhen, retry, DelegateBackoff } from 'cockatiel';
import { request } from '../infra/network.js';
const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
const fault = error => error.message === 'network aborted' || error.status === 429 || error.status >= 500 || ("'!error.status && !(error instanceof TypeError));
export function makeVendor(network, { dependency = '"'payment' } = {}) {
  const cfg = config[dependency];
  async function invoke(operation, payload, idempotent) {
    const started = Date.now();
    const r = cfg.retry;
    let delay;
    const policy = retry(handleWhen(error => {
      if ("'!idempotent || !fault(error)) return false;
      const retryAfter = Number(error.headers?.['"'retry-after'] ?? 0) * 1000;
      delay = Math.max(delay ?? 0, Number.isFinite(retryAfter) ? retryAfter : 0);
      return Date.now() - started + delay + cfg.timeoutMs <= r.budgetMs;
    }), {
      maxAttempts: idempotent ? r.maxRetries : 0,
      backoff: new DelegateBackoff(() => delay),
    });
    return policy.execute(({ attempt }) => {
      delay = Math.random() * r.baseMs * 2 ** attempt;
      return request(network, { operation, payload, timeout: cfg.timeoutMs });
    });
  }
  return {
    lookup: sku => invoke('lookup', { sku }, true),
    charge: order => invoke('charge', order, Boolean(order.idempotencyKey)),
  };
}
EOF
python3 /tmp/remote-calls-runs/skill-md/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'
python3 - <<'PY'
import json
p='RESULT.json';r=json.load(open(p));r['proceduresRun'].append('P2');json.dump(r,open(p,'w'),indent=2)
PY"
```
Exit: 0
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 tests/resilience.test.mjs (129.622628ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 1\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 144.660846\n"}]}

```

The timeout and retry checks pass. Unkeyed charges make one attempt, and Retry-After values that exceed the retry budget fail without another call. Next I’ll add the payment breaker, checkout fallback, and tests for recovery, dependency independence, and telemetry.

```bash
/bin/bash -lc "cat >> tests/resilience.test.mjs <<'EOF'
test('payment opens at four failures, isolates catalog, probes once and reports transitions',()=>timed(async clock=>{
 logs.length=0; metrics.length=0;
 const n=new Network([...Array(4).fill({status:503}),{delay:20},{}]); const v=makeVendor(n);
 for(let i=0;i<3;i++) { assert.ok((await settle(clock,v.charge({}),1)).error); }
 assert.equal(n.requests.length,3);
 assert.ok((await settle(clock,v.charge({}),1)).error);
 const before=n.requests.length;
 const r=await settle(clock,checkout(v,{sku:'a'}),1);
 assert.deepEqual(r.value,{status:'temporarily_unavailable',message:'Payments are temporarily unavailable. Please try again later.'}); assert.equal(n.requests.length,before);
 const other=new Network(); assert.ok((await settle(clock,makeVendor(other,{dependency:'catalog'}).lookup('a'),1)).value);
 await clock.tickAsync(201);
 const trial=v.lookup('a'); const competing=v.lookup('b');
 const competingResult=await settle(clock,competing,1); assert.ok(competingResult.error); assert.equal(n.requests.length,5);
 assert.ok((await settle(clock,trial,21)).value);
 assert.ok((await settle(clock,v.lookup('c'),1)).value);
 assert.deepEqual(logs.map(e=>e.state),['Open','HalfOpen','Closed']); assert.deepEqual(metrics,logs); assert.ok(logs.every(e=>e.dependency==='payment'));
}));
test('client errors never trip and failed recovery reopens',()=>timed(async clock=>{
 const n=new Network(Array(8).fill({status:400})); const v=makeVendor(n);
 for(let i=0;i<8;i++) assert.ok((await settle(clock,v.lookup('a'),1)).error);
 assert.equal(n.requests.length,8);
 const bad=new Network(Array(10).fill({status:503})); const b=makeVendor(bad);
 for(let i=0;i<4;i++) await settle(clock,b.charge({}),1);
 await clock.tickAsync(201); await settle(clock,b.charge({}),1);
 await settle(clock,b.charge({}),1); assert.equal(bad.requests.length,5);
}));
EOF
python3 /tmp/remote-calls-runs/skill-md/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
{"passed": false, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 1, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2716 tests/resilience.test.mjs (111.37712ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 0\n\u2139 fail 1\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 123.36691\n\n\u2716 failing tests:\n\ntest at tests/resilience.test.mjs:1:1\n\u2716 tests/resilience.test.mjs (111.37712ms)\n  'test failed'\n"}]}

```

```bash
/bin/bash -lc "python3 - <<'PY'
p='src/adapters/vendor.js';s=open(p).read().replace('DelegateBackoff }','DelegateBackoff, circuitBreaker, SamplingBreaker, CircuitState, BrokenCircuitError }');s=s.replace(\"import { request }\", \"import { log, metric } from '../infra/telemetry.js';\\nimport { request }\")
s=s.replace('  async function invoke', '''  const b = cfg.breaker;
  const breaker = b && circuitBreaker(handleWhen(fault), {
    breaker: new SamplingBreaker({ threshold: b.failureRate, duration: b.windowMs,
      minimumRps: b.minimumCalls * 1000 / b.windowMs }),
    halfOpenAfter: b.openMs,
  });
  breaker?.onStateChange(state => {
    const event = { event: 'circuit_state_change', dependency, state: CircuitState[state] };
    log(event); metric(event);
  });
  async function invoke''')
s=s.replace('"'!idempotent || !fault(error)'"', '"'!idempotent || error instanceof BrokenCircuitError || breaker?.state === CircuitState.Open || !fault(error)'"')
s=s.replace('      return request(network, { operation, payload, timeout: cfg.timeoutMs });', '''      const call = () => request(network, { operation, payload, timeout: cfg.timeoutMs });
      return breaker ? breaker.execute(call) : call();''')
s=s.replace('    return policy.execute(', '    try { return await policy.execute(')
s=s.replace('    });\\n  }\\n  return', '''    }); } catch (error) {
      if (error instanceof BrokenCircuitError || fault(error)) {
        const unavailable = new Error("'`${dependency} temporarily unavailable`, { cause: error });
        unavailable.code = '"'DEPENDENCY_UNAVAILABLE';
        throw unavailable;
      }
      throw error;
    }
  }
  return''')
open(p,'w').write(s)
p='src/core/checkout.js';s=open(p).read().replace('  const stock', '  try {\\n  const stock').replace(\"  return { status: 'confirmed' };\", \"  return { status: 'confirmed' };\\n  } catch (error) {\\n    if (error.code === 'DEPENDENCY_UNAVAILABLE') return { status: 'temporarily_unavailable', message: 'Payments are temporarily unavailable. Please try again later.' };\\n    throw error;\\n  }\");open(p,'w').write(s)
PY
python3 /tmp/remote-calls-runs/skill-md/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
{"passed": false, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 1, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2716 tests/resilience.test.mjs (115.973447ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 0\n\u2139 fail 1\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 126.78976\n\n\u2716 failing tests:\n\ntest at tests/resilience.test.mjs:1:1\n\u2716 tests/resilience.test.mjs (115.973447ms)\n  'test failed'\n"}]}

```

```bash
/bin/bash -lc 'node tests/resilience.test.mjs; cat src/adapters/vendor.js; git status --short'
```
Exit: 128
```text
✔ native timeout cancels unkeyed charge within 100ms (6.623275ms)
✔ idempotent retries, cap, Retry-After and budget (4.918476ms)
✖ payment opens at four failures, isolates catalog, probes once and reports transitions (5.468777ms)
✔ client errors never trip and failed recovery reopens (3.966838ms)
ℹ tests 4
ℹ suites 0
ℹ pass 3
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 27.628193

✖ failing tests:

test at tests/resilience.test.mjs:21:1
✖ payment opens at four failures, isolates catalog, probes once and reports transitions (5.468777ms)
  AssertionError [ERR_ASSERTION]: call must settle within budget
      at settle (file:///tmp/remote-calls-runs/skill-md/breaker/repo/tests/resilience.test.mjs:9:161)
      at async file:///tmp/remote-calls-runs/skill-md/breaker/repo/tests/resilience.test.mjs:33:24
      at async timed (file:///tmp/remote-calls-runs/skill-md/breaker/repo/tests/resilience.test.mjs:8:70)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
import { readFileSync } from 'node:fs';
import { handleWhen, retry, DelegateBackoff, circuitBreaker, SamplingBreaker, CircuitState, BrokenCircuitError } from 'cockatiel';
import { log, metric } from '../infra/telemetry.js';
import { request } from '../infra/network.js';
const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
const fault = error => error.message === 'network aborted' || error.status === 429 || error.status >= 500 || (!error.status && !(error instanceof TypeError));
export function makeVendor(network, { dependency = 'payment' } = {}) {
  const cfg = config[dependency];
  const b = cfg.breaker;
  const breaker = b && circuitBreaker(handleWhen(fault), {
    breaker: new SamplingBreaker({ threshold: b.failureRate, duration: b.windowMs,
      minimumRps: b.minimumCalls * 1000 / b.windowMs }),
    halfOpenAfter: b.openMs,
  });
  breaker?.onStateChange(state => {
    const event = { event: 'circuit_state_change', dependency, state: CircuitState[state] };
    log(event); metric(event);
  });
  async function invoke(operation, payload, idempotent) {
    const started = Date.now();
    const r = cfg.retry;
    let delay;
    const policy = retry(handleWhen(error => {
      if (!idempotent || error instanceof BrokenCircuitError || breaker?.state === CircuitState.Open || !fault(error)) return false;
      const retryAfter = Number(error.headers?.['retry-after'] ?? 0) * 1000;
      delay = Math.max(delay ?? 0, Number.isFinite(retryAfter) ? retryAfter : 0);
      return Date.now() - started + delay + cfg.timeoutMs <= r.budgetMs;
    }), {
      maxAttempts: idempotent ? r.maxRetries : 0,
      backoff: new DelegateBackoff(() => delay),
    });
    try { return await policy.execute(({ attempt }) => {
      delay = Math.random() * r.baseMs * 2 ** attempt;
      const call = () => request(network, { operation, payload, timeout: cfg.timeoutMs });
      return breaker ? breaker.execute(call) : call();
    }); } catch (error) {
      if (error instanceof BrokenCircuitError || fault(error)) {
        const unavailable = new Error(`${dependency} temporarily unavailable`, { cause: error });
        unavailable.code = 'DEPENDENCY_UNAVAILABLE';
        throw unavailable;
      }
      throw error;
    }
  }
  return {
    lookup: sku => invoke('lookup', { sku }, true),
    charge: order => invoke('charge', order, Boolean(order.idempotencyKey)),
  };
}
fatal: not a git repository (or any of the parent directories): .git

```

```bash
/bin/bash -lc "rg -n -A90 'executeHalfOpen' node_modules/cockatiel/dist/CircuitBreakerPolicy.js"
```
Exit: 0
```text
165:                return this.executeHalfOpen(fn, signal, state);
166-            case CircuitState.Open:
167-                if (Date.now() - state.openedAt < state.backoff.duration) {
168-                    throw new BrokenCircuitError();
169-                }
170-                const halfOpenState = {
171-                    value: CircuitState.HalfOpen,
172-                    backoff: state.backoff,
173-                    attemptNo: state.attemptNo + 1,
174-                    decision: defer(),
175-                    inFlight: 0,
176-                    successes: 0,
177-                    failures: 0,
178-                };
179-                this.innerState = halfOpenState;
180-                this.halfOpenEmitter.emit();
181-                this.stateChangeEmitter.emit(CircuitState.HalfOpen);
182:                return this.executeHalfOpen(fn, signal, halfOpenState);
183-            case CircuitState.Isolated:
184-                throw new IsolatedCircuitError();
185-            default:
186-                throw new Error(`Unexpected circuit state ${state}`);
187-        }
188-    }
189:    async executeHalfOpen(fn, signal, state) {
190-        if (this.innerState !== state) {
191-            return this.execute(fn, signal);
192-        }
193-        if (state.successes + state.failures + state.inFlight >= this.halfOpenSampling.calls) {
194-            await state.decision.promise;
195-            if (this.state === CircuitState.Closed && signal.aborted) {
196-                throw new TaskCancelledError();
197-            }
198-            return this.execute(fn, signal);
199-        }
200-        state.inFlight++;
201-        let result;
202-        try {
203-            result = await this.executor.invoke(fn, { signal });
204-        }
205-        catch (err) {
206-            // It's an error, but not one the circuit is meant to retry, so
207-            // for our purposes it's a success. Task failed successfully!
208-            this.recordHalfOpenSuccess(state);
209-            throw err;
210-        }
211-        if ('success' in result) {
212-            this.recordHalfOpenSuccess(state);
213-        }
214-        else {
215-            this.innerLastFailure = result;
216-            this.recordHalfOpenFailure(state, result, signal);
217-        }
218-        return returnOrThrow(result);
219-    }
220-    /**
221-     * Captures circuit breaker state that can later be used to recreate the
222-     * breaker by passing `state` to the `circuitBreaker` function. This is
223-     * useful in cases like serverless functions where you may want to keep
224-     * the breaker state across multiple executions.
225-     */
226-    toJSON() {
227-        const state = this.innerState;
228-        let ownState;
229-        if (state.value === CircuitState.HalfOpen) {
230-            ownState = {
231-                value: CircuitState.Open,
232-                openedAt: 0,
233-                attemptNo: state.attemptNo,
234-            };
235-        }
236-        else if (state.value === CircuitState.Open) {
237-            ownState = {
238-                value: CircuitState.Open,
239-                openedAt: state.openedAt,
240-                attemptNo: state.attemptNo,
241-            };
242-        }
243-        else {
244-            ownState = state;
245-        }
246-        return { ownState, breakerState: this.options.breaker.state };
247-    }
248-    recordHalfOpenSuccess(state) {
249-        if (this.innerState !== state) {
250-            return;
251-        }
252-        state.inFlight--;
253-        state.successes++;
254-        this.maybeCompleteHalfOpen(state);
255-    }
256-    recordHalfOpenFailure(state, reason, signal) {
257-        if (this.innerState !== state) {
258-            return;
259-        }
260-        state.inFlight--;
261-        state.failures++;
262-        if (state.failures > this.halfOpenSampling.threshold * this.halfOpenSampling.calls) {
263-            this.options.breaker.failure(CircuitState.HalfOpen);
264-            this.open(reason, signal);
265-            return;
266-        }
267-        this.maybeCompleteHalfOpen(state);
268-    }
269-    maybeCompleteHalfOpen(state) {
270-        if (state.successes + state.failures < this.halfOpenSampling.calls || state.inFlight) {
271-            return;
272-        }
273-        this.close();
274-    }
275-    open(reason, signal) {
276-        if (this.state === CircuitState.Isolated || this.state === CircuitState.Open) {
277-            return;
278-        }
279-        const previousState = this.innerState;

```

```bash
/bin/bash -lc "python3 - <<'PY'
p='src/adapters/vendor.js';s=open(p).read().replace(\"      const call = () => request\", \"      if (breaker?.state === CircuitState.HalfOpen) throw new BrokenCircuitError();\\n      const call = () => request\");open(p,'w').write(s)
p='tests/resilience.test.mjs';s=open(p).read().replace('FakeTimers.install()', \"FakeTimers.install({toFake:['Date','setTimeout','clearTimeout']})\");open(p,'w').write(s)
PY
python3 /tmp/remote-calls-runs/skill-md/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 native timeout cancels unkeyed charge within 100ms (8.769882ms)\n\u2714 idempotent retries, cap, Retry-After and budget (5.763579ms)\n\u2714 payment opens at four failures, isolates catalog, probes once and reports transitions (3.940536ms)\n\u2714 client errors never trip and failed recovery reopens (2.538914ms)\n\u2139 tests 4\n\u2139 suites 0\n\u2139 pass 4\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 100.42835\n"}]}

```

```bash
/bin/bash -lc "cat > src/core/checkout.js <<'EOF'
export async function checkout(vendor, order) {
  try {
    const stock = await vendor.lookup(order.sku);
    if ("'!stock.available) return { status: '"'unavailable' };
    await vendor.charge(order);
    return { status: 'confirmed' };
  } catch (error) {
    if (error.code === 'DEPENDENCY_UNAVAILABLE') {
      return {
        status: 'temporarily_unavailable',
        message: 'Payments are temporarily unavailable. Please try again later.',
      };
    }
    throw error;
  }
}
EOF
python3 - <<'PY'
import json
p='RESULT.json';r=json.load(open(p));r['proceduresRun'].append('P3');json.dump(r,open(p,'w'),indent=2)
PY
python3 /tmp/remote-calls-runs/skill-md/breaker/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 native timeout cancels unkeyed charge within 100ms (6.058553ms)\n\u2714 idempotent retries, cap, Retry-After and budget (5.100319ms)\n\u2714 payment opens at four failures, isolates catalog, probes once and reports transitions (4.003019ms)\n\u2714 client errors never trip and failed recovery reopens (5.24532ms)\n\u2139 tests 4\n\u2139 suites 0\n\u2139 pass 4\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 117.715189\n"}]}

```

```bash
/bin/bash -lc "cat > /tmp/remote-calls-runs/skill-md/breaker/AGENT_REPORT.md <<'EOF'
Applied the supplied remote-calls skill. Ran P0, P1, P2 and P3; P4 was not requested or run.

P0: installed dependencies with "'`npm install --ignore-scripts`, then ran `python3 /tmp/remote-calls-runs/skill-md/breaker/skill/scripts/scan_remote_calls.py companion.json .`. Scanner reported three missing timeouts (weather and both vendor calls), zero violations and zero unsupported constructs. Preserved its actual findings in RESULT.json. Problems 1 and 3 apply: hanging payment calls and sustained outages degrading other pages. These are external calls without an existing resilience mechanism, so the applicability gate passed. Initial `python` invocation failed because only python3 is installed; an attempted --help invocation revealed the scanner expects positional arguments.

P1 scope: vendor lookup and charge, leaving weather unchanged. Configured payment and catalog timeouts at measured p99.9 80ms plus padding 20ms. Added a failing timeout scenario, implemented native cancellation, and passed checks.

P2 gates: lookup and keyed charge qualify; unkeyed charge stops at the idempotency gate and makes one attempt. No existing retry layer. Used Cockatiel retry with three retries, full exponential jitter, Retry-After minimum delay and a 2400ms budget reserving time for the next attempt. Config records measured payment settings and the assumed catalog envelope. Tests first failed without retries, then passed.

P3 gate: only payment has sustained-failure evidence; catalog has no breaker. Used Cockatiel SamplingBreaker with measured 50% threshold, 1000ms window, four-call minimum (converted to minimum RPS), 200ms open duration and one half-open trial. Concurrent half-open callers fail fast through a state-based admission check, since the library otherwise waits for the trial decision. Native timeout is inside breaker inside retry; open circuits do not retry. Both adapter operations expose a dependency-unavailable error, and checkout displays the declared fallback. Every breaker transition emits a log and metric with dependency and state. Tests first failed without the breaker/fallback, then passed. Fake timers were restricted to Date and timeout APIs to avoid interfering with Node'"'s test runner.

Validation: ran the supplied scripts/run_check.py for each procedure with "'`node dependency-check.mjs` and `npm run check && node --test tests/*.test.mjs`. Final result: both commands exit 0, four deterministic tests pass. Scenarios cover timeout cancellation, transient recovery, retry cap, Retry-After, budget, unkeyed safety, four-failure trip, open fallback/no outbound calls, catalog independence, one recovery trial, successful close, failed trial reopening, client-error exclusion, and transition telemetry.

Changes: src/adapters/vendor.js, src/core/checkout.js, src/config.json; added tests/resilience.test.mjs and RESULT.json. Boundaries, measurements, companion, supplied checker and task remain unchanged.
EOF'
```
Exit: 0
```text

```

Completed P0–P3: added measured timeouts, safe retries, a payment circuit breaker, telemetry, and checkout’s unavailable fallback.

Dependency and syntax checks pass; all four tests pass.

Saved evidence in [RESULT.json](/tmp/remote-calls-runs/skill-md/breaker/repo/RESULT.json) and the report in [AGENT_REPORT.md](/tmp/remote-calls-runs/skill-md/breaker/AGENT_REPORT.md).

