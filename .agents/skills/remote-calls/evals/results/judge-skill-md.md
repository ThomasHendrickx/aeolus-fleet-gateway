# Source-form actual judgement

S0.4 **pass**: actual scan RESULT.json includes problem 3 in `[1, 3]`; P0 execution and result-writing command appear in events.jsonl. Task contains the approved outage/spread premise. Application unchanged.

S0.5 **pass**: actual outbox RESULT.json records `applies:false`, `proceduresRun:["P0"]`. Events show scanner execution and gate result. `diff -ru base repo` reports only RESULT.json and node_modules additions: no application or breaker added. Later procedures were gated off, but the approved scenario tests P0 stopping itself, which ran.

S3.5 **pass**: independently executed `node --input-type=module` in breaker/repo with fixture-installed `@sinonjs/fake-timers` (Date/setTimeout/clearTimeout). Imported Network, makeVendor, checkout, and telemetry logs; supplied four scripted 503s to unkeyed charges, advancing 1ms per charge, asserting each dependency-unavailable result and the Open transition. Called checkout immediately and advanced 0ms. Asserted exact COMPANION.md fallback and unchanged outbound count. Actual stdout:

```json
{"state":"Open","result":{"status":"temporarily_unavailable","message":"Payments are temporarily unavailable. Please try again later."},"outboundBefore":4,"outboundAfter":4,"fakeTime":4}
```

Read each run's TASK.md, skill/SKILL.md, RESULT.json, AGENT_REPORT.md and event command records, plus base/repo diffs. Breaker diff implements dependency-unavailable conversion in adapter and fallback in checkout; independent execution establishes observed behavior beyond the report. No application files edited and no other forms or harness expected outputs inspected.
