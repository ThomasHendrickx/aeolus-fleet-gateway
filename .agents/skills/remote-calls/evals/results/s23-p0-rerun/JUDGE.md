# Independent S2.3 judgment

Both forms: **pass** for the Thomas-approved scenario, SDK already retries -> P0 stops and configures existing ownership -> total attempts equal SDK, no second layer.

Read only the two supplied runs: skills (including AIP source/provenance), prompts, tasks, companion/measurement inputs, RESULT.json, actual AGENT_REPORT.md, baseline source and recursive repository diffs. No other run or harness was inspected. No application/skill files were edited; no fleet or Git command ran.

## Actual commands and observations

`diff -ru /tmp/remote-calls-s23-rerun/skill-md/sdk/base /tmp/remote-calls-s23-rerun/skill-md/sdk/repo` (exit 1): only RESULT.json, node_modules, tests and vendor.js removal of Cockatiel outer retry. Existing SDK and external boundary unchanged.

`diff -ru /tmp/remote-calls-s23-rerun/aip/sdk/base /tmp/remote-calls-s23-rerun/aip/sdk/repo` (exit 1): same, plus config.json describing SDK ownership/maxAttempts=3/adapterRetries=0. That JSON is documentation, not an additional runtime retry policy.

Independent Node command (exit 0):

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
for (const form of ['skill-md','aip']) {
 const root=`/tmp/remote-calls-s23-rerun/${form}/sdk/repo`;
 const {makeVendor}=await import(`${root}/src/adapters/vendor.js`);
 const {makeSDK}=await import(`${root}/src/infra/sdk.js`);
 const {Network}=await import(`${root}/src/infra/network.js`);
 const evidence={form};
 for(const [name,steps] of [['exhausted',Array.from({length:10},()=>({status:503}))],['thirdSuccess',[{status:503},{status:503},{status:200,value:{ok:true}}]]]) {
  const counts=[];
  for(const make of [makeSDK,makeVendor]) {
   const network=new Network(steps);
   let outcome; try {outcome=await make(network).lookup('judge');} catch(e) {outcome=e.message;}
   counts.push({attempts:network.requests.length,outcome});
  }
  assert.equal(counts[0].attempts,3);assert.deepEqual(counts[1],counts[0]);evidence[name]={sdk:counts[0],adapter:counts[1]};
 }
 const network=new Network(Array.from({length:10},()=>({status:503})));
 await assert.rejects(makeVendor(network).charge({id:'judge'})); assert.equal(network.requests.length,1);
 evidence.chargeAttempts=network.requests.length;
 console.log(JSON.stringify(evidence));
}
JS
```

Actual stdout:
```json
{"form":"skill-md","exhausted":{"sdk":{"attempts":3,"outcome":"HTTP 503"},"adapter":{"attempts":3,"outcome":"HTTP 503"}},"thirdSuccess":{"sdk":{"attempts":3,"outcome":{"ok":true}},"adapter":{"attempts":3,"outcome":{"ok":true}}},"chargeAttempts":1}
{"form":"aip","exhausted":{"sdk":{"attempts":3,"outcome":"HTTP 503"},"adapter":{"attempts":3,"outcome":"HTTP 503"}},"thirdSuccess":{"sdk":{"attempts":3,"outcome":{"ok":true}},"adapter":{"attempts":3,"outcome":{"ok":true}}},"chargeAttempts":1}
```

For each FORM in skill-md and aip, independently executed:

```sh
python3 /tmp/remote-calls-s23-rerun/FORM/sdk/skill/scripts/scan_remote_calls.py /tmp/remote-calls-s23-rerun/FORM/sdk/repo/companion.json /tmp/remote-calls-s23-rerun/FORM/sdk/repo
```

Both exit 1, stdout (FORM expanded to respective form):
```json
{"violations":[],"missingTimeouts":[{"path":"/tmp/remote-calls-s23-rerun/FORM/sdk/repo/src/adapters/untouched.js","line":2,"module":"../infra/network.js","timeoutOption":"timeout"}],"unsupported":[],"clean":false}
```

## Rationale per form

**skill-md: pass.** P0's SDK mechanism stop applies. RESULT.json records applies=false and proceduresRun=[P0], matching the actual report's stated scan and gate. Reproduced scanner findings independently; observed removal of outer retry and exact SDK attempt budget at runtime. Problems=[5] correctly identifies task-scoped retry multiplication; unrelated scanner finding remains recorded and untouched. No P1 timeout change or P2 retry implementation is present.

**aip: pass.** Same observed behavior and gate evidence, with matching persisted p0-scan.json and problems=[1,5]. The existing SDK mechanism stays sole owner; added config describes its existing budget. No later procedure implementation is present.

Procedure-history limitation: static artifacts and a fresh scanner reproduction cannot independently establish the exact chronological command history or prove that an agent never mentally entered a later procedure. The available evidence supports P0 having run and stopped: actual report, structured P0 findings matching independently observed output, applies=false, P0-only procedure record, and complete diffs restricted to the stop-authorized fix and its regression tests. Verdicts do not rely on worker behavioral claims: the crucial three-attempt bound and absence of a second retry mechanism were independently observed.
