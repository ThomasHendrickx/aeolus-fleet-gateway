# Observable transcript: skill-md-local

I’ll read the task, skill, and companion files, then run P0 and follow the skill’s gates before making changes.


```bash
/bin/bash -lc "pwd && rg --files -g 'AGENTS.md' -g 'TASK.md' -g 'COMPANION.md' -g 'companion.json' -g 'SKILL.md' . /tmp/remote-calls-runs/skill-md/local/skill"
```
Exit: 0
```text
/tmp/remote-calls-runs/skill-md/local/repo
./TASK.md
./companion.json
./COMPANION.md
/tmp/remote-calls-runs/skill-md/local/skill/SKILL.md

```

```bash
/bin/bash -lc 'cat TASK.md COMPANION.md companion.json /tmp/remote-calls-runs/skill-md/local/skill/SKILL.md'
```
Exit: 0
```text
Change request: investigate whether reading the in-memory config cache needs reliability work. It reads an object already in the same process and makes no network request. Run the applicability gate only; report the result.
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
/bin/bash -lc 'rg --files /tmp/remote-calls-runs/skill-md/local/skill .'
```
Exit: 0
```text
./TASK.md
./package.json
./dependency-check.mjs
./COMPANION.md
./companion.json
/tmp/remote-calls-runs/skill-md/local/skill/SKILL.md
./measurement.json
./src/config.json
./src/infra/telemetry.js
./src/infra/network.js
./src/adapters/untouched.js
./src/adapters/vendor.js
/tmp/remote-calls-runs/skill-md/local/skill/scripts/scan_remote_calls.py
/tmp/remote-calls-runs/skill-md/local/skill/scripts/scan_javascript.cjs
/tmp/remote-calls-runs/skill-md/local/skill/scripts/run_check.py
./src/core/cache.js
./src/core/checkout.js
/tmp/remote-calls-runs/skill-md/local/skill/scripts/__pycache__/scan_remote_calls.cpython-312.pyc

```

```bash
/bin/bash -lc 'cat /tmp/remote-calls-runs/skill-md/local/skill/scripts/scan_remote_calls.py /tmp/remote-calls-runs/skill-md/local/skill/scripts/scan_javascript.cjs src/core/cache.js package.json'
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
// AST-backed ESM scan. Requires acorn in the fixture/repository dependencies.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const filename = process.argv[2];
const config = JSON.parse(process.argv[3]);
const result = {violations: [], missingTimeouts: [], unsupported: []};
const unsupported = (node, reason) => result.unsupported.push({path: filename, line: node?.loc?.start.line, reason});
try {
  const requireRepo = createRequire(path.resolve(filename));
  const acorn = requireRepo('acorn');
  const tree = acorn.parse(fs.readFileSync(filename, 'utf8'), {ecmaVersion:'latest', sourceType:'module', locations:true});
  const aliases = new Map();
  function walk(node, fn) {
    if (!node || typeof node !== 'object') return;
    if (node.type) fn(node);
    for (const [key,value] of Object.entries(node)) {
      if (key === 'loc') continue;
      if (Array.isArray(value)) value.forEach(v => walk(v,fn));
      else if (value && typeof value === 'object') walk(value,fn);
    }
  }
  walk(tree, node => {
    if(node.type === 'ImportDeclaration') {
      const module = node.source.value;
      for(const spec of node.specifiers) aliases.set(spec.local.name, module);
      if(config.domain && module === config.library) result.violations.push({path:filename,line:node.loc.start.line,module});
    }
  });
  const moduleFor = node => node?.type === 'Identifier' ? aliases.get(node.name) : node?.type === 'MemberExpression' ? moduleFor(node.object) : undefined;
  walk(tree, node => {
    if(node.type === 'ImportExpression' || (node.type === 'CallExpression' && node.callee.name === 'require')) unsupported(node,'dynamic/CommonJS imports require module resolution');
    if(node.type === 'VariableDeclarator' && moduleFor(node.init)) unsupported(node,'assigned client alias requires flow analysis');
    if(node.type === 'VariableDeclarator' && node.init?.type === 'NewExpression' && moduleFor(node.init.callee)) unsupported(node,'client instance requires flow/type analysis');
    if(node.type === 'CallExpression') {
      const module = moduleFor(node.callee);
      const client = config.clients.find(c => c.module === module);
      if(!client) return;
      const options = node.arguments.filter(n => n.type === 'ObjectExpression');
      if(!options.length && node.arguments.some(n => n.type === 'SpreadElement' || n.type === 'Identifier')) unsupported(node,'nonliteral options may contain timeout; inspect manually');
      else if(options.some(n => n.properties.some(p => p.type === 'SpreadElement' || p.computed))) unsupported(node,'spread/computed options require runtime resolution');
      else if(!options.some(n => n.properties.some(p => (p.key.name || p.key.value) === client.timeoutOption))) result.missingTimeouts.push({path:filename,line:node.loc.start.line,module,timeoutOption:client.timeoutOption});
    }
  });
} catch(error) { unsupported(null, String(error)); }
console.log(JSON.stringify(result));
export const configCache = {currency: "EUR"};
export const readCurrency = () => configCache.currency;
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

```

```bash
/bin/bash -lc 'python3 /tmp/remote-calls-runs/skill-md/local/skill/scripts/scan_remote_calls.py companion.json .'
```
Exit: 1
```text
{
  "violations": [],
  "missingTimeouts": [
    {
      "path": "/tmp/remote-calls-runs/skill-md/local/repo/src/adapters/untouched.js",
      "line": 2,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/skill-md/local/repo/src/adapters/vendor.js",
      "line": 4,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    },
    {
      "path": "/tmp/remote-calls-runs/skill-md/local/repo/src/adapters/vendor.js",
      "line": 5,
      "module": "../infra/network.js",
      "timeoutOption": "timeout"
    }
  ],
  "unsupported": [],
  "clean": false
}

```

P0 found three missing timeouts in the remote adapters and no domain import violations. The requested cache read accesses an in-process object, so the skill’s local-resource gate stops work with `applies: false`. I’ll save that outcome without changing application code.


```bash
/bin/bash -lc "python3 - <<'PY'
import json
from pathlib import Path
root = Path.cwd()
result = {
    'missingTimeouts': [
        {'path': str(root / 'src/adapters/untouched.js'), 'line': 2, 'module': '../infra/network.js', 'timeoutOption': 'timeout'},
        {'path': str(root / 'src/adapters/vendor.js'), 'line': 4, 'module': '../infra/network.js', 'timeoutOption': 'timeout'},
        {'path': str(root / 'src/adapters/vendor.js'), 'line': 5, 'module': '../infra/network.js', 'timeoutOption': 'timeout'},
    ],
    'violations': [],
    'problems': [],
    'applies': False,
    'proceduresRun': ['P0'],
}
(root / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\\n')
Path('/tmp/remote-calls-runs/skill-md/local/AGENT_REPORT.md').write_text('''# Applicability report

Applied "'`/tmp/remote-calls-runs/skill-md/local/skill/SKILL.md` using the supplied task, companion documentation, and structured inputs. Ran P0 only, as requested.

Command (from `/tmp/remote-calls-runs/skill-md/local/repo`):

```sh
python3 /tmp/remote-calls-runs/skill-md/local/skill/scripts/scan_remote_calls.py companion.json .
```

The scanner exited 1 and reported three missing timeouts: `src/adapters/untouched.js:2` and `src/adapters/vendor.js:4` and `:5`. It reported no domain import violations, no unsupported constructs, and `clean: false`. Actual finding entries are preserved in `RESULT.json`.

The task concerns `src/core/cache.js`: `readCurrency` directly reads `configCache.currency` in the same process. No problems 1–5 apply to this task. P0 step 3 stops for a local resource; applicability is false. The unrelated adapter findings do not expand the requested scope. P1–P4 were not run.

Changes: created `RESULT.json` and this report only. No application, boundary, companion, measurement, task, or checker changes. No tests were added or run because this request is applicability-only and the gate stopped implementation.
'"''')
assert json.loads((root / 'RESULT.json').read_text()) == result
print('RESULT.json saved and validated; AGENT_REPORT.md saved.')
PY"
```
Exit: 0
```text
RESULT.json saved and validated; AGENT_REPORT.md saved.

```

Ran P0 and its scanner. Applicability is **false**: the cache is in-process, so the gate stopped further work.

Recorded three unrelated missing timeouts and no violations. No application changes or tests were needed.

Saved [RESULT.json](/tmp/remote-calls-runs/skill-md/local/repo/RESULT.json) and [AGENT_REPORT.md](/tmp/remote-calls-runs/skill-md/local/AGENT_REPORT.md).

