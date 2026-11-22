#!/usr/bin/env python3
"""Run the cqrs scenarios against both forms of the skill (same shape as repository/evals/harness.py).

  harness.py postgres [PORT]                 start a Postgres container (docker or podman), print its admin URL
  harness.py prepare WORK ADMIN_URL [RUN ...] build WORK/<form>/<run>/{repo,base,skill,PROMPT.md}, one database per run
  harness.py check WORK ADMIN_URL            run the executable checks on the finished repos, print the table
  harness.py collect WORK OUT                copy each run's prompt, agent report and repo diff into OUT

A fixture is fixtures/_shared plus fixtures/<name>: files replace, `X.add.ext` appends to `X.ext`, and
COMPANION.add.md overrides companion keys. An agent works each run directory (see PROMPT.md); `check`
then runs the script scenarios as executable checks against a fresh check database, prints the
evidence for the judged scenarios (S1.2, S1.5, S2.3, S4.1), reads their verdicts from
WORK/<form>/JUDGE.json and reports PASS, FAIL or NOT RUN per scenario and form. S0.4 is read from
the agent's P0 output. A run without an agent report is NOT RUN, never PASS; so is a scenario in GATED
whose run P0 stopped, since its procedure never ran.
"""
import ast
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import psycopg

HERE = Path(__file__).parent
SKILL = HERE.parent
FIXTURES = HERE / "fixtures"
SCAN = SKILL / "aip" / "scripts" / "scan_query_imports.py"
FORMS = {"skill-md": ["SKILL.md"], "aip": ["aip"]}
RELATED = ["domain-events"]  # skills SKILL.md points to by name, given to the agent in the same form
IMAGE = "docker.io/library/postgres:17-alpine"

# run id -> (procedure instruction, scenarios)
RUNS = {
    "country": ("P0 only", ["S0.1"]),
    "violations": ("P0 only", ["S0.2", "S0.3"]),
    "totals": ("P0, then P1", ["S0.4", "S1.1", "S1.2", "S1.3"]),
    "edit-form": ("P0, then P1", ["S1.4"]),
    "loyalty": ("P0, then P1", ["S1.5"]),
    "slow-totals": ("P0, then P2", ["S2.1"]),
    "revenue": ("P0, then P2", ["S2.2", "S2.3"]),
    "shipping": ("P0, then P2", ["S2.4"]),
    "finder": ("P0, then P3", ["S3.1"]),
    "update-order": ("P0, then P4", ["S4.1", "S4.2"]),
}
SCENARIOS = [s for _, scenarios in RUNS.values() for s in scenarios]
# S<n>.x tests procedure P<n>, which runs only after P0 applies: if P0 stopped, the procedure never ran, so the
# scenario is NOT RUN (a hollow pass blocks like a missing run), whatever its check would say
GATED = {s: f"P{s[1:].split('.')[0]}" for s in SCENARIOS if not s.startswith("S0.")}
JUDGED = {
    "S1.2": "Then paging, sort and totals are computed in SQL, not in code.",
    "S1.5": "Then no query handler evaluates the tier rule; the tier is read from a field the write side persists.",
    "S2.3": "Then the projection declares its trigger, staleness bound, idempotency key and rebuild procedure, plus a read-your-own-writes strategy when async.",
    "S4.1": "Then a command named for the address change carries only address fields and returns id, outcome or version.",
}
PROMPT = """You work in the repository at {repo}. Apply the skill in {skill} (read its SKILL.md first and follow its procedures) to the task in {repo}/TASK.md. The repo companion is {repo}/COMPANION.md; run commands from {repo}. The Postgres database for this repo is already running; its URL is in {repo}/database.url.

Run {procs}. Before anything else, run P0 and write its result to {repo}/RESULT.json as {{"violations": [...], "problems": [numbers], "applies": bool}}.
A skill it points to by name is in {skill}/related/<name> (read it when the skill points there). If the skill has script steps, run them (scripts are under the skill folder; read a script's header for usage). Do the steps yourself; do not look outside {repo} and {skill}.
{extra}
Finish with a short report (the steps you ran, what you changed, anything you could not do) and also write it to {run}/AGENT_REPORT.md.
"""
EXTRA = {
    "P0 only": "Stop after P0: write no code and add no files except RESULT.json.",
    "P0, then P1": "If P0 says applies is false, stop after P0.",
    "P0, then P2": "If P0 says applies is false, stop after P0. If you add a projection, also write {repo}/PROJECTION.json as "
                   '{{"table": "<table name>", "rebuild": "<shell command, run from the repo, that rebuilds it from source>", '
                   '"process": "<shell command that applies pending updates, or null>"}}.',
    "P0, then P3": "If P0 says applies is false, stop after P0.",
    "P0, then P4": "If P0 says applies is false, stop after P0.",
}


def sh(command, cwd, dsn=None):
    env = dict(os.environ, **({"CQRS_DSN": dsn} if dsn else {}))
    done = subprocess.run(command, shell=True, cwd=cwd, capture_output=True, text=True, env=env, timeout=600)
    return done.returncode, (done.stdout + done.stderr).strip()


def py(code, cwd, dsn):
    """Run Python inside a fixture repo against the given database: (exit code, output)."""
    env = dict(os.environ, CQRS_DSN=dsn, PYTHONPATH=str(cwd))
    done = subprocess.run([sys.executable, "-c", code], cwd=cwd, capture_output=True, text=True, env=env, timeout=600)
    return done.returncode, (done.stdout + done.stderr).strip()


# ---- databases
def postgres(port="55432"):
    runtime = shutil.which("docker") if subprocess.run(["docker", "info"], capture_output=True).returncode == 0 else shutil.which("podman")
    subprocess.run([runtime, "rm", "-f", "cqrs-evals-pg"], capture_output=True)
    subprocess.run([runtime, "run", "-d", "--name", "cqrs-evals-pg", "-e", "POSTGRES_PASSWORD=pg", "-p", f"{port}:5432", IMAGE], check=True)
    print(f"postgresql://postgres:pg@localhost:{port}/postgres")


def database(admin, name):
    """Create (or recreate) database `name`; return its URL."""
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{name}"')
    return re.sub(r"/[^/?]*(\?|$)", f"/{name}\\1", admin, count=1) if admin.count("/") >= 3 else f"{admin}/{name}"


def db_name(form, run, suffix=""):
    return f"cqrs_{form}_{run}{suffix}".replace("-", "_")


# ---- fixtures
def build(fixture, dest):
    shutil.copytree(FIXTURES / "_shared", dest)
    overlay = FIXTURES / fixture
    for src in sorted(p for p in overlay.rglob("*") if p.is_file()):
        rel = src.relative_to(overlay)
        if rel.name == "COMPANION.add.md":
            target = dest / "COMPANION.md"
            text = target.read_text()
            for line in src.read_text().splitlines():
                key = line.split(":", 1)[0]
                text = re.sub(rf"^{re.escape(key)}: .*$", line, text, flags=re.M) if re.search(rf"^{re.escape(key)}: ", text, re.M) else text + line + "\n"
            target.write_text(text)
        elif ".add." in rel.name:
            target = dest / rel.parent / rel.name.replace(".add.", ".")
            target.write_text(target.read_text() + src.read_text())
        else:
            (dest / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(src, dest / rel)


def prepare(work, admin, only=()):
    work = Path(work).resolve()
    for form, parts in FORMS.items():
        for run, (procs, _) in RUNS.items():
            if only and run not in only:
                continue
            run_dir = work / form / run
            if run_dir.exists():
                shutil.rmtree(run_dir)
            run_dir.mkdir(parents=True)
            build(run, run_dir / "repo")
            (run_dir / "repo" / "database.url").write_text(database(admin, db_name(form, run)) + "\n")
            shutil.copytree(run_dir / "repo", run_dir / "base")
            (run_dir / "skill").mkdir()
            for part in parts:
                src = SKILL / part
                if src.is_dir():
                    shutil.copytree(src / "scripts", run_dir / "skill" / "scripts")
                    shutil.copy(src / "SKILL.md", run_dir / "skill" / "SKILL.md")
                else:
                    shutil.copy(src, run_dir / "skill" / "SKILL.md")
                for name in RELATED:
                    other, dest = SKILL.parent / name / part, run_dir / "skill" / "related" / name
                    dest.mkdir(parents=True)
                    if other.is_dir():
                        shutil.copytree(other / "scripts", dest / "scripts")
                        shutil.copy(other / "SKILL.md", dest / "SKILL.md")
                    else:
                        shutil.copy(other, dest / "SKILL.md")
            repo = run_dir / "repo"
            (run_dir / "PROMPT.md").write_text(PROMPT.format(
                repo=repo, skill=run_dir / "skill", run=run_dir, procs=procs, extra=EXTRA[procs].format(repo=repo)))
    print(f"prepared runs under {work}")


# ---- helpers
def files(root):
    root = Path(root)
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and "__pycache__" not in p.parts} if root.exists() else set()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest() if Path(path).exists() else None


def changed(repo, base, sub):
    """Files under `sub` that are new or differ from the base."""
    return sorted(f for f in files(repo / sub) if digest(repo / sub / f) != digest(base / sub / f))


def result(repo):
    try:
        data = json.loads((repo / "RESULT.json").read_text())
        paths = set()
        for v in data.get("violations", []):
            p = v.get("path", v.get("file", "")) if isinstance(v, dict) else str(v)
            p = re.sub(r"^.*?/repo/", "", p).lstrip("./").split()  # a path, or "path imports x (rule n)"
            paths.add(p[0] if p else "")
        data["violations"] = paths
        data["problems"] = {int(p) for p in data.get("problems", [])}
        return data
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return None


def companion(repo, key):
    return re.search(rf"^{re.escape(key)}: (.*)$", (repo / "COMPANION.md").read_text(), re.M).group(1)


def tree(path):
    return ast.parse(Path(path).read_text()) if Path(path).exists() else ast.parse("")


def methods(path):
    """{(class, method)} for every class in a file."""
    return {(c.name, f.name) for c in ast.walk(tree(path)) if isinstance(c, ast.ClassDef)
            for f in c.body if isinstance(f, (ast.FunctionDef, ast.AsyncFunctionDef))}


def repo_methods(repo):
    found = methods(repo / "src/core/ports.py")
    for path in (repo / "src/adapters").rglob("*.py"):
        found |= {(f"{path.name}:{c}", m) for c, m in methods(path)}
    return found


def functions(path):
    return {f.name for f in ast.walk(tree(path)) if isinstance(f, (ast.FunctionDef, ast.AsyncFunctionDef))}


def calls(path, func=None):
    """Attribute and function names called in a file, or only inside function `func`."""
    root = tree(path)
    if func:
        root = next((f for f in ast.walk(root) if isinstance(f, ast.FunctionDef) and f.name == func), ast.parse(""))
    out = set()
    for node in ast.walk(root):
        if isinstance(node, ast.Call):
            out.add(node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", ""))
    return out


def imports(path):
    names = set()
    for node in ast.walk(tree(path)):
        if isinstance(node, ast.Import):
            names |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            names.add(("." * node.level) + (node.module or ""))
    return names


def strings(path):
    return [n.value for n in ast.walk(tree(path)) if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def reaches_queries(repo, page):
    """The page imports src.queries itself, or goes through the composition root, which imports it."""
    direct = any(i.startswith(("src.queries", "..queries")) for i in imports(page))
    via_root = any(i in ("src", "src.main") for i in imports(page)) and \
        any(i.startswith("src.queries") for i in imports(repo / companion(repo, "paths.compositionRoot")))
    return direct or via_root


def scan(repo):
    code, out = sh(f"{sys.executable} -I {SCAN} src/core src/queries", repo)
    return json.loads(out)["violations"] if code == 0 else [{"path": "scan error", "rule": out}]


def read_types(path):
    """Classes a query module defines (its read types)."""
    return sorted(c.name for c in ast.walk(tree(path)) if isinstance(c, ast.ClassDef))


def check_db(admin, form, run, repo):
    """A fresh check database with the repo's schema applied: its URL, or None with the error."""
    dsn = database(admin, db_name(form, run, "_check"))
    code, out = py("from src.db import reset_schema; reset_schema()", repo, dsn)
    return (dsn, None) if code == 0 else (None, out[-400:])


def tables(dsn):
    with psycopg.connect(dsn) as conn:
        return {r[0] for r in conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")}


def snapshot(dsn, names=None):
    """{table: sorted rows as text} for every public table (or the named ones)."""
    out = {}
    with psycopg.connect(dsn) as conn:
        for name in sorted(names or tables(dsn)):
            rows = conn.execute(f'SELECT t::text FROM "{name}" t').fetchall()
            out[name] = sorted(r[0] for r in rows)
    return out


def tests_pass(repo, dsn):
    code, out = sh(companion(repo, "checks.queryTests"), repo, dsn)
    tail = out.strip().splitlines()[-1] if out.strip() else ""
    return code == 0, f"queryTests exit={code} ({tail})"


# ---- scenario checks: (repo, base, ctx) -> (ok, note)
def s0_1(repo, base, ctx):
    r = result(repo)
    if r is None:
        return False, "no RESULT.json"
    new = changed(repo, base, "src/queries")
    return r.get("applies") is False and not new, f"applies={r.get('applies')} files added in src/queries={new}"


def violation(path):
    def check(repo, base, ctx):
        r = result(repo)
        if r is None:
            return False, "no RESULT.json"
        return path in r["violations"], f"violations={sorted(r['violations'])}"
    return check


def s0_4(repo, base, ctx):
    r = result(repo)
    if r is None:
        return False, "no RESULT.json"
    return 1 in r["problems"] and r.get("applies") is True, f"problems={sorted(r['problems'])} applies={r.get('applies')} (agent's P0 output)"


def new_query_modules(repo, base):
    return [f for f in changed(repo, base, "src/queries") if f.endswith(".py") and f != "__init__.py"]


def s1_1(repo, base, ctx):
    modules = new_query_modules(repo, base)
    types = {m: read_types(repo / "src/queries" / m) for m in modules}
    domain = [v for v in scan(repo) if v["rule"] == 4]
    page = repo / "src/web/staff_pages.py"
    wired = reaches_queries(repo, page)
    no_load_all = "list_all" not in calls(page)
    ok_tests, note = tests_pass(repo, ctx["dsn"])
    ok = bool(modules) and all(types.values()) and not domain and wired and no_load_all and ok_tests
    return ok, f"query modules={modules} read types={types} query imports of domain={domain} page reaches src.queries={wired} page still loads all orders={not no_load_all} {note}"


def s1_3(repo, base, ctx):
    added = sorted(repo_methods(repo) - repo_methods(base))
    return not added, f"methods added to repository ports or adapters={added}"


def s1_4(repo, base, ctx):
    modules = new_query_modules(repo, base)
    types = {m: read_types(repo / "src/queries" / m) for m in modules}
    domain = [v for v in scan(repo) if v["rule"] == 4]
    form = repo / "src/web/staff_pages.py"
    loads_order = "get" in calls(form, "order_edit_form") or "to_form" in calls(form, "order_edit_form")
    new_tables = sorted(tables(ctx["dsn"]) - ctx["base_tables"])
    ok_tests, note = tests_pass(repo, ctx["dsn"])
    ok = bool(modules) and all(types.values()) and not domain and not loads_order and not new_tables
    return ok, f"query modules={modules} read types={types} query imports of domain={domain} form loads the Order={loads_order} new tables={new_tables} {note}"


def s2_1(repo, base, ctx):
    r = result(repo) or {}
    new_tables = sorted(tables(ctx["dsn"]) - ctx["base_tables"])
    return not new_tables, f"applies={r.get('applies')} new tables={new_tables} PROJECTION.json={(repo / 'PROJECTION.json').exists()}"


REVENUE_SEED = """
from datetime import date
from src import main
for cid in ("ann", "bob"):
    main.register_customer(cid, cid.title(), cid + "@example.com", date(2026, 1, 1))
for n, (cid, cents, day) in enumerate([("ann", 1000, date(2026, 9, 3)), ("bob", 2500, date(2026, 9, 28)), ("ann", 700, date(2026, 10, 1)),
                                       ("bob", 300, date(2026, 10, 15)), ("ann", 900, date(2026, 11, 2)), ("bob", 4000, date(2024, 10, 30))]):
    main.issue_invoice(f"i{n}", cid, cents, day)
main.void_invoice("i3")
"""
REVENUE_EXPECTED = [("2026-11-01", 900, 1), ("2026-10-01", 700, 1), ("2026-09-01", 3500, 2)]
REPORT = """
import json
from datetime import date
from src.web.finance_pages import monthly_revenue_report
months = monthly_revenue_report(date(2026, 11, 7))["months"]
print(json.dumps([[m["month"], m["revenue_cents"], m["invoices"]] for m in months if m["revenue_cents"]]))
"""


def s2_2(repo, base, ctx):
    try:
        spec = json.loads((repo / "PROJECTION.json").read_text())
        table, rebuild, process = spec["table"], spec["rebuild"], spec.get("process")
    except (OSError, ValueError, KeyError, TypeError):
        return False, "no usable PROJECTION.json"
    dsn, notes = ctx["dsn"], []
    query_sql = [s for m in new_query_modules(repo, base) + ["monthly_revenue.py"] for s in strings(repo / "src/queries" / m) if re.search(r"\bselect\b", s, re.I)]
    reads_projection = any(re.search(rf"\b{re.escape(table)}\b", s) for s in query_sql)
    reads_invoices = any(re.search(r"\bfrom\s+invoices\b|\bjoin\s+invoices\b", s, re.I) for s in query_sql)
    code, out = py(REVENUE_SEED, repo, dsn)
    if code:
        return False, f"seeding through the commands failed: {out[-300:]}"

    def run_process():
        if process:
            code, out = sh(process, repo, dsn)
            notes.append(f"process exit={code}")

    run_process()
    once = snapshot(dsn, [table])
    code, report = py(REPORT, repo, dsn)
    correct = code == 0 and json.loads(report.splitlines()[-1]) == [list(r) for r in REVENUE_EXPECTED]
    py("from src import main\ntry:\n    main.void_invoice('i3')\nexcept Exception as e:\n    print('second void refused:', type(e).__name__)", repo, dsn)
    run_process()
    run_process()
    twice = snapshot(dsn, [table])
    code, out = sh(rebuild, repo, dsn)
    notes.append(f"rebuild exit={code}")
    rebuilt = snapshot(dsn, [table])
    ok = reads_projection and not reads_invoices and correct and once == twice and rebuilt == once and code == 0 and bool(once[table])
    return ok, (f"table={table} query reads projection={reads_projection} query reads invoices={reads_invoices} report correct={correct} "
                f"({report[-200:]}) same change twice same rows={once == twice} rebuild equals incremental={rebuilt == once} rows={len(once[table])} {' '.join(notes)}")


SHIPPING_SEED = """
from datetime import date
from src import main
from src.core.orders import Address
main.register_customer("ann", "Ann", "ann@example.com", date(2026, 1, 1))
for oid in ("o1", "o2"):
    main.place_order(oid, "N-" + oid, "ann", date(2026, 3, 1), Address("1 Main St", "Ghent", "9000"), [{"sku": "A", "quantity": 1, "unit_price_cents": 100}])
main.create_shipment("s-fail", "o1")
main.create_shipment("s-ok", "o2")
"""
FAIL_COMMIT = """
CREATE FUNCTION harness_refuse_commit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id = 's-fail' THEN RAISE EXCEPTION 'harness: commit refused'; END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER harness_refuse_commit AFTER UPDATE ON shipments DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION harness_refuse_commit();
"""
DISPATCH = """
from datetime import date
from src import main
try:
    main.dispatch_shipment("{sid}", "bpost", date(2026, 3, 3))
    print("committed")
except Exception as error:
    print("raised", type(error).__name__)
"""


def s2_4(repo, base, ctx):
    dsn = ctx["dsn"]
    code, out = py(SHIPPING_SEED, repo, dsn)
    if code:
        return False, f"seeding through the commands failed: {out[-300:]}"
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(FAIL_COMMIT)
    before = snapshot(dsn)
    code, failed = py(DISPATCH.format(sid="s-fail"), repo, dsn)
    after_fail = snapshot(dsn)
    unchanged = before == after_fail
    moved = sorted(t for t in before if before[t] != after_fail.get(t))
    code, ok_run = py(DISPATCH.format(sid="s-ok"), repo, dsn)
    after_ok = snapshot(dsn)
    gained = sorted(t for t in after_ok if t not in ctx["base_tables"] and len(after_ok[t]) > len(after_fail.get(t, [])))
    spec = (repo / "PROJECTION.json").read_text().strip() if (repo / "PROJECTION.json").exists() else "none"
    ok = "raised" in failed and unchanged and "committed" in ok_run and bool(gained)
    return ok, (f"rolled-back dispatch: {failed.splitlines()[-1] if failed else ''}, tables changed={moved}; "
                f"committed dispatch: {ok_run.splitlines()[-1] if ok_run else ''}, new tables that gained a row={gained}; PROJECTION.json={spec[:200]}")


def s3_1(repo, base, ctx):
    touched = repo / "src/web/customer_pages.py"
    uses_finder = "find_recent_for_customer" in calls(touched)
    uses_query = reaches_queries(repo, touched)
    untouched_same = digest(repo / "src/web/staff_pages.py") == digest(base / "src/web/staff_pages.py")
    finder = "find_recent_for_customer" in {m for _, m in methods(repo / "src/core/ports.py")} and \
        "find_recent_for_customer" in {m for _, m in methods(repo / "src/adapters/pg_orders.py")}
    ok_tests, note = tests_pass(repo, ctx["dsn"])
    ok = not uses_finder and uses_query and untouched_same and finder and ok_tests
    return ok, f"touched page calls the finder={uses_finder} reaches src.queries={uses_query} untouched page unchanged={untouched_same} finder still in port and adapter={finder} {note}"


def s4_2(repo, base, ctx):
    exists = "update_order" in functions(repo / "src/core/commands/update_order.py")
    shutil.copy(base / "tests/test_update_order.py", repo / "tests/test_harness_update_order.py")
    try:
        code, out = sh(f"{sys.executable} -m unittest tests.test_harness_update_order", repo, ctx["dsn"])
    finally:
        (repo / "tests/test_harness_update_order.py").unlink()
    tail = out.strip().splitlines()[-1] if out.strip() else ""
    return exists and code == 0, f"update_order still defined={exists} original UpdateOrder tests exit={code} ({tail})"


CHECKS = {"S0.1": s0_1, "S0.2": violation("src/queries/order_summary.py"), "S0.3": violation("src/core/commands/cancel_order.py"),
          "S0.4": s0_4, "S1.1": s1_1, "S1.3": s1_3, "S1.4": s1_4, "S2.1": s2_1, "S2.2": s2_2, "S2.4": s2_4, "S3.1": s3_1, "S4.2": s4_2}


def evidence(repo, base, sid):
    code, diff = sh("diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base/src ../repo/src; "
                    "diff -uN ../base/schema.sql ../repo/schema.sql", repo)
    extra = f"PROJECTION.json: {(repo / 'PROJECTION.json').read_text()}\n" if (repo / "PROJECTION.json").exists() else ""
    return f"{extra}diff base -> repo (src, schema.sql):\n{diff[:20000]}"


def finished(run_dir):
    return (run_dir / "AGENT_REPORT.md").exists()


def check(work, admin):
    work = Path(work).resolve()
    table, details = {}, []
    for form in FORMS:
        judge_file = work / form / "JUDGE.json"
        judge = json.loads(judge_file.read_text()) if judge_file.exists() else {}
        for run, (_, scenarios) in RUNS.items():
            run_dir = work / form / run
            repo, base = run_dir / "repo", run_dir / "base"
            if not finished(run_dir):
                for sid in scenarios:
                    table[(sid, form)] = ("NOT RUN", "no agent run recorded")
                continue
            base_dsn, _ = check_db(admin, form, run + "_base", base)
            base_tables = tables(base_dsn)
            p0 = result(repo) or {}
            for sid in scenarios:
                if sid in GATED and p0.get("applies") is not True:
                    table[(sid, form)] = ("NOT RUN", f"P0 stopped (applies={p0.get('applies')}), so {GATED[sid]} never ran")
                    continue
                if sid in CHECKS:
                    dsn, error = check_db(admin, form, run, repo)
                    if error:
                        table[(sid, form)] = ("FAIL", f"repo schema does not apply: {error}")
                        continue
                    try:
                        ok, note = CHECKS[sid](repo, base, {"dsn": dsn, "base_tables": base_tables})
                    except Exception as error:  # a crash in the finished repo is a failed check, not a harness stop
                        ok, note = False, f"check raised {type(error).__name__}: {error}"
                    table[(sid, form)] = ("PASS" if ok else "FAIL", note)
                else:
                    if sid in judge:
                        table[(sid, form)] = (judge[sid]["verdict"], judge[sid].get("why", ""))
                    else:
                        table[(sid, form)] = ("NOT RUN", "agent ran, judge verdict missing")
                    details.append(f"### {sid} [{form}] {JUDGED[sid]}\n{evidence(repo, base, sid)}\n")
    lines = ["| Scenario | SKILL.md | AIP | notes (SKILL.md / AIP) |", "| --- | --- | --- | --- |"]
    for sid in SCENARIOS:
        a, b = table[(sid, "skill-md")], table[(sid, "aip")]
        lines.append(f"| {sid} | {a[0]} | {b[0]} | {a[1][:400]} / {b[1][:400]} |".replace("\n", " "))
    print("\n".join(lines))
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
                code, diff = sh("diff -ruN -x __pycache__ -x '*.pyc' -x database.url base repo", run_dir)
                (out / f"{name}.diff").write_text(diff + "\n")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] not in ("postgres", "prepare", "check", "collect"):
        sys.exit(__doc__)
    if args[0] == "postgres":
        postgres(*args[1:2])
    elif args[0] == "prepare" and len(args) >= 3:
        prepare(args[1], args[2], args[3:])
    elif args[0] == "check" and len(args) == 3:
        check(args[1], args[2])
    elif args[0] == "collect" and len(args) == 3:
        collect(args[1], args[2])
    else:
        sys.exit(__doc__)
