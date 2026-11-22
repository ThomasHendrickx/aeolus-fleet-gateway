#!/usr/bin/env python3
"""Run the ports-and-adapters scenarios against both forms of the skill.

  harness.py prepare WORK [RUN ...]  build WORK/<form>/<run>/{repo,base,skill,PROMPT.md} for each run
  harness.py check WORK        run the executable checks on the finished repos, print the table

An agent works each run directory (see PROMPT.md); `check` then runs the script scenarios as
executable checks, reads the agent-kind scenarios' outputs (RESULT.json, JUDGE.json) and reports
PASS, FAIL or NOT RUN per scenario and form. A run without a finished repo is NOT RUN, never PASS.
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
SCAN = SKILL / "aip" / "scripts" / "scan_domain_imports.py"
FORMS = {"skill-md": ["SKILL.md"], "aip": ["aip"]}

# run id -> (fixture, procedure instruction, scenarios)
RUNS = {
    "crud": ("crud", "P0 only", ["S0.1"]),
    "violation": ("violation", "P0 only", ["S0.2"]),
    "mcp": ("mcp", "P0 only", ["S0.3"]),
    "email": ("email", "P0, then P1", ["S1.1", "S1.2", "S1.4"]),
    "prisma": ("prisma", "P0, then P1", ["S1.3"]),
    "rest": ("rest", "P0, then P2", ["S2.1", "S2.2"]),
    "handler": ("handler", "P0, then P3", ["S3.1", "S3.2", "S3.3"]),
}
SCENARIOS = ["S0.1", "S0.2", "S0.3", "S1.1", "S1.2", "S1.3", "S1.4", "S2.1", "S2.2", "S3.1", "S3.2", "S3.3"]
JUDGED = {
    "S1.3": "Given an external API type (a Prisma-like model), when P1 completes, then the port returns a domain type and the mapping lives in the adapter.",
    "S2.1": "Given a REST handler holding a business rule, when P2 adds an MCP adapter for the same use case, then the rule exists once, in the use case, and both adapters call the same inbound port.",
    "S2.2": "The new MCP adapter's tests cover input translation and error mapping only (no business-rule tests).",
    "S3.2": "After P3, the refund handler contains no business decision (it only translates input, calls the inbound port, maps the result and errors).",
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
    "P0, then P2": "If P0 says applies is false, stop after P0. Follow the skill where it says to run another procedure first.",
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
            shutil.copytree(HERE / "fixtures" / fixture, run_dir / "repo")
            shutil.copy(HERE / "fixtures" / "_shared" / "check_direction.py", run_dir / "repo")
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


# ---- helpers for checks
def files(root):
    return {p.relative_to(root).as_posix() for p in Path(root).rglob("*") if p.is_file() and "__pycache__" not in p.parts}


def scan(root, *modules):
    code, out = sh(f"python3 -I {SCAN} {root} {' '.join(modules)}", ".")
    return {Path(p).relative_to(root).as_posix() for p in json.loads(out)["violations"]} if code == 0 else None


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


def tests_pass(repo):
    return sh(companion(repo, "scenario tests"), repo)


def project_imports(path):
    names = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            names |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            names.add(("." * node.level) + (node.module or ""))
    return names


def changed(repo, base, sub):
    """Files under `sub` that are new or differ from the baseline."""
    return sorted(f for f in files(repo / sub)
                  if not (base / sub / f).exists() or digest(repo / sub / f) != digest(base / sub / f))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def memory_adapters(repo):
    found = []
    for path in sorted((repo / "src" / "adapters").rglob("*.py")):
        for name in re.findall(r"^class (\w*(?:Memory|Fake|InMemory)\w*)", path.read_text(), re.M | re.I):
            found.append((path.relative_to(repo).as_posix(), name))
    return found


# ---- scenario checks: return (ok, note)
def s0_1(repo, base):
    r = result(repo)
    if r is None:
        return False, "no RESULT.json"
    ports = [f for f in files(repo / "src/core/ports") if f != "__init__.py"]
    port_files = [f for f in files(repo) - files(base) if "port" in f.lower()]
    return r.get("applies") is False and not ports and not port_files, f"applies={r.get('applies')} port files={ports + port_files}"


def s0_2(repo, base):
    r = result(repo)
    if r is None:
        return False, "no RESULT.json"
    want = {"src/core/orders.py"}
    ok = r["violations"] == want and r.get("applies") is True and 1 in r["problems"]
    return ok, f"violations={sorted(r['violations'])} applies={r.get('applies')} problems={sorted(r['problems'])}"


def s0_3(repo, base):
    r = result(repo)
    if r is None:
        return False, "no RESULT.json"
    return 3 in r["problems"] and r.get("applies") is True, f"applies={r.get('applies')} problems={sorted(r['problems'])}"


def s1_1(repo, base):
    ports = [f for f in files(repo / "src/core/ports") if f.endswith(".py") and f != "__init__.py"]
    fakes = memory_adapters(repo)
    bad_ports = scan(repo / "src/core/ports", "email_sdk")
    new_tests = [f for f in changed(repo, base, "tests") if f.endswith(".py")]
    tested = [f for f in new_tests if any(name in (repo / "tests" / f).read_text() for _, name in fakes)]
    code, out = tests_pass(repo)
    ok = bool(ports) and not bad_ports and bool(fakes) and bool(tested) and code == 0
    return ok, f"ports={ports} port_infra_imports={sorted(bad_ports or [])} in-memory={fakes} new/changed tests using fake={tested} tests_exit={code}"


def s1_2(repo, base):
    importers = scan(repo / "src", "email_sdk")
    fakes = {p for p, _ in memory_adapters(repo)}
    ok = importers is not None and len(importers) == 1 and all(
        f"src/{i}".startswith("src/adapters/") and f"src/{i}" not in fakes for i in importers)
    return ok, f"importers of email_sdk={sorted(importers or [])}"


def s1_4(repo, base):
    code, out = sh(companion(repo, "checks.dependencyDirection"), repo)
    return code == 0, out.splitlines()[-1] if out else ""


def evidence_s1_3(repo, base):
    ports = sorted(f for f in files(repo / "src/core/ports") if f.endswith(".py"))
    leaks = [f for f in files(repo / "src/core") if f.endswith(".py") and re.search(r"OrderModel|prismalike|statusCode|totalCents", (repo / "src/core" / f).read_text())]
    adapters = scan(repo / "src/adapters", "prismalike")
    return f"ports={ports} core files naming the ORM type={leaks} adapters importing prismalike={sorted(adapters or [])}"


def evidence_s2(repo, base):
    adapters = sorted(f for f in files(repo / "src/adapters") if f.endswith(".py"))
    vip = sorted(f for f in files(repo / "src") if f.endswith(".py") and "VIP" in (repo / "src" / f).read_text())
    imports = {a: sorted(i for i in project_imports(repo / "src/adapters" / a) if i.startswith(("src", "."))) for a in adapters if a != "__init__.py"}
    new_tests = sorted(files(repo / "tests") - files(base / "tests"))
    return f"adapters={adapters} files holding the VIP rule={vip} project imports per adapter={imports} new tests={new_tests}"


def s3_1(repo, base):
    handler = repo / "src/adapters/rest_refunds.py"
    internal = {i for i in project_imports(handler) if i.startswith(("src", "."))}
    other_infra = scan(repo / "src/adapters", "sqlite3")
    new_refund_tests = [f for f in changed(repo, base, "tests") if re.search("refund", f, re.I)]
    code, out = tests_pass(repo)
    ok = (len(internal) == 1 and next(iter(internal)).startswith("src.core") and "rest_refunds.py" not in (other_infra or [])
          and bool(new_refund_tests) and code == 0)
    return ok, f"handler project imports={sorted(internal)} new refund tests={new_refund_tests} tests_exit={code}"


def evidence_s3_2(repo, base):
    return "handler source:\n" + (repo / "src/adapters/rest_refunds.py").read_text()


def s3_3(repo, base):
    same = {f: digest(repo / f) == digest(base / f) for f in ("src/adapters/rest_users.py", "src/adapters/rest_invoices.py", "tests/test_users_invoices.py")}
    return all(same.values()), f"unchanged={same}"


CHECKS = {"S0.1": s0_1, "S0.2": s0_2, "S0.3": s0_3, "S1.1": s1_1, "S1.2": s1_2, "S1.4": s1_4, "S3.1": s3_1, "S3.3": s3_3}
EVIDENCE = {"S1.3": evidence_s1_3, "S2.1": evidence_s2, "S2.2": evidence_s2, "S3.2": evidence_s3_2}


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
    # the P0 scan script run directly against the fixtures (aip form only; SKILL.md has no script)
    scan_note = []
    for run, domain_expect in (("violation", {"src/core/orders.py"}), ("crud", set())):
        root = work / "aip" / run / "base" / "src/core"
        got = scan(root, "payments_sdk" if run == "violation" else "sqlite3")
        scan_note.append(f"{run}: {sorted(got) if got is not None else 'script error'} {'ok' if got == {p[len('src/core/'):] for p in domain_expect} else 'MISMATCH'}")
    lines = ["| Scenario | SKILL.md | AIP | notes (SKILL.md / AIP) |", "| --- | --- | --- | --- |"]
    for sid in SCENARIOS:
        a, b = table[(sid, "skill-md")], table[(sid, "aip")]
        lines.append(f"| {sid} | {a[0]} | {b[0]} | {a[1][:200]} / {b[1][:200]} |".replace("\n", " "))
    print("\n".join(lines))
    print("\nP0 scan script on baseline fixtures:", "; ".join(scan_note))
    if details:
        print("\n" + "\n".join(details))
    (work / "results.json").write_text(json.dumps({f"{s}|{f}": v for (s, f), v in table.items()}, indent=1))
    return table


if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] not in ("prepare", "check"):
        sys.exit(__doc__)
    if sys.argv[1] == "prepare":
        prepare(sys.argv[2], sys.argv[3:])
    else:
        check(sys.argv[2])
