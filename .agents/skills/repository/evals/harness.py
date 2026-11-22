#!/usr/bin/env python3
"""Run the repository scenarios against both forms of the skill (same shape as ports-and-adapters/evals/harness.py).

  harness.py prepare WORK [RUN ...]  build WORK/<form>/<run>/{repo,base,skill,PROMPT.md} for each run
  harness.py check WORK              run the executable checks on the finished repos, print the table
  harness.py collect WORK OUT        copy each run's prompt, agent report and repo diff into OUT

An agent works each run directory (see PROMPT.md); `check` then runs the script scenarios as
executable checks, prints the evidence for the agent-kind scenarios (S1.3, S1.4, S2.1), reads their
verdicts from WORK/<form>/JUDGE.json and reports PASS, FAIL or NOT RUN per scenario and form.
A run without an agent report is NOT RUN, never PASS.
"""
import ast
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
SKILL = HERE.parent
FIXTURES = HERE / "fixtures"
SCAN = SKILL / "aip" / "scripts" / "scan_port_types.py"
FORMS = {"skill-md": ["SKILL.md"], "aip": ["aip"]}

# run id -> (fixture, procedure instruction, scenarios)
RUNS = {
    "single-table": ("single-table", "P0 only", ["S0.1"]),
    "orm-leak": ("orm-leak", "P0 only", ["S0.2"]),
    "order": ("order", "P0, then P1", ["S1.1", "S1.2", "S1.3", "S1.4"]),
    "dashboard": ("dashboard", "P0, then P2", ["S2.1"]),
    "reminder": ("reminder", "P0, then P2", ["S2.2"]),
    "generic-repository": ("generic-repository", "P0, then P3", ["S3.1"]),
}
SCENARIOS = ["S0.1", "S0.2", "S1.1", "S1.2", "S1.3", "S1.4", "S2.1", "S2.2", "S3.1"]
JUDGED = {
    "S1.3": "Then the real adapter's list method pages in the query (LIMIT/OFFSET or equivalent in the SQL), not after reading rows.",
    "S1.4": "Then no repository method commits or opens a transaction.",
    "S2.1": "Given a task for a per-customer totals dashboard, when P2 runs, then no finder is added to the repository and the work is routed to a read model.",
}
PROMPT = """You work in the repository at {repo}. Apply the skill in {skill} (read its SKILL.md first and follow its procedures) to the task in {repo}/TASK.md. The repo companion is {repo}/COMPANION.md; run commands from {repo}.

Run {procs}. Before anything else, run P0 and write its result to {repo}/RESULT.json as {{"violations": [paths], "problems": [numbers], "applies": bool}}.
If the skill has script steps, run them (scripts are under the skill folder; read a script's header for usage). Do the steps yourself; do not look outside {repo} and {skill}.
{extra}
Finish with a short report (the steps you ran, what you changed, anything you could not do) and also write it to {run}/AGENT_REPORT.md.
"""
EXTRA = {
    "P0 only": "Stop after P0: write no code and add no files except RESULT.json.",
    "P0, then P1": "If P0 says applies is false, stop after P0.",
    "P0, then P2": "If P0 says applies is false, stop after P0.",
    "P0, then P3": "If P0 says applies is false, stop after P0.",
}


def sh(command, cwd):
    done = subprocess.run(command, shell=True, cwd=cwd, capture_output=True, text=True)
    return done.returncode, (done.stdout + done.stderr).strip()


def prepare(work, only=()):
    work = Path(work).resolve()
    for form, parts in FORMS.items():
        for run, (fixture, procs, _) in RUNS.items():
            if only and run not in only:
                continue
            run_dir = work / form / run
            if run_dir.exists():
                shutil.rmtree(run_dir)
            shutil.copytree(FIXTURES / fixture, run_dir / "repo")
            shutil.copytree(run_dir / "repo", run_dir / "base")
            (run_dir / "skill").mkdir()
            for part in parts:
                src = SKILL / part
                if src.is_dir():
                    shutil.copytree(src / "scripts", run_dir / "skill" / "scripts")
                    shutil.copy(src / "SKILL.md", run_dir / "skill" / "SKILL.md")
                else:
                    shutil.copy(src, run_dir / "skill" / "SKILL.md")
            (run_dir / "PROMPT.md").write_text(PROMPT.format(
                repo=run_dir / "repo", skill=run_dir / "skill", run=run_dir, procs=procs, extra=EXTRA[procs]))
    print(f"prepared runs under {work}")


# ---- helpers
def files(root):
    root = Path(root)
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and "__pycache__" not in p.parts} if root.exists() else set()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def result(repo):
    try:
        data = json.loads((repo / "RESULT.json").read_text())
        data["violations"] = {re.sub(r"^.*?/repo/", "", str(v)) for v in data.get("violations", [])}
        data["problems"] = {int(p) for p in data.get("problems", [])}
        return data
    except (OSError, ValueError, TypeError, KeyError):
        return None


def companion(repo, key):
    return re.search(rf"^{re.escape(key)}: (.*)$", (repo / "COMPANION.md").read_text(), re.M).group(1)


def port_classes(repo):
    """{class name: [method names]} for every class under paths.ports."""
    found = {}
    for path in sorted((repo / "src/core/ports").rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.ClassDef):
                found[node.name] = [n.name for n in node.body if isinstance(n, ast.FunctionDef)]
    return found


def port_methods(repo):
    return {(c, m) for c, ms in port_classes(repo).items() for m in ms}


def contract_run(repo):
    """Run the companion's contract command verbosely: (exit code, [(test name, class path, status)])."""
    code, out = sh(companion(repo, "checks.contractTests") + " -v", repo)
    tests = re.findall(r"^(\w+) \(([\w.]+)\)(?:\n.*)? \.\.\. (\w+)", out, re.M)
    return code, [(name, path.rsplit(".", 2)[-2] if path.endswith(name) else path.rsplit(".", 1)[-1], status) for name, path, status in tests], out


def both_adapters(tests, name_pattern):
    """Classes that ran a matching test: do they include an in-memory and a real (sqlite) adapter?"""
    classes = {cls for name, cls, status in tests if re.search(name_pattern, name, re.I) and status == "ok"}
    memory = {c for c in classes if re.search("memory|fake", c, re.I)}
    real = {c for c in classes if re.search("sql|real", c, re.I)}
    return bool(memory) and bool(real), sorted(classes)


# ---- scenario checks: return (ok, note)
def s0_1(repo, base):
    r = result(repo)
    if r is None:
        return False, "no RESULT.json"
    new = sorted(f for f in files(repo) - files(base) if f != "RESULT.json")
    ports = [f for f in files(repo / "src/core/ports") if f != "__init__.py"]
    return r.get("applies") is False and not new, f"applies={r.get('applies')} new files={new} ports={ports}"


def s0_2(repo, base):
    r = result(repo)
    if r is None:
        return False, "no RESULT.json"
    ok = r["violations"] == {"src/core/ports/orders.py"} and r.get("applies") is True and 4 in r["problems"]
    return ok, f"violations={sorted(r['violations'])} applies={r.get('applies')} problems={sorted(r['problems'])}"


def s1_1(repo, base):
    classes = port_classes(repo)
    lines = [c for c in classes if "line" in c.lower()]
    repos = [c for c, ms in classes.items() if "order" in c.lower() and "get" in " ".join(ms).lower()]
    return len(repos) == 1 and not lines, f"port classes={classes} order repository ports={repos} line ports={lines}"


def s1_2(repo, base):
    code, tests, out = contract_run(repo)
    ok_dup, classes = both_adapters(tests, "duplicate|unique|taken")
    return code == 0 and ok_dup, f"contract exit={code} duplicate-number cases passed in classes={classes}"


def evidence_s1_3(repo, base):
    out = []
    for path in sorted((repo / "src/adapters").rglob("*.py")):
        text = path.read_text()
        if re.search(r"LIMIT|OFFSET|page", text, re.I):
            out.append(f"--- {path.relative_to(repo)} (lines mentioning LIMIT/OFFSET/page)\n" + "\n".join(
                l for l in text.splitlines() if re.search(r"LIMIT|OFFSET|page|def ", l, re.I)))
    return f"port classes={port_classes(repo)}\n" + ("\n".join(out) or "no adapter mentions LIMIT, OFFSET or page")


def evidence_s1_4(repo, base):
    hits = []
    for sub in ("src/core", "src/adapters"):
        for path in sorted((repo / sub).rglob("*.py")):
            for n, line in enumerate(path.read_text().splitlines(), 1):
                if re.search(r"commit|rollback|BEGIN|transaction|isolation_level|executescript", line, re.I):
                    hits.append(f"{path.relative_to(repo)}:{n}: {line.strip()}")
    return "lines mentioning commit/rollback/BEGIN/transaction:\n" + "\n".join(hits)


def evidence_s2_1(repo, base):
    added = sorted(port_methods(repo) - port_methods(base))
    new_files = sorted(f for f in files(repo) - files(base) if f not in ("RESULT.json",))
    return f"methods added to port classes={added}\nnew files={new_files}"


def s2_2(repo, base):
    added = sorted(m for c, m in port_methods(repo) - port_methods(base))
    generic = [m for m in added if re.search(r"find_?by|where|criteria|filter|query|spec|search|list_all|find_all", m, re.I)]
    named = [m for m in added if re.search(r"overdue|due|late|unpaid|remind", m, re.I) and m not in generic]
    code, tests, out = contract_run(repo)
    ok_both, classes = both_adapters(tests, "overdue|due|late|unpaid|remind")
    ok = bool(named) and not generic and code == 0 and ok_both
    return ok, f"new port methods={added} generic={generic} need-named={named} contract exit={code} finder cases passed in classes={classes}"


def s3_1(repo, base):
    touched = (repo / "src/core/reminders.py").read_text()
    port = repo / "src/core/ports/orders.py"
    calls = set(re.findall(r"orders\.(\w+)\(", touched))
    new_methods = sorted(m for c, m in port_methods(repo) - port_methods(base))
    untouched_same = digest(repo / "src/core/draft_cleanup.py") == digest(base / "src/core/draft_cleanup.py")
    find_by = all("def find_by" in (repo / p).read_text() for p in ("src/core/ports/orders.py", "src/adapters/memory_orders.py", "src/adapters/sqlite_orders.py"))
    code, tests, out = contract_run(repo)
    named = bool(calls - {"find_by"}) and "find_by" not in calls and bool(calls & set(new_methods))
    ok = named and untouched_same and find_by and code == 0
    return ok, f"touched caller calls={sorted(calls)} new port methods={new_methods} untouched unchanged={untouched_same} find_by still in port and adapters={find_by} tests exit={code}"


CHECKS = {"S0.1": s0_1, "S0.2": s0_2, "S1.1": s1_1, "S1.2": s1_2, "S2.2": s2_2, "S3.1": s3_1}
EVIDENCE = {"S1.3": evidence_s1_3, "S1.4": evidence_s1_4, "S2.1": evidence_s2_1}


def finished(run_dir):
    return (run_dir / "AGENT_REPORT.md").exists()


def check(work):
    work = Path(work).resolve()
    table, details = {}, []
    for form in FORMS:
        judge_file = work / form / "JUDGE.json"
        judge = json.loads(judge_file.read_text()) if judge_file.exists() else {}
        for run, (_, _, scenarios) in RUNS.items():
            run_dir = work / form / run
            repo, base = run_dir / "repo", run_dir / "base"
            for sid in scenarios:
                if not finished(run_dir):
                    table[(sid, form)] = ("NOT RUN", "no agent run recorded")
                    continue
                if sid in CHECKS:
                    ok, note = CHECKS[sid](repo, base)
                    table[(sid, form)] = ("PASS" if ok else "FAIL", note)
                else:
                    ev = EVIDENCE[sid](repo, base)
                    if sid in judge:
                        table[(sid, form)] = (judge[sid]["verdict"], judge[sid].get("why", ""))
                    else:
                        table[(sid, form)] = ("NOT RUN", "agent ran, judge verdict missing")
                    details.append(f"### {sid} [{form}] evidence\n{ev}\n")
    # the P0 scan script run directly against the baseline fixtures
    scan_note = []
    for run, infra, expect in (("orm-leak", "miniorm sqlite3", {"src/core/ports/orders.py"}), ("single-table", "sqlite3", set())):
        root = work / "aip" / run / "base"
        code, out = sh(f"python3 -I {SCAN} src/core/ports {infra}", root)
        got = {Path(p).as_posix() for p in json.loads(out)["violations"]} if code == 0 else None
        scan_note.append(f"{run}: {sorted(got) if got is not None else 'script error'} {'ok' if got == expect else 'MISMATCH'}")
    lines = ["| Scenario | SKILL.md | AIP | notes (SKILL.md / AIP) |", "| --- | --- | --- | --- |"]
    for sid in SCENARIOS:
        a, b = table[(sid, "skill-md")], table[(sid, "aip")]
        lines.append(f"| {sid} | {a[0]} | {b[0]} | {a[1][:300]} / {b[1][:300]} |".replace("\n", " "))
    print("\n".join(lines))
    print("\nP0 scan script on baseline fixtures:", "; ".join(scan_note))
    if details:
        print("\n" + "\n".join(details))
    (work / "results.json").write_text(json.dumps({f"{s}|{f}": v for (s, f), v in table.items()}, indent=1))
    return table


def collect(work, out):
    work, out = Path(work).resolve(), Path(out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    for form in FORMS:
        for run in RUNS:
            run_dir = work / form / run
            name = f"{form}-{run}"
            if (run_dir / "PROMPT.md").exists():
                shutil.copy(run_dir / "PROMPT.md", out / f"{name}.prompt.md")
            if finished(run_dir):
                shutil.copy(run_dir / "AGENT_REPORT.md", out / f"{name}.md")
                code, diff = sh("diff -ruN -x __pycache__ -x '*.pyc' base repo", run_dir)
                (out / f"{name}.diff").write_text(diff + "\n")


if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] not in ("prepare", "check", "collect"):
        sys.exit(__doc__)
    if sys.argv[1] == "prepare":
        prepare(sys.argv[2], sys.argv[3:])
    elif sys.argv[1] == "check":
        check(sys.argv[2])
    else:
        collect(sys.argv[2], sys.argv[3])
