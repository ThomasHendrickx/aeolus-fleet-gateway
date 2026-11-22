# Observable transcript: skill-md-sdk

I’ll read the task, skill, and companion files, then run P0 and record its output before applying the remaining procedure gates.

```bash
/bin/bash -lc "pwd && rg --files -g 'AGENTS.md' -g 'TASK.md' -g 'COMPANION.md' -g 'companion.json' && cat TASK.md COMPANION.md companion.json /tmp/remote-calls-runs/skill-md/sdk/skill/SKILL.md"
```
Exit: 0
```text
/tmp/remote-calls-runs/skill-md/sdk/repo
TASK.md
companion.json
COMPANION.md
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
/bin/bash -lc 'rg --files /tmp/remote-calls-runs/skill-md/sdk/skill .'
```
Exit: 0
```text
./TASK.md
./package.json
./package-lock.json
./src/config.json
./src/infra/sdk.js
./src/infra/telemetry.js
./src/infra/network.js
/tmp/remote-calls-runs/skill-md/sdk/skill/SKILL.md
./src/adapters/untouched.js
./src/adapters/vendor.js
./src/core/checkout.js
./measurement.json
./companion.json
./dependency-check.mjs
./COMPANION.md
/tmp/remote-calls-runs/skill-md/sdk/skill/scripts/run_check.py
/tmp/remote-calls-runs/skill-md/sdk/skill/scripts/scan_javascript.cjs
/tmp/remote-calls-runs/skill-md/sdk/skill/scripts/scan_remote_calls.py
/tmp/remote-calls-runs/skill-md/sdk/skill/scripts/__pycache__/scan_remote_calls.cpython-312.pyc

```

```bash
/bin/bash -lc 'cat /tmp/remote-calls-runs/skill-md/sdk/skill/scripts/scan_remote_calls.py /tmp/remote-calls-runs/skill-md/sdk/skill/scripts/run_check.py src/adapters/vendor.js src/infra/sdk.js src/config.json measurement.json package.json src/adapters/untouched.js src/infra/network.js'
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
import { retry, handleAll } from 'cockatiel';
import { makeSDK } from '../infra/sdk.js';
export function makeVendor(network, {dependency='payment'}={}) {
 const sdk=makeSDK(network); const outer=retry(handleAll,{maxAttempts:1});
 return {lookup:sku=>outer.execute(()=>sdk.lookup(sku)),charge:order=>sdk.charge(order)};
}
import { retry, handleAll } from 'cockatiel';
import { request } from './network.js';
// Existing real retry implementation at the SDK boundary: three total attempts.
export function makeSDK(network) {
 const policy=retry(handleAll, {maxAttempts:2});
 return {lookup: sku => policy.execute(()=>request(network,{operation:'lookup',payload:{sku},timeout:100})),
 charge: order => request(network,{operation:'charge',payload:order,timeout:100})};
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
import { request } from '../infra/network.js';
export const readWeather = (network) => request(network, {operation: 'weather'});
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
/bin/bash -lc 'python /tmp/remote-calls-runs/skill-md/sdk/skill/scripts/scan_remote_calls.py companion.json .'
```
Exit: 127
```text
/bin/bash: line 1: python: command not found

```

```bash
/bin/bash -lc 'python3 /tmp/remote-calls-runs/skill-md/sdk/skill/scripts/scan_remote_calls.py companion.json .'
```
Exit: 1
```text
{
  "violations": [],
  "missingTimeouts": [
    {
      "path": "/tmp/remote-calls-runs/skill-md/sdk/repo/src/adapters/untouched.js",
      "line": 2,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    }
  ],
  "unsupported": [],
  "clean": false
}

```

P0 found problem 5: the adapter retries a call that the SDK already retries up to three times. The skill’s existing-mechanism gate stops P1 and P2 and directs me to configure that layer. I’ll disable the adapter’s extra retry and test the SDK attempt budget. The scanner also found a missing timeout in the untouched weather adapter, which is outside this task’s scope.

```bash
/bin/bash -lc "mkdir -p tests
cat > RESULT.json <<'EOF'
{
  \"missingTimeouts\": [
    {
      \"path\": \"/tmp/remote-calls-runs/skill-md/sdk/repo/src/adapters/untouched.js\",
      \"line\": 2,
      \"module\": \"../infra/network.js\",
      \"timeoutOption\": \"timeout\"
    }
  ],
  \"violations\": [],
  \"problems\": [5],
  \"applies\": false,
  \"proceduresRun\": [\"P0\"]
}
EOF
cat > src/config.json <<'EOF'
{
  \"payment\": {
    \"adapterRetryAttempts\": 0,
    \"source\": \"TASK.md and src/infra/sdk.js\",
    \"reason\": \"The SDK owns the three-total-attempt budget. Zero adapter retries prevents multiplying it to six requests.\"
  }
}
EOF
cat > tests/vendor.test.mjs <<'EOF'
import test from 'node:test';
import assert from 'node:assert/strict';
import FakeTimers from '@sinonjs/fake-timers';
import { makeVendor } from '../src/adapters/vendor.js';
import { Network } from '../src/infra/network.js';

test('persistent lookup failure stays within the SDK three-attempt budget', async () => {
  const clock = FakeTimers.install();
  try {
    const network = new Network(Array.from({length: 6}, () => ({status: 503})));
    const result = assert.rejects(makeVendor(network).lookup('sku'), {status: 503});
    await clock.runAllAsync();
    await result;
    assert.equal(network.requests.length, 3);
  } finally { clock.uninstall(); }
});

test('SDK still recovers from transient lookup failure', async () => {
  const clock = FakeTimers.install();
  try {
    const network = new Network([{status: 503}, {status: 200, value: {available: true}}]);
    const result = makeVendor(network).lookup('sku');
    await clock.runAllAsync();
    assert.deepEqual(await result, {available: true});
    assert.equal(network.requests.length, 2);
  } finally { clock.uninstall(); }
});

test('charge remains a single attempt', async () => {
  const clock = FakeTimers.install();
  try {
    const network = new Network([{status: 503}]);
    const result = assert.rejects(makeVendor(network).charge({id: 'order'}), {status: 503});
    await clock.runAllAsync();
    await result;
    assert.equal(network.requests.length, 1);
  } finally { clock.uninstall(); }
});
EOF
node --test tests/*.test.mjs"
```
Exit: 1
```text
✖ persistent lookup failure stays within the SDK three-attempt budget (10.653997ms)
✔ SDK still recovers from transient lookup failure (3.868225ms)
ℹ tests 2
ℹ suites 0
ℹ pass 1
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 113.310452

✖ failing tests:

test at tests/vendor.test.mjs:7:1
✖ persistent lookup failure stays within the SDK three-attempt budget (10.653997ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  6 !== 3
  
      at TestContext.<anonymous> (file:///tmp/remote-calls-runs/skill-md/sdk/repo/tests/vendor.test.mjs:14:12)
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
/bin/bash -lc "node --version
cat > src/adapters/vendor.js <<'EOF'
import { retry, handleAll } from 'cockatiel';
import { makeSDK } from '../infra/sdk.js';
import config from '../config.json' with { type: 'json' };

export function makeVendor(network, {dependency='payment'}={}) {
 const sdk = makeSDK(network);
 // The SDK owns retries; an adapter must not multiply its attempt budget.
 const outer = retry(handleAll, {maxAttempts: config[dependency]?.adapterRetryAttempts ?? 0});
 return {lookup:sku=>outer.execute(()=>sdk.lookup(sku)),charge:order=>sdk.charge(order)};
}
EOF
python3 /tmp/remote-calls-runs/skill-md/sdk/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
v26.12.0
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 persistent lookup failure stays within the SDK three-attempt budget (8.144546ms)\n\u2714 SDK still recovers from transient lookup failure (2.506875ms)\n\u2139 tests 2\n\u2139 suites 0\n\u2139 pass 2\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 109.881574\n"}]}

```

```bash
/bin/bash -lc "python3 - <<'PY'
from pathlib import Path
p=Path('tests/vendor.test.mjs')
p.write_text(p.read_text().replace('FakeTimers.install()', \"FakeTimers.install({toFake: ['setTimeout', 'clearTimeout', 'Date']})\"))
PY
python3 /tmp/remote-calls-runs/skill-md/sdk/skill/scripts/run_check.py 'node dependency-check.mjs' 'npm run check && node --test tests/*.test.mjs'"
```
Exit: 0
```text
{"passed": true, "results": [{"command": "node dependency-check.mjs", "exit": 0, "output": ""}, {"command": "npm run check && node --test tests/*.test.mjs", "exit": 0, "output": "\n> check\n> node --check src/adapters/vendor.js && node --check src/core/checkout.js\n\n\u2714 persistent lookup failure stays within the SDK three-attempt budget (6.772503ms)\n\u2714 SDK still recovers from transient lookup failure (1.958913ms)\n\u2714 charge remains a single attempt (1.046848ms)\n\u2139 tests 3\n\u2139 suites 0\n\u2139 pass 3\n\u2139 fail 0\n\u2139 cancelled 0\n\u2139 skipped 0\n\u2139 todo 0\n\u2139 duration_ms 116.550565\n"}]}

```

```bash
/bin/bash -lc "cat > /tmp/remote-calls-runs/skill-md/sdk/AGENT_REPORT.md <<'EOF'
# Actual outcome

Ran P0 only. Read TASK.md, COMPANION.md, companion.json, measurement.json and the supplied skill and scripts. P0 identified task problem 5: SDK and adapter retries multiply three SDK attempts into six outbound requests. Its existing-platform-mechanism gate applies: configure that mechanism and stop; P1 and P2 were not run. RESULT.json records applies=false and proceduresRun=[\"P0\"].

Commands and evidence:
- Initial "'`python` invocation was unavailable (exit 127); used `python3`.
- `python3 /tmp/remote-calls-runs/skill-md/sdk/skill/scripts/scan_remote_calls.py companion.json .` exited 1: missing timeout in src/adapters/untouched.js line 2; violations=[]; unsupported=[]; clean=false. Actual missingTimeouts and violations are preserved in RESULT.json. Weather is outside the requested payment retry scope.
- Regression test before the adapter change failed with six requests versus the expected three.
- Ran supplied run_check.py with `node dependency-check.mjs` and `npm run check && node --test tests/*.test.mjs`. Final result passed=true, both commands exit 0, all three tests pass. Fake timers are restricted to timeout and Date APIs so Node test scheduling remains operational.

Changes: payment adapter retries configured to zero in src/config.json, with source and reason; vendor adapter consumes the setting and defaults other dependencies to zero extra retries. SDK remains the retry owner with three total lookup attempts. Added deterministic tests for persistent failure (three attempts), transient recovery (two attempts), and non-idempotent charge (one attempt). No boundary, measurement, companion, checker, or task changes. No breaker, bulkhead, fallback, or timeout work was performed after the P0 stop.
EOF
git status --short'
```
Exit: 128
```text
fatal: not a git repository (or any of the parent directories): .git

```

Disabled extra adapter retries; lookup now stays within the SDK’s three-attempt budget. All three tests and dependency/syntax checks pass.

P0’s existing-mechanism gate stopped P1/P2. Evidence is saved in [RESULT.json](/tmp/remote-calls-runs/skill-md/sdk/repo/RESULT.json), with details in [AGENT_REPORT.md](/tmp/remote-calls-runs/skill-md/sdk/AGENT_REPORT.md).

