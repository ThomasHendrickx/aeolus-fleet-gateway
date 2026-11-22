#!/usr/bin/env python3
"""Prepare independent fresh-agent fixtures; check and collect their actual results.

python3 skills/remote-calls/evals/harness.py prepare /tmp/remote-calls-runs
python3 skills/remote-calls/evals/harness.py check /tmp/remote-calls-runs
python3 skills/remote-calls/evals/harness.py collect /tmp/remote-calls-runs OUTPUT

Run each prepared PROMPT.md through a fresh agent, from its run directory. No
agent report means not run. Gated procedures are not run when P0 stops, regardless
of behavior already present in the fixture. Scripts never turn missing runs into
passes. Baseline checks are available with `baseline` (they must be red).
"""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE=Path(__file__).resolve().parent
SKILL=HERE.parent
FORMS=('skill-md','aip')
RUNS={'local':['S0.1'],'scan':['S0.2','S0.3','S0.4'],'outbox':['S0.5'],'timeout':['S1.1','S1.2'],'retries':['S2.1','S2.2','S2.4'],'sdk':['S2.3'],'breaker':['S3.1','S3.2','S3.3','S3.4','S3.5','S3.6','S3.7'],'bulkhead':['S4.1']}
PROCEDURES={'local':['P0'],'scan':['P0'],'outbox':['P0'],'timeout':['P0','P1'],'retries':['P0','P1','P2'],'sdk':['P0','P1','P2'],'breaker':['P0','P1','P2','P3'],'bulkhead':['P0','P1','P4']}
PROMPT='''You work on the task in {repo}/TASK.md. Apply the skill in {skill}/SKILL.md to that task, using the repository companion {repo}/COMPANION.md and structured inputs {repo}/companion.json. Run commands from {repo}. The skill is the source of procedure decisions, including all gates and stops.

Do the work yourself in this fresh session. Read only the supplied repo and skill; do not inspect any other evaluation run or harness acceptance checks. The task states which procedures are requested. Run P0 first, including its script, and save its actual output/evidence in {repo}/RESULT.json as {{"missingTimeouts": [...], "violations": [...], "problems": [numbers], "applies": true_or_false, "proceduresRun": ["P0", ...]}}. Record only procedures you really ran; if a gate stops work, preserve that outcome. Do not force applicability to exercise a later procedure. If the supplied skill includes scripts, use them. For the source form the scanner is in its scripts folder; for the compiled form follow its graph and available scripts.

Complete the requested work and relevant tests. Write a short report to {run}/AGENT_REPORT.md describing the actual procedures run, gate decisions, commands/results, and changes. The public fixture API and external boundary are documented in COMPANION.md. Never modify the boundary, measurements, companion, supplied checker or task. Only application changes within the requested scope and your new tests are authorized.
'''

def prepare(work,only=()):
 work=Path(work).resolve()
 for form in FORMS:
  for name in RUNS:
   if only and name not in only: continue
   run=work/form/name
   if run.exists(): shutil.rmtree(run)
   repo=run/'repo'; shutil.copytree(HERE/'fixtures/shared',repo)
   shutil.copytree(HERE/'fixtures'/name,repo,dirs_exist_ok=True)
   shutil.copytree(repo,run/'base')
   # Dependencies are shared immutable third-party packages, never agent output.
   deps=Path(os.environ.get('REMOTE_CALLS_NODE_MODULES','/tmp/remote-calls-deps/node_modules'))
   if deps.exists(): (repo/'node_modules').symlink_to(deps,target_is_directory=True)
   skill=run/'skill'; skill.mkdir()
   source=SKILL if form=='skill-md' else SKILL/'aip'
   shutil.copy(source/'SKILL.md',skill/'SKILL.md')
   scripts=source/'scripts'
   if not scripts.exists(): scripts=SKILL/'aip/scripts'
   if scripts.exists(): shutil.copytree(scripts,skill/'scripts')
   if form=='aip' and (source/'source').exists(): shutil.copytree(source/'source',skill/'source')
   (run/'PROMPT.md').write_text(PROMPT.format(repo=repo,skill=skill,run=run))
 print(f'Prepared {work}')

def files(root):
 return {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file() and 'node_modules' not in p.parts and '__pycache__' not in p.parts}

def p0(repo):
 try: return json.loads((repo/'RESULT.json').read_text())
 except (OSError,ValueError): return {}

def changed(repo,base):
 a,b=files(repo),files(base)
 return sorted(k for k in a.keys()|b.keys() if a.get(k)!=b.get(k))

def path_present(items,expected):
 return any(expected in (json.dumps(v) if isinstance(v,dict) else str(v)) for v in items)

def gate_check(sid,repo,base):
 r=p0(repo); edits=changed(repo,base)
 app=[x for x in edits if x.startswith('src/')]
 if sid=='S0.1': return r.get('applies') is False and not app, f'applies={r.get("applies")}; application changes={app}'
 if sid=='S0.2': return path_present(r.get('missingTimeouts',[]),'src/adapters/vendor.js'), f'missingTimeouts={r.get("missingTimeouts")}'
 if sid=='S0.3': return path_present(r.get('violations',[]),'src/core/leak.js'), f'violations={r.get("violations")}'
 if sid=='S0.4': return 3 in r.get('problems',[]), f'problems={r.get("problems")}'
 if sid=='S0.5': return r.get('applies') is False and not app, f'applies={r.get("applies")}; application changes={app}'
 raise ValueError(sid)

def check_one(sid,repo,base):
 if sid.startswith('S0.'): return gate_check(sid,repo,base)
 if sid=='S1.2':
  same=(repo/'src/adapters/untouched.js').read_bytes()==(base/'src/adapters/untouched.js').read_bytes()
  touched=(repo/'src/adapters/vendor.js').read_bytes()!=(base/'src/adapters/vendor.js').read_bytes()
  return same and touched,f'touched adapter changed={touched}; weather adapter unchanged={same}'
 done=subprocess.run(['node',str(HERE/'check.mjs'),sid,str(repo)],cwd=repo,capture_output=True,text=True,timeout=30)
 return done.returncode==0,(done.stdout+done.stderr).strip()[-2000:]

def check(work,only=()):
 work=Path(work).resolve();results={}
 for form in FORMS:
  for name,scenarios in RUNS.items():
   run=work/form/name;repo=run/'repo';base=run/'base';r=p0(repo)
   for sid in scenarios:
    if only and sid not in only: continue
    if not (run/'AGENT_REPORT.md').exists(): verdict,note='not run','no fresh-agent report'
    elif sid=='S2.3' and 'P0' not in r.get('proceduresRun',[]):
     verdict,note='not run','P0 did not run'
    elif sid!='S2.3' and not sid.startswith('S0.') and (r.get('applies') is not True or 'P'+sid[1] not in r.get('proceduresRun',[])):
     verdict,note='not run',f'P{sid[1]} did not run; actual P0 applies={r.get("applies")}, procedures={r.get("proceduresRun")}'
    else:
     try: ok,note=check_one(sid,repo,base)
     except Exception as error: ok,note=False,f'{type(error).__name__}: {error}'
     if sid=='S2.3':
      stopped=r.get('applies') is False and r.get('proceduresRun')==['P0']
      ok=ok and stopped
      note=f'P0 stopped={stopped}; procedures={r.get("proceduresRun")}; '+note
     verdict='pass' if ok else 'fail'
     if sid in {'S0.4','S0.5','S2.3','S3.5'}:
      judge_path=work/form/'JUDGE.json'
      judge=json.loads(judge_path.read_text()).get(sid) if judge_path.exists() else None
      if not judge: verdict,note='not run','fresh agent ran; independent judgement missing; preliminary: '+note
      else:
       judged=judge.get('result',judge.get('verdict','not run')).lower()
       verdict=judged if judged in {'pass','fail','not run'} else 'not run'
       if not ok and verdict=='pass': verdict='fail'
       note='independent judge: '+judge.get('evidence',judge.get('why',''))+'; observable check: '+note
    results[f'{sid}|{form}']={'result':verdict,'evidence':note}
 print('| Scenario | SKILL.md | AIP |\n| --- | --- | --- |')
 for scenarios in RUNS.values():
  for sid in scenarios:
   if not only or sid in only: print(f'| {sid} | {results[sid+"|skill-md"]["result"]} | {results[sid+"|aip"]["result"]} |')
 (work/'results.json').write_text(json.dumps(results,indent=2)+'\n')
 return results

def collect(work,out):
 work,out=Path(work),Path(out);out.mkdir(parents=True,exist_ok=True)
 for form in FORMS:
  judge=work/form/'JUDGE.json'
  if judge.exists(): shutil.copy(judge,out/f'{form}-JUDGE.json')
  for name in RUNS:
   run=work/form/name
   for file in ['PROMPT.md','AGENT_REPORT.md','FINAL_REPORT.md','execution.json','transcript.jsonl']:
    if (run/file).exists(): shutil.copy(run/file,out/f'{form}-{name}-{file}')
   if (run/'repo'/'RESULT.json').exists(): shutil.copy(run/'repo'/'RESULT.json',out/f'{form}-{name}-RESULT.json')
   if (run/'repo').exists():
    diff=subprocess.run(['diff','-ruN','--exclude=node_modules','--exclude=__pycache__','base','repo'],cwd=run,capture_output=True,text=True)
    (out/f'{form}-{name}.diff').write_text(diff.stdout)
 if (work/'results.json').exists(): shutil.copy(work/'results.json',out/'results.json')


def baseline():
 """Prove behavioral checks detect missing resilience, with genuine negative controls.

 This is harness validation, never a substitute for a fresh-agent scenario run.
 """
 expected_green={'S2.2','S3.3'}
 positive=['S1.1','S1.2','S2.1','S2.2','S2.3','S2.4','S3.1','S3.2','S3.3','S3.4','S3.5','S3.6','S3.7','S4.1']
 failures=[]
 with tempfile.TemporaryDirectory(prefix='remote-calls-baseline-') as temp:
  root=Path(temp)
  for sid in positive:
   name=next(n for n,scenarios in RUNS.items() if sid in scenarios)
   run=root/sid;repo=run/'repo';base=run/'base'
   shutil.copytree(HERE/'fixtures/shared',repo)
   shutil.copytree(HERE/'fixtures'/name,repo,dirs_exist_ok=True)
   shutil.copytree(repo,base)
   deps=Path(os.environ.get('REMOTE_CALLS_NODE_MODULES','/tmp/remote-calls-deps/node_modules')).resolve()
   if not deps.exists(): sys.exit('Install fixture dependencies and set REMOTE_CALLS_NODE_MODULES to node_modules')
   (repo/'node_modules').symlink_to(deps,target_is_directory=True)
   ok,note=check_one(sid,repo,base)
   expected=sid in expected_green
   infrastructure=not ok and sid!='S1.2' and 'AssertionError' not in note
   if ok!=expected or infrastructure: failures.append((sid,note))
   print(f'{sid}: {"green negative control" if expected else "red missing behavior"}: {"OK" if ok==expected and not infrastructure else "UNEXPECTED"}')
   if ok!=expected or infrastructure: print(note)
 if failures: sys.exit(1)
 print('Baseline checked: all missing positive behavior is red; safe-create and client-error negative controls are green. No fresh-agent scenario results claimed.')

if __name__=='__main__':
 args=sys.argv[1:]
 if args==['baseline']: baseline()
 elif len(args)>=2 and args[0]=='prepare': prepare(args[1],args[2:])
 elif len(args)>=2 and args[0]=='check': check(args[1],args[2:])
 elif len(args)==3 and args[0]=='collect': collect(args[1],args[2])
 else: sys.exit(__doc__)
