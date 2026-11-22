# Observable transcript: skill-md-bulkhead

I’ll read the task, skill, and companion inputs, then run P0 and preserve its evidence before applying the skill’s gates.


```bash
/bin/bash -lc 'pwd && cat TASK.md COMPANION.md companion.json /tmp/remote-calls-runs/skill-md/bulkhead/skill/SKILL.md'
```
Exit: 0
```text
/tmp/remote-calls-runs/skill-md/bulkhead/repo
Slow payment provider requests consume a shared application concurrency budget and catalog pages stall even though catalog responds in 10 ms. Load measurements allow two calls per provider with no queue. Isolate provider capacity with the declared page fallback. Apply P0, P1, P4.
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
/bin/bash -lc "rg --files -g '"'!node_modules/**'"' -g '"'!package-lock.json'"' . /tmp/remote-calls-runs/skill-md/bulkhead/skill && cat measurement.json package.json src/adapters/* src/core/* src/config.json"
```
Exit: 0
```text
/tmp/remote-calls-runs/skill-md/bulkhead/skill/SKILL.md
/tmp/remote-calls-runs/skill-md/bulkhead/skill/scripts/__pycache__/scan_remote_calls.cpython-312.pyc
/tmp/remote-calls-runs/skill-md/bulkhead/skill/scripts/run_check.py
/tmp/remote-calls-runs/skill-md/bulkhead/skill/scripts/scan_remote_calls.py
/tmp/remote-calls-runs/skill-md/bulkhead/skill/scripts/scan_javascript.cjs
./TASK.md
./package.json
./dependency-check.mjs
./COMPANION.md
./src/config.json
./src/infra/telemetry.js
./src/infra/network.js
./src/adapters/untouched.js
./src/adapters/vendor.js
./companion.json
./measurement.json
./src/core/checkout.js
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
{}

```

```bash
/bin/bash -lc 'cat /tmp/remote-calls-runs/skill-md/bulkhead/skill/scripts/scan_remote_calls.py /tmp/remote-calls-runs/skill-md/bulkhead/skill/scripts/run_check.py src/infra/network.js dependency-check.mjs'
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
import { parse } from 'acorn';
import { readdirSync, readFileSync } from 'node:fs';
function files(dir) {return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${dir}/${e.name}`):[`${dir}/${e.name}`]);}
const violations=[];
for(const f of files('src/core').filter(f=>f.endsWith('.js'))) {
 const ast=parse(readFileSync(f,'utf8'),{ecmaVersion:'latest',sourceType:'module'});
 for(const n of ast.body) if(n.type==='ImportDeclaration' && (n.source.value==='cockatiel'||n.source.value.includes('/adapters/'))) violations.push(f+': '+n.source.value);
}
if(violations.length) {console.error(violations.join('\n'));process.exit(1);}

```

```bash
/bin/bash -lc 'python /tmp/remote-calls-runs/skill-md/bulkhead/skill/scripts/scan_remote_calls.py companion.json . > /tmp/bulkhead-p0.json; cat /tmp/bulkhead-p0.json'
```
Exit: 0
```text
/bin/bash: line 1: python: command not found

```

```bash
/bin/bash -lc "ls node_modules/cockatiel/dist && rg -n 'bulkhead|Bulkhead' node_modules/cockatiel/dist/BulkheadPolicy* node_modules/cockatiel/dist/index.d.ts"
```
Exit: 0
```text
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
node_modules/cockatiel/dist/index.d.ts:3:export * from './BulkheadPolicy.js';
node_modules/cockatiel/dist/BulkheadPolicy.d.ts:2:export declare class BulkheadPolicy implements IPolicy {
node_modules/cockatiel/dist/BulkheadPolicy.d.ts:19:     * Emitter that fires when an item is rejected from the bulkhead.
node_modules/cockatiel/dist/BulkheadPolicy.d.ts:31:     * Bulkhead limits concurrent requests made.
node_modules/cockatiel/dist/BulkheadPolicy.d.ts:37:     * @throws a {@link BulkheadRejectedException} if the bulkhead limits are exceeeded
node_modules/cockatiel/dist/BulkheadPolicy.js.map:1:{"version":3,"file":"BulkheadPolicy.js","sourceRoot":"","sources":["../src/BulkheadPolicy.ts"],"names":[],"mappings":"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","sourcesContent":["import { neverAbortedSignal } from './common/abort.js';\nimport { defer } from './common/defer.js';\nimport { EventEmitter } from './common/Event.js';\nimport { ExecuteWrapper } from './common/Executor.js';\nimport { BulkheadRejectedError } from './errors/BulkheadRejectedError.js';\nimport { TaskCancelledError } from './errors/Errors.js';\nimport { IDefaultPolicyContext, IPolicy } from './Policy.js';\n\ninterface IQueueItem<T> {\n  signal: AbortSignal;\n  fn(context: IDefaultPolicyContext): Promise<T> | T;\n  resolve(value: T): void;\n  reject(error: unknown): void;\n}\n\nexport class BulkheadPolicy implements IPolicy {\n  declare public readonly _altReturn: never;\n\n  private active = 0;\n  private readonly queue: Array<IQueueItem<unknown>> = [];\n  private readonly onRejectEmitter = new EventEmitter<void>();\n  private readonly executor = new ExecuteWrapper();\n\n  /**\n   * @inheritdoc\n   */\n  public readonly onSuccess = this.executor.onSuccess;\n\n  /**\n   * @inheritdoc\n   */\n  public readonly onFailure = this.executor.onFailure;\n\n  /**\n   * Emitter that fires when an item is rejected from the bulkhead.\n   */\n  public readonly onReject = this.onRejectEmitter.addListener;\n\n  /**\n   * Returns the number of available execution slots at this point in time.\n   */\n  public get executionSlots() {\n    return this.capacity - this.active;\n  }\n\n  /**\n   * Returns the number of queue slots at this point in time.\n   */\n  public get queueSlots() {\n    return this.queueCapacity - this.queue.length;\n  }\n\n  /**\n   * Bulkhead limits concurrent requests made.\n   */\n  constructor(\n    private readonly capacity: number,\n    private readonly queueCapacity: number,\n  ) {}\n\n  /**\n   * Executes the given function.\n   * @param fn Function to execute\n   * @throws a {@link BulkheadRejectedException} if the bulkhead limits are exceeeded\n   */\n  public async execute<T>(\n    fn: (context: IDefaultPolicyContext) => PromiseLike<T> | T,\n    signal = neverAbortedSignal,\n  ): Promise<T> {\n    if (signal.aborted) {\n      throw new TaskCancelledError();\n    }\n\n    if (this.active < this.capacity) {\n      this.active++;\n      try {\n        return await fn({ signal });\n      } finally {\n        this.active--;\n        this.dequeue();\n      }\n    }\n\n    if (this.queue.length < this.queueCapacity) {\n      const { resolve, reject, promise } = defer<T>();\n      this.queue.push({ signal, fn, resolve, reject });\n      return promise;\n    }\n\n    this.onRejectEmitter.emit();\n    throw new BulkheadRejectedError(this.capacity, this.queueCapacity);\n  }\n\n  private dequeue() {\n    const item = this.queue.shift();\n    if (!item) {\n      return;\n    }\n\n    Promise.resolve().then(() => {\n      if (item.signal.aborted) {\n        item.reject(new TaskCancelledError());\n        this.dequeue();\n        return;\n      }\n\n      this.execute(item.fn, item.signal).then(item.resolve, item.reject);\n    });\n  }\n}\n"]}
node_modules/cockatiel/dist/BulkheadPolicy.js:5:import { BulkheadRejectedError } from './errors/BulkheadRejectedError.js';
node_modules/cockatiel/dist/BulkheadPolicy.js:7:export class BulkheadPolicy {
node_modules/cockatiel/dist/BulkheadPolicy.js:23:     * Emitter that fires when an item is rejected from the bulkhead.
node_modules/cockatiel/dist/BulkheadPolicy.js:39:     * Bulkhead limits concurrent requests made.
node_modules/cockatiel/dist/BulkheadPolicy.js:48:     * @throws a {@link BulkheadRejectedException} if the bulkhead limits are exceeeded
node_modules/cockatiel/dist/BulkheadPolicy.js:70:        throw new BulkheadRejectedError(this.capacity, this.queueCapacity);
node_modules/cockatiel/dist/BulkheadPolicy.js:87://# sourceMappingURL=BulkheadPolicy.js.map

```

```bash
/bin/bash -lc 'python3 /tmp/remote-calls-runs/skill-md/bulkhead/skill/scripts/scan_remote_calls.py companion.json . > /tmp/bulkhead-p0.json; cat /tmp/bulkhead-p0.json'
```
Exit: 0
```text
{
  "violations": [],
  "missingTimeouts": [
    {
      "path": "/tmp/remote-calls-runs/skill-md/bulkhead/repo/src/adapters/untouched.js",
      "line": 2,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/skill-md/bulkhead/repo/src/adapters/vendor.js",
      "line": 4,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/skill-md/bulkhead/repo/src/adapters/vendor.js",
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
/bin/bash -lc "node --version && rg -n 'function bulkhead' node_modules/cockatiel/dist/Policy*"
```
Exit: 0
```text
v26.12.0
node_modules/cockatiel/dist/Policy.js.map:1:{"version":3,"file":"Policy.js","sourceRoot":"","sources":["../src/Policy.ts"],"names":[],"mappings":"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","sourcesContent":["import { ConstantBackoff, IBackoffFactory } from './backoff/Backoff.js';\nimport { BulkheadPolicy } from './BulkheadPolicy.js';\nimport { CircuitBreakerPolicy, ICircuitBreakerOptions } from './CircuitBreakerPolicy.js';\nimport { Event } from './common/Event.js';\nimport { ExecuteWrapper } from './common/Executor.js';\nimport { FallbackPolicy } from './FallbackPolicy.js';\nimport { NoopPolicy } from './NoopPolicy.js';\nimport { IRetryBackoffContext, RetryPolicy } from './RetryPolicy.js';\nimport { TimeoutPolicy, TimeoutStrategy } from './TimeoutPolicy.js';\n\ntype Constructor<T> = new (...args: any) => T;\n\nconst typeFilter = <T>(cls: Constructor<T>, predicate?: (error: T) => boolean) =>\n  predicate ? (v: unknown) => v instanceof cls && predicate(v) : (v: unknown) => v instanceof cls;\n\nconst always = () => true;\nconst never = () => false;\n\nexport interface IBasePolicyOptions {\n  errorFilter: (error: unknown) => boolean;\n  resultFilter: (result: unknown) => boolean;\n}\n\n/**\n * The reason for a call failure. Either an error, or the a value that was\n * marked as a failure (when using result filtering).\n */\nexport type FailureReason<ReturnType> = { error: unknown } | { value: ReturnType };\n\n/**\n * Event emitted on the `onFailure` calls.\n */\nexport interface IFailureEvent {\n  /**\n   * Call duration, in milliseconds (with nanosecond precision, as the OS allows).\n   */\n  duration: number;\n\n  /**\n   * Whether the error was handled by the policy.\n   */\n  handled: boolean;\n\n  /**\n   * The reason for the error.\n   */\n  reason: FailureReason<unknown>;\n}\n\n/**\n * Event emitted on the `onSuccess` calls.\n */\nexport interface ISuccessEvent {\n  /**\n   * Call duration, in milliseconds (with nanosecond precision, as the OS allows).\n   */\n  duration: number;\n}\n\nexport interface IDefaultPolicyContext {\n  /**\n   * Abort signal for the operation. This is propagated through multiple\n   * retry policies.\n   */\n  signal: AbortSignal;\n}\n\n/**\n * IPolicy is the type of all policies that Cockatiel provides. It describes\n * an execute() function which takes a generic argument.\n */\nexport interface IPolicy<\n  ContextType extends IDefaultPolicyContext = IDefaultPolicyContext,\n  AltReturn = never,\n> {\n  /**\n   * Virtual property only used for TypeScript--will not actually be defined.\n   * @deprecated This property does not exist\n   */\n  readonly _altReturn: AltReturn;\n\n  /**\n   * Fires on the policy when a request successfully completes and some\n   * successful value will be returned. In a retry policy, this is fired once\n   * even if the request took multiple retries to succeed.\n   */\n  readonly onSuccess: Event<ISuccessEvent>;\n\n  /**\n   * Fires on the policy when a request fails *due to a handled reason* fails\n   * and will give rejection to the called.\n   */\n  readonly onFailure: Event<IFailureEvent>;\n\n  /**\n   * Runs the function through behavior specified by the policy.\n   */\n  execute<T>(\n    fn: (context: ContextType) => PromiseLike<T> | T,\n    signal?: AbortSignal,\n  ): Promise<T | AltReturn>;\n}\n\nexport interface IMergedPolicy<\n  A extends IDefaultPolicyContext,\n  B,\n  W extends IPolicy<any, any>[],\n> extends IPolicy<A, B> {\n  readonly wrapped: W;\n}\n\ntype MergePolicies<A, B> =\n  A extends IPolicy<infer A1, any>\n    ? B extends IPolicy<infer B1, any>\n      ? IMergedPolicy<\n          A1 & B1,\n          A['_altReturn'] | B['_altReturn'],\n          B extends IMergedPolicy<any, any, infer W> ? [A, ...W] : [A, B]\n        >\n      : never\n    : never;\n\nexport class Policy {\n  /**\n   * Factory that builds a base set of filters that can be used in circuit\n   * breakers, retries, etc.\n   */\n  constructor(public readonly options: Readonly<IBasePolicyOptions>) {}\n\n  /**\n   * Allows the policy to additionally handles errors of the given type.\n   *\n   * @param cls Class constructor to check that the error is an instance of.\n   * @param predicate If provided, a function to be called with the error\n   * which should return \"true\" if we want to handle this error.\n   * @example\n   * ```js\n   * // retry both network errors and response errors with a 503 status code\n   * new Policy()\n   *  .orType(NetworkError)\n   *  .orType(ResponseError, err => err.statusCode === 503)\n   *  .retry()\n   *  .attempts(3)\n   *  .execute(() => getJsonFrom('https://example.com'));\n   * ```\n   */\n  public orType<T>(cls: Constructor<T>, predicate?: (error: T) => boolean) {\n    const filter = typeFilter(cls, predicate);\n    return new Policy({\n      ...this.options,\n      errorFilter: e => this.options.errorFilter(e) || filter(e),\n    });\n  }\n\n  /**\n   * Allows the policy to additionally handles errors that pass the given\n   * predicate function.\n   *\n   * @param predicate Takes any thrown error, and returns true if it should\n   * be retried by this policy.\n   * @example\n   * ```js\n   * // only retry if the error has a \"shouldBeRetried\" property set\n   * new Policy()\n   *  .orWhen(err => err.shouldBeRetried === true)\n   *  .retry()\n   *  .attempts(3)\n   *  .execute(() => getJsonFrom('https://example.com'));\n   * ```\n   */\n  public orWhen(predicate: (error: unknown) => boolean) {\n    return new Policy({\n      ...this.options,\n      errorFilter: e => this.options.errorFilter(e) || predicate(e),\n    });\n  }\n\n  /**\n   * Adds handling for return values. The predicate will be called with\n   * the return value of the executed function,\n   *\n   * @param predicate Takes the returned value, and returns true if it\n   * should be retried by this policy.\n   * @example\n   * ```js\n   * // retry when the response status code is a 5xx\n   * new Policy()\n   *  .orResultWhen(res => res.statusCode >= 500)\n   *  .retry()\n   *  .attempts(3)\n   *  .execute(() => getJsonFrom('https://example.com'));\n   * ```\n   */\n  public orWhenResult(predicate: (r: unknown) => boolean) {\n    return new Policy({\n      ...this.options,\n      resultFilter: r => this.options.resultFilter(r) || predicate(r),\n    });\n  }\n\n  /**\n   * Adds handling for return values. The predicate will be called with\n   * the return value of the executed function,\n   *\n   * @param predicate Takes the returned value, and returns true if it\n   * should be retried by this policy.\n   * @example\n   * ```js\n   * // retry when the response status code is a 5xx\n   * new Policy()\n   *  .orResultType(res => res.statusCode >= 500)\n   *  .retry()\n   *  .attempts(3)\n   *  .execute(() => getJsonFrom('https://example.com'));\n   * ```\n   */\n  public orResultType<T>(cls: Constructor<T>, predicate?: (error: T) => boolean) {\n    const filter = typeFilter(cls, predicate);\n    return new Policy({\n      ...this.options,\n      resultFilter: r => this.options.resultFilter(r) || filter(r),\n    });\n  }\n}\n\nexport const noop = new NoopPolicy();\n\n/**\n * A policy that handles all errors.\n */\nexport const handleAll = new Policy({ errorFilter: always, resultFilter: never });\n\n/**\n * See {@link Policy.orType} for usage.\n */\nexport function handleType<T>(cls: Constructor<T>, predicate?: (error: T) => boolean) {\n  return new Policy({ errorFilter: typeFilter(cls, predicate), resultFilter: never });\n}\n\n/**\n * See {@link Policy.orWhen} for usage.\n */\nexport function handleWhen(predicate: (error: unknown) => boolean) {\n  return new Policy({ errorFilter: predicate, resultFilter: never });\n}\n/**\n * See {@link Policy.orResultType} for usage.\n */\nexport function handleResultType<T>(cls: Constructor<T>, predicate?: (error: T) => boolean) {\n  return new Policy({ errorFilter: never, resultFilter: typeFilter(cls, predicate) });\n}\n\n/**\n * See {@link Policy.orWhenResult} for usage.\n */\nexport function handleWhenResult(predicate: (error: unknown) => boolean) {\n  return new Policy({ errorFilter: never, resultFilter: predicate });\n}\n\n/**\n * Creates a bulkhead--a policy that limits the number of concurrent calls.\n */\nexport function bulkhead(limit: number, queue: number = 0) {\n  return new BulkheadPolicy(limit, queue);\n}\n\n/**\n * A decorator that can be used to wrap class methods and apply the given\n * policy to them. It also adds the last argument normally given in\n * {@link Policy.execute} as the last argument in the function call.\n * For example:\n *\n * ```ts\n * import { usePolicy, retry, handleAll } from 'cockatiel';\n *\n * const retry = retry(handleAll, { maxAttempts: 3 });\n *\n * class Database {\n *   @usePolicy(retry)\n *   public getUserInfo(userId, context, cancellationToken) {\n *     console.log('Retry attempt number', context.attempt);\n *     // implementation here\n *   }\n * }\n *\n * const db = new Database();\n * db.getUserInfo(3).then(info => console.log('User 3 info:', info))\n * ```\n *\n * Note that it will force the return type to be a Promise, since that's\n * what policies return.\n */\nexport function usePolicy(policy: IPolicy<IDefaultPolicyContext, never>) {\n  return (_target: unknown, _key: string, descriptor: PropertyDescriptor) => {\n    const inner = descriptor.value;\n    if (typeof inner !== 'function') {\n      throw new Error(`Can only decorate functions with @cockatiel, got ${typeof inner}`);\n    }\n\n    descriptor.value = function (this: unknown, ...args: any[]) {\n      const signal = args[args.length - 1] instanceof AbortSignal ? args.pop() : undefined;\n      return policy.execute(context => inner.apply(this, [...args, context]), signal);\n    };\n  };\n}\n\n/**\n * Creates a timeout policy.\n * @param duration - How long to wait before timing out execute()'d functions\n * @param strategy - Strategy for timeouts, \"Cooperative\" or \"Aggressive\".\n * A {@link CancellationToken} will be pass to any executed function, and in\n * cooperative timeouts we'll simply wait for that function to return or\n * throw. In aggressive timeouts, we'll immediately throw a\n * {@link TaskCancelledError} when the timeout is reached, in addition to\n * marking the passed token as failed.\n */\nexport function timeout(\n  duration: number,\n  strategyOrOpts: TimeoutStrategy | { strategy: TimeoutStrategy; abortOnReturn: boolean },\n) {\n  return new TimeoutPolicy(\n    duration,\n    typeof strategyOrOpts === 'string' ? { strategy: strategyOrOpts } : strategyOrOpts,\n  );\n}\n\n/**\n * Wraps the given set of policies into a single policy. For instance, this:\n *\n * ```js\n * retry.execute(() =>\n *  breaker.execute(() =>\n *    timeout.execute(({ cancellationToken }) => getData(cancellationToken))))\n * ```\n *\n * Is the equivalent to:\n *\n * ```js\n * Policy\n *  .wrap(retry, breaker, timeout)\n *  .execute(({ cancellationToken }) => getData(cancellationToken)));\n * ```\n *\n * The `context` argument passed to the executed function is the merged object\n * of all previous policies.\n *\n */\n// The types here a certain unattrative. Ideally we could do\n// `wrap<A, B>(p: IPolicy<A, B>): IPolicy<A, B>`, but TS doesn't narrow the\n// types well in that scenario (unless p is explicitly typed as an IPolicy\n// and not some implementation) and returns `IPolicy<void, unknown>` and\n// the like. This is the best solution I've found for it.\nexport function wrap<A extends IPolicy<IDefaultPolicyContext, unknown>>(p1: A): A;\nexport function wrap<\n  A extends IPolicy<IDefaultPolicyContext, unknown>,\n  B extends IPolicy<IDefaultPolicyContext, unknown>,\n>(p1: A, p2: B): MergePolicies<A, B>;\nexport function wrap<\n  A extends IPolicy<IDefaultPolicyContext, unknown>,\n  B extends IPolicy<IDefaultPolicyContext, unknown>,\n  C extends IPolicy<IDefaultPolicyContext, unknown>,\n>(p1: A, p2: B, p3: C): MergePolicies<C, MergePolicies<A, B>>;\nexport function wrap<\n  A extends IPolicy<IDefaultPolicyContext, unknown>,\n  B extends IPolicy<IDefaultPolicyContext, unknown>,\n  C extends IPolicy<IDefaultPolicyContext, unknown>,\n  D extends IPolicy<IDefaultPolicyContext, unknown>,\n>(p1: A, p2: B, p3: C, p4: D): MergePolicies<D, MergePolicies<C, MergePolicies<A, B>>>;\nexport function wrap<\n  A extends IPolicy<IDefaultPolicyContext, unknown>,\n  B extends IPolicy<IDefaultPolicyContext, unknown>,\n  C extends IPolicy<IDefaultPolicyContext, unknown>,\n  D extends IPolicy<IDefaultPolicyContext, unknown>,\n  E extends IPolicy<IDefaultPolicyContext, unknown>,\n>(\n  p1: A,\n  p2: B,\n  p3: C,\n  p4: D,\n  p5: E,\n): MergePolicies<E, MergePolicies<D, MergePolicies<C, MergePolicies<A, B>>>>;\nexport function wrap<C extends IDefaultPolicyContext, A>(...p: Array<IPolicy<C, A>>): IPolicy<C, A>;\nexport function wrap<C extends IDefaultPolicyContext, A>(\n  ...p: Array<IPolicy<C, A>>\n): IMergedPolicy<C, A, IPolicy<C, A>[]> {\n  return {\n    _altReturn: undefined as any,\n    onFailure: p[0].onFailure,\n    onSuccess: p[0].onSuccess,\n    wrapped: p,\n    execute<T>(fn: (context: C) => PromiseLike<T> | T, signal: AbortSignal): Promise<T | A> {\n      const run = (context: C, i: number): PromiseLike<T | A> | T | A =>\n        i === p.length\n          ? fn(context)\n          : p[i].execute(next => run({ ...context, ...next }, i + 1), context.signal);\n      return Promise.resolve(run({ signal } as C, 0));\n    },\n  };\n}\n\n/**\n * Creates a retry policy. The options should contain the backoff strategy to\n * use. Included strategies are:\n *  - {@link ConstantBackoff}\n *  - {@link ExponentialBackoff}\n *  - {@link IterableBackoff}\n *  - {@link DelegateBackoff} (advanced)\n *\n * For example:\n *\n * ```\n * import { handleAll, retry } from 'cockatiel';\n *\n * const policy = retry(handleAll, { backoff: new ExponentialBackoff() });\n * ```\n *\n * You can optionally pass in the `attempts` to limit the maximum number of\n * retry attempts per call.\n */\nexport function retry(\n  policy: Policy,\n  opts: {\n    maxAttempts?: number;\n    backoff?: IBackoffFactory<IRetryBackoffContext<unknown>>;\n  },\n) {\n  return new RetryPolicy(\n    { backoff: opts.backoff || new ConstantBackoff(0), maxAttempts: opts.maxAttempts ?? Infinity },\n    new ExecuteWrapper(policy.options.errorFilter, policy.options.resultFilter),\n  );\n}\n\n/**\n * Returns a circuit breaker for the policy. **Important**: you should share\n * your circuit breaker between executions of whatever function you're\n * wrapping for it to function!\n *\n * ```ts\n * import { SamplingBreaker, Policy } from 'cockatiel';\n *\n * // Break if more than 20% of requests fail in a 30 second time window:\n * const breaker = Policy\n *  .handleAll()\n *  .circuitBreaker(10_000, new SamplingBreaker(0.2, 30 * 1000));\n *\n * export function handleRequest() {\n *   return breaker.execute(() => getInfoFromDatabase());\n * }\n * ```\n *\n * @param halfOpenAfter Time after failures to try to open the circuit\n * breaker again.\n * @param breaker The circuit breaker to use. This package exports\n * ConsecutiveBreaker and SamplingBreakers for you to use.\n */\nexport function circuitBreaker(policy: Policy, opts: ICircuitBreakerOptions) {\n  return new CircuitBreakerPolicy(\n    opts,\n    new ExecuteWrapper(policy.options.errorFilter, policy.options.resultFilter),\n  );\n}\n\n/**\n * Falls back to the given value in the event of an error.\n *\n * ```ts\n * import { Policy } from 'cockatiel';\n *\n * const fallback = Policy\n *  .handleType(DatabaseError)\n *  .fallback(() => getStaleData());\n *\n * export function handleRequest() {\n *   return fallback.execute(() => getInfoFromDatabase());\n * }\n * ```\n *\n * @param toValue Value to fall back to, or a function that creates the\n * value to return (any may return a promise)\n */\nexport function fallback<R>(policy: Policy, valueOrFactory: (() => Promise<R> | R) | R) {\n  return new FallbackPolicy(\n    new ExecuteWrapper(policy.options.errorFilter, policy.options.resultFilter),\n    // not technically type-safe, since if they actually want to _return_\n    // a function, that gets lost here. We'll just advice in the docs to\n    // use a higher-order function if necessary.\n    (typeof valueOrFactory === 'function' ? valueOrFactory : () => valueOrFactory) as () => R,\n  );\n}\n"]}
node_modules/cockatiel/dist/Policy.js:145:export function bulkhead(limit, queue = 0) {
node_modules/cockatiel/dist/Policy.d.ts:187:export declare function bulkhead(limit: number, queue?: number): BulkheadPolicy;

```

P0 found three calls without timeouts and no domain import violations. The task shows problems 1 and 4, so P1 and P4 apply. I’ll scope changes to vendor lookup and charge, leaving weather unchanged. Both dependencies have a measured timeout of 100 ms and a capacity of two calls with no queue.


```bash
/bin/bash -lc "python3 - <<'PY'
import json
p=json.load(open('/tmp/bulkhead-p0.json'))
json.dump(dict(missingTimeouts=p['missingTimeouts'],violations=p['violations'],problems=[1,4],applies=True,proceduresRun=['P0']),open('RESULT.json','w'),indent=2)
PY
mkdir -p tests
cat > tests/resilience.test.mjs <<'EOF'
import test from 'node:test';
import assert from 'node:assert/strict';
import FakeTimers from '@sinonjs/fake-timers';
import { Network } from '../src/infra/network.js';
import { makeVendor } from '../src/adapters/vendor.js';

for (const dependency of ['payment', 'catalog']) {
  for (const operation of ['lookup', 'charge']) {
    test("'`${dependency} ${operation} cancels at measured timeout`, async () => {
      const clock = FakeTimers.install();
      try {
        const network = new Network([{ delay: 1000 }]);
        const vendor = makeVendor(network, { dependency });
        const result = assert.rejects(vendor[operation]({ sku: '"'x' }));
        await clock.tickAsync(100);
        assert.equal(network.active, 0);
        assert.equal(network.requests[0].end - network.requests[0].start, 100);
        await result;
      } finally { clock.uninstall(); }
    });
  }
}
EOF
node --test tests/*.test.mjs"
```
Exit: 1
```text
✖ tests/resilience.test.mjs (86.780237ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 99.182821

✖ failing tests:

test at tests/resilience.test.mjs:1:1
✖ tests/resilience.test.mjs (86.780237ms)
  'test failed'

```

```bash
/bin/bash -lc "python3 - <<'PY'
import json
m=json.load(open('measurement.json'))
c={k:{'timeoutMs':v['p999Ms']+v['paddingMs'],'timeoutSource':'measurement.json: p999Ms (80) + paddingMs (20)'} for k,v in m.items()}
json.dump(c,open('src/config.json','w'),indent=2)
PY
cat > src/adapters/vendor.js <<'EOF'
import { request } from '../infra/network.js';
import config from '../config.json' with { type: 'json' };
export function makeVendor(network, { dependency = 'payment' } = {}) {
  const settings = config[dependency];
  if ("'!settings) throw new Error(`Unknown dependency: ${dependency}`);
  return {
    lookup: (sku) => request(network, { operation: '"'lookup', payload: { sku }, timeout: settings.timeoutMs }),
    charge: (order) => request(network, { operation: 'charge', payload: order, timeout: settings.timeoutMs }),
  };
}
EOF
python3 /tmp/remote-calls-runs/skill-md/bulkhead/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 tests/resilience.test.mjs (97.780788ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 1\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 109.788596\n"}]}

```

```bash
/bin/bash -lc "cat >> tests/resilience.test.mjs <<'EOF'

import { checkout } from '../src/core/checkout.js';
const fallback = { status: 'temporarily_unavailable', message: 'Payments are temporarily unavailable. Please try again later.' };
test('saturated payment leaves catalog capacity independent and rejects checkout immediately', async () => {
  const clock = FakeTimers.install();
  try {
    const payment = new Network([{ delay: 90 }, { delay: 90 }]);
    const vendor = makeVendor(payment);
    const pending = [vendor.lookup('a'), vendor.charge({ sku: 'b' })];
    assert.deepEqual(await checkout(vendor, { sku: 'c' }), fallback);
    assert.equal(payment.requests.length, 2);
    assert.equal(clock.now, 0);
    const catalog = new Network([{ delay: 10 }]);
    const read = makeVendor(catalog, { dependency: 'catalog' }).lookup('c');
    await clock.tickAsync(10);
    assert.deepEqual(await read, { available: true });
    assert.equal(payment.active, 2);
    await clock.tickAsync(80);
    await Promise.all(pending);
    await vendor.lookup('released');
    assert.equal(payment.peak, 2);
  } finally { clock.uninstall(); }
});
EOF
# Run with a deadline so a missing bulkhead cannot hang the pre-change scenario.
timeout 5 node --test tests/*.test.mjs"
```
Exit: 124
```text

Interrupted while running:

⚠ tests/resilience.test.mjs (tests/resilience.test.mjs:1:1)
✖ tests/resilience.test.mjs (4933.327902ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 0
ℹ cancelled 1
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4945.429143

✖ failing tests:

test at tests/resilience.test.mjs:1:1
✖ tests/resilience.test.mjs (4933.327902ms)
  'Promise resolution is still pending but the event loop has already resolved'

```

P1’s timeout tests and companion checks pass. P4’s saturation scenario remains pending before implementation because excess calls still enter the network. I’ll add a Cockatiel bulkhead for each dependency and map provider failures to the declared checkout fallback.


```bash
/bin/bash -lc "python3 - <<'PY'
import json
p='src/config.json'; c=json.load(open(p)); m=json.load(open('measurement.json'))
for k,v in c.items():
 v.update(concurrencyLimit=m[k]['concurrencyLimit'],queueSize=m[k]['queueSize'],capacitySource='measurement.json: '+m[k]['reason'])
json.dump(c,open(p,'w'),indent=2)
p='src/adapters/vendor.js'; s=open(p).read(); s=\"import { bulkhead } from 'cockatiel';\\n\"+s;s=s.replace('export function makeVendor', 'const limits = new Map(Object.entries(config).map(([name, settings]) =>\\n  [name, bulkhead(settings.concurrencyLimit, settings.queueSize)]));\\n\\nexport function makeVendor');s=s.replace('  return {','  const limit = limits.get(dependency);\\n  return {').replace(\"=> request(network,\", \"=> limit.execute(() => request(network,\").replace('timeout: settings.timeoutMs }),','timeout: settings.timeoutMs })),');open(p,'w').write(s)
p='tests/resilience.test.mjs';s=open(p).read().replace(\"    await vendor.lookup('released');\", \"    const released = vendor.lookup('released');\\n    await clock.tickAsync(1);\\n    await released;\");open(p,'w').write(s)
PY
cat > src/core/checkout.js <<'EOF'
export async function checkout(vendor, order) {
  try {
    const stock = await vendor.lookup(order.sku);
    if ("'!stock.available) return { status: '"'unavailable' };
    await vendor.charge(order);
    return { status: 'confirmed' };
  } catch (error) {
    // Adapter failures are translated to the page's declared unavailable state.
    if (error?.status >= 400 && error.status < 500 && error.status "'!== 429) throw error;
    return { status: '"'temporarily_unavailable', message: 'Payments are temporarily unavailable. Please try again later.' };
  }
}
EOF
python3 /tmp/remote-calls-runs/skill-md/bulkhead/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 tests/resilience.test.mjs (107.872263ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 1\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 117.808419\n"}]}

```

```bash
/bin/bash -lc "cat >> tests/resilience.test.mjs <<'EOF'

test('instances of one dependency share capacity; charge rejection uses page fallback', async () => {
  const clock = FakeTimers.install();
  try {
    const network = new Network([{ delay: 90 }, { delay: 90 }]);
    const first = makeVendor(network);
    const second = makeVendor(network);
    const pending = [first.lookup('a'), second.lookup('b')];
    const page = checkout({ lookup: async () => ({ available: true }), charge: second.charge }, { sku: 'c' });
    assert.deepEqual(await page, fallback);
    assert.equal(network.requests.length, 2);
    await clock.tickAsync(90);
    await Promise.all(pending);
  } finally { clock.uninstall(); }
});

test('checkout exposes timeout fallback and preserves normal checkout states', async () => {
  const clock = FakeTimers.install();
  try {
    const page = checkout(makeVendor(new Network([{ delay: 1000 }])), { sku: 'a' });
    await clock.tickAsync(100);
    assert.deepEqual(await page, fallback);
    assert.deepEqual(await checkout({ lookup: async () => ({ available: false }) }, {}), { status: 'unavailable' });
    assert.deepEqual(await checkout({ lookup: async () => ({ available: true }), charge: async () => {} }, {}), { status: 'confirmed' });
  } finally { clock.uninstall(); }
});
EOF
python3 /tmp/remote-calls-runs/skill-md/bulkhead/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'
python3 - <<'PY'
import json
p='RESULT.json';r=json.load(open(p));r['proceduresRun']=['P0','P1','P4'];json.dump(r,open(p,'w'),indent=2)
PY
cat > /tmp/remote-calls-runs/skill-md/bulkhead/AGENT_REPORT.md <<'EOF'
Applied the supplied remote-calls skill; procedures actually run: P0, P1, P4.

P0: ran "'`python3 /tmp/remote-calls-runs/skill-md/bulkhead/skill/scripts/scan_remote_calls.py companion.json .` before application edits. Scanner exited 1: three missing timeouts (weather and vendor lookup/charge), no domain violations or unsupported syntax. Actual findings are preserved in RESULT.json. Initial invocation with `python` failed because that executable is absent; reran with python3. Task evidence supports problems 1 and 4; this is an outbound HTTP adapter with no existing platform mechanism, so applicability passed. No retries or breaker procedure requested or run.

P1: scoped vendor lookup and charge for payment/catalog; unrelated weather remains unchanged. Both use native 100 ms timeout from measured p99.9 80 ms plus 20 ms padding. Config records the source. Fake-timer tests initially failed without timeouts, then passed after implementation; cancellation releases active network capacity at 100 ms.

P4: task explicitly documents shared-capacity starvation, so its evidence gate passed. Added separate Cockatiel bulkheads keyed by dependency, shared by instances of that dependency. Measurement permits two concurrent calls and zero queue entries. Config includes both values and reasons. Checkout translates provider unavailability into the specified page fallback. Saturation scenario timed out before bulkhead implementation (exit 124 under a 5-second test deadline); after implementation it verifies immediate fallback without another network call, independent 10 ms catalog success, shared same-dependency capacity, release/reuse, and lookup/charge fallback paths.

Ran the skill'"'s run_check.py after P1 and P4 with companion commands "'`node dependency-check.mjs` and `npm run check && node --test tests/*.test.mjs`; both exited 0, passed true. Final checks passed after additional regression coverage. No boundary, measurement, companion, supplied checker, or task changes.
EOF
git status --short'
```
Exit: 128
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 tests/resilience.test.mjs (130.691066ms)\n\u2139 tests 1\n\u2139 suites 0\n\u2139 pass 1\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 143.383796\n"}]}
fatal: not a git repository (or any of the parent directories): .git

```

Completed P0, P1, and P4. Added measured 100 ms timeouts, per-dependency Cockatiel limits of two calls with no queue, and the declared checkout fallback.

Dependency checks, syntax checks, and regression tests pass. Saved evidence in `RESULT.json` and the report in `../AGENT_REPORT.md`. Protected files remain unchanged.

