#!/usr/bin/env python3
"""Run the domain-events scenarios against both forms of the skill (same shape as cqrs/evals/harness.py).

  harness.py postgres [PORT]                  start a Postgres container (docker or podman), print its admin URL
  harness.py prepare WORK ADMIN_URL [RUN ...] build WORK/<form>/<run>/{repo,base,skill,PROMPT.md}, one database per run
  harness.py check WORK ADMIN_URL             run the executable checks on the finished repos, print the table
  harness.py collect WORK OUT                 copy each run's prompt, agent report and repo diff into OUT

A fixture is fixtures/_shared plus fixtures/<name>: files replace, `X.add.ext` appends to `X.ext`. An agent
works each run directory (see PROMPT.md); `check` then runs the script scenarios as executable checks
against a fresh check database per scenario, prints the evidence for the judged scenarios (S1.3, S2.2,
S4.2), reads their verdicts from WORK/<form>/JUDGE.json and reports PASS, FAIL or NOT RUN per scenario
and form. S0.2 and S0.3 are read from the agent's P0 output. A run without an agent report is NOT RUN,
never PASS; so is a scenario in GATED whose run P0 stopped, since its procedure never ran.
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
SCAN = SKILL / "aip" / "scripts" / "scan_infra_imports.py"
FORMS = {"skill-md": ["SKILL.md"], "aip": ["aip"]}
IMAGE = "docker.io/library/postgres:17-alpine"
DOMAIN = ["src/sales/core", "src/shipping/core"]
INFRA = ["src.infra.bus", "src.infra.mail"]

# run id -> (procedure instruction, scenarios)
RUNS = {
    "order-total": ("P0 only", ["S0.1"]),
    "direct-publish": ("P0, then P4", ["S0.2", "S4.1"]),
    "invoice-paid": ("P0, then P1, then P2", ["S0.3", "S1.1", "S1.2", "S1.3", "S2.1", "S2.2"]),
    "no-consumer": ("P0, then P1, then P2", ["S2.3"]),
    "consumer": ("P0, then P3", ["S3.1", "S3.2", "S3.3"]),
    "handler-chain": ("P0, then P4", ["S4.2"]),
}
SCENARIOS = sorted((s for _, scenarios in RUNS.values() for s in scenarios), key=lambda s: tuple(int(n) for n in s[1:].split(".")))
# S<n>.x tests procedure P<n>, which runs only after P0 applies: if P0 stopped, the procedure never ran, so the
# scenario is NOT RUN (a hollow pass blocks like a missing run), whatever its check would say
GATED = {s: f"P{s[1:].split('.')[0]}" for s in SCENARIOS if not s.startswith("S0.")}
JUDGED = {
    "S1.3": "Then the event is a past-tense fact and listed in paths.eventList.",
    "S2.2": "Then the payload holds only the fields Shipping needs, plus the ids and version every event carries (rule 7).",
    "S4.2": "Given an in-process handler doing a same-transaction update, When P4 completes, Then it is an explicit call in the use case.",
}
PROMPT = """You work in the repository at {repo}. Apply the skill in {skill} (read its SKILL.md first and follow its procedures) to the task in {repo}/TASK.md. The repo companion is {repo}/COMPANION.md; run commands from {repo}. The Postgres database for this repo is already running; its URL is in {repo}/database.url.

Run {procs}. Before anything else, run P0 and write its result to {repo}/RESULT.json as {{"violations": [...], "problems": [numbers], "applies": bool}}.
If the skill has script steps, run them (scripts are under the skill folder; read a script's header for usage). Do the steps yourself; do not look outside {repo} and {skill}.
{extra}
Finish with a short report (the steps you ran, what you changed, anything you could not do) and also write it to {run}/AGENT_REPORT.md.
"""
EXTRA = {
    "P0 only": "Stop after P0: write no code and add no files except RESULT.json.",
    "P0, then P1, then P2": "If P0 says applies is false, stop after P0.",
    "P0, then P2": "If P0 says applies is false, stop after P0.",
    "P0, then P3": "If P0 says applies is false, stop after P0. When you are done, also write {repo}/CONSUMER.json as "
                   '{{"deliver": "<shell command, run from the repo, that runs one delivery pass of Shipping\'s invoice-event consumer now, '
                   'as if any wait between attempts had passed>", "dead_letter": "<SQL query returning the messages that will not be delivered again, or null>"}}.',
    "P0, then P4": "If P0 says applies is false, stop after P0.",
}


def sh(command, cwd, dsn=None):
    env = dict(os.environ, **({"EVENTS_DSN": dsn} if dsn else {}))
    done = subprocess.run(command, shell=True, cwd=cwd, capture_output=True, text=True, env=env, timeout=600)
    return done.returncode, (done.stdout + done.stderr).strip()


def py(code, cwd, dsn):
    """Run Python inside a fixture repo against the given database: (exit code, output)."""
    env = dict(os.environ, EVENTS_DSN=dsn, PYTHONPATH=str(cwd))
    done = subprocess.run([sys.executable, "-c", code], cwd=cwd, capture_output=True, text=True, env=env, timeout=600)
    return done.returncode, (done.stdout + done.stderr).strip()


# ---- databases
def postgres(port="55442"):
    runtime = shutil.which("docker") if subprocess.run(["docker", "info"], capture_output=True).returncode == 0 else shutil.which("podman")
    subprocess.run([runtime, "rm", "-f", "domain-events-evals-pg"], capture_output=True)
    subprocess.run([runtime, "run", "-d", "--name", "domain-events-evals-pg", "-e", "POSTGRES_PASSWORD=pg", "-p", f"{port}:5432", IMAGE], check=True)
    print(f"postgresql://postgres:pg@localhost:{port}/postgres")


def database(admin, name):
    """Create (or recreate) database `name`; return its URL."""
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{name}"')
    return re.sub(r"/[^/?]*(\?|$)", f"/{name}\\1", admin, count=1) if admin.count("/") >= 3 else f"{admin}/{name}"


def db_name(form, run, suffix=""):
    return f"de_{form}_{run}{suffix}".replace("-", "_").replace(".", "_")


# ---- fixtures
def build(fixture, dest):
    shutil.copytree(FIXTURES / "_shared", dest)
    overlay = FIXTURES / fixture
    for src in sorted(p for p in overlay.rglob("*") if p.is_file()):
        rel = src.relative_to(overlay)
        if ".add." in rel.name:
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
            paths.add(p[0].rstrip(":,") if p else "")
        data["violations"] = paths
        data["problems"] = {int(p) for p in data.get("problems", [])}
        return data
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return None


def tree(path):
    return ast.parse(Path(path).read_text()) if Path(path).exists() else ast.parse("")


def imports(path):
    names = set()
    for node in ast.walk(tree(path)):
        if isinstance(node, ast.Import):
            names |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            module = ("." * node.level) + (node.module or "")
            names.add(module)
            names |= {f"{module}.{a.name}" for a in node.names}
    return names


def scan(repo):
    code, out = sh(f"{sys.executable} -I {SCAN} {' '.join(DOMAIN)} --infra {' '.join(INFRA)}", repo)
    return json.loads(out)["violations"] if code == 0 else [{"path": "scan error", "imports": [out]}]


def check_db(admin, form, run, repo, suffix="_check"):
    """A fresh check database with the repo's schema applied: its URL, or None with the error."""
    dsn = database(admin, db_name(form, run, suffix))
    code, out = py("from src.db import reset_schema; reset_schema()", repo, dsn)
    return (dsn, None) if code == 0 else (None, out[-400:])


def tables(dsn):
    with psycopg.connect(dsn) as conn:
        return {r[0] for r in conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")}


def snapshot(dsn):
    """{table: sorted rows as text} for every public table."""
    out = {}
    with psycopg.connect(dsn) as conn:
        for name in sorted(tables(dsn)):
            out[name] = sorted(r[0] for r in conn.execute(f'SELECT t::text FROM "{name}" t').fetchall())
    return out


# ---- the outbox check (S1.1, S4.1): one commit refused by a deferred trigger, one commit allowed
SEED = """
from src import main
for n in ("fail", "ok"):
    main.place_order("o-" + n, "ann", [{"sku": "A", "quantity": 2, "unit_price_cents": 500}])
    main.issue_invoice("i-" + n, "o-" + n)
"""
REFUSE_COMMIT = """
CREATE FUNCTION harness_refuse_commit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id = 'i-fail' THEN RAISE EXCEPTION 'harness: commit refused'; END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER harness_refuse_commit AFTER UPDATE ON invoices DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION harness_refuse_commit();
"""
PAY = """
from datetime import date
from src import main
try:
    main.pay_invoice("{iid}", date(2026, 11, 2))
    print("committed")
except Exception as error:
    print("raised", type(error).__name__)
"""


def outbox_on_commit(repo, ctx):
    """(rolled back left every table unchanged, committed added exactly one row to one new table, note)."""
    dsn = ctx["dsn"]
    code, out = py(SEED, repo, dsn)
    if code:
        return False, False, f"seeding through the use cases failed: {out[-300:]}"
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(REFUSE_COMMIT)
    before = snapshot(dsn)
    _, failed = py(PAY.format(iid="i-fail"), repo, dsn)
    after_fail = snapshot(dsn)
    moved = sorted(t for t in after_fail if before.get(t) != after_fail[t])
    _, ok_run = py(PAY.format(iid="i-ok"), repo, dsn)
    after_ok = snapshot(dsn)
    gained = {t: len(after_ok[t]) - len(after_fail.get(t, [])) for t in after_ok
              if t not in ctx["base_tables"] and len(after_ok[t]) != len(after_fail.get(t, []))}
    rolled_back = "raised" in failed and not moved
    one_row = "committed" in ok_run and list(gained.values()) == [1]
    return rolled_back, one_row, (f"rolled-back payment: {failed.splitlines()[-1] if failed else ''}, tables changed={moved}; "
                                  f"committed payment: {ok_run.splitlines()[-1] if ok_run else ''}, rows gained in new tables={gained}")


# ---- scenario checks: (repo, base, ctx) -> (ok, note)
def s0_1(repo, base, ctx):
    r = result(repo)
    if r is None:
        return False, "no RESULT.json"
    events = changed(repo, base, "docs") + [f for f in changed(repo, base, "src/sales/core") if f == "events.py"]
    return r.get("applies") is False and not events, f"applies={r.get('applies')} event list or events module changed={events}"


def s0_2(repo, base, ctx):
    r = result(repo)
    if r is None:
        return False, "no RESULT.json"
    wanted = {"src/sales/core/commands/pay_invoice.py", "src/sales/core/commands/cancel_invoice.py"}
    return wanted <= r["violations"], f"violations={sorted(r['violations'])}"


def s0_3(repo, base, ctx):
    r = result(repo)
    if r is None:
        return False, "no RESULT.json"
    return 1 in r["problems"], f"problems={sorted(r['problems'])} applies={r.get('applies')} (agent's P0 output)"


def s1_1(repo, base, ctx):
    rolled_back, one_row, note = outbox_on_commit(repo, ctx)
    return rolled_back and one_row, note


def s1_2(repo, base, ctx):
    bus = [v for v in scan(repo) if any(i == "src.infra.bus" or i.startswith("src.infra.bus.") or i == "scan error" for i in v["imports"])]
    return not bus, f"domain or use case files importing the bus client={[v['path'] for v in bus]}"


def s2_1(repo, base, ctx):
    contracts = [f for f in changed(repo, base, "src/contracts") if f.endswith(".py") and f != "__init__.py"]
    versioned = {f: bool(re.search(r"version|\bv\d+\b|_v\d+\b|V\d+\b", f + (repo / "src/contracts" / f).read_text())) for f in contracts}
    leaks = sorted({f"{p.relative_to(repo)}: {i}" for p in (repo / "src/shipping").rglob("*.py")
                    for i in imports(p) if i == "src.sales" or i.startswith("src.sales.")})
    ok = bool(contracts) and any(versioned.values()) and not leaks
    return ok, f"contract files={contracts} versioned={versioned} shipping imports of sales={leaks}"


def s2_3(repo, base, ctx):
    contracts = [f for f in changed(repo, base, "src/contracts") if f != "__init__.py"]
    r = result(repo) or {}
    return not contracts, f"applies={r.get('applies')} contract files added={contracts}"


TOPIC = "sales.invoices.v1"
PUBLISH = """
import json
from src.infra import bus
for body in json.loads({bodies!r}):
    bus.publish("{topic}", body)
"""


def paid(event_id, invoice_id, order_id, version):
    return {"event_id": event_id, "type": "InvoicePaid", "invoice_id": invoice_id, "order_id": order_id,
            "invoice_version": version, "occurred_on": "2026-11-02"}


def refunded(event_id, invoice_id, order_id, version):
    return {"event_id": event_id, "type": "InvoiceRefunded", "invoice_id": invoice_id, "order_id": order_id,
            "invoice_version": version, "occurred_on": "2026-11-04"}


def consumer_spec(repo):
    spec = json.loads((repo / "CONSUMER.json").read_text())
    return spec["deliver"], spec.get("dead_letter")


def deliver(repo, ctx, bodies, passes):
    deliver_cmd, _ = consumer_spec(repo)
    code, out = py(PUBLISH.format(bodies=json.dumps(bodies), topic=TOPIC), repo, ctx["dsn"])
    if code:
        raise RuntimeError(f"publishing failed: {out[-300:]}")
    exits = [sh(deliver_cmd, repo, ctx["dsn"])[0] for _ in range(passes)]
    return exits


def fulfilments(dsn, order_id):
    with psycopg.connect(dsn) as conn:
        return conn.execute("SELECT status FROM fulfilments WHERE order_id = %s", (order_id,)).fetchall()


def s3_1(repo, base, ctx):
    exits = deliver(repo, ctx, [paid("e1", "i1", "o1", 2), paid("e1", "i1", "o1", 2)], 3)
    rows = fulfilments(ctx["dsn"], "o1")
    return [r[0] for r in rows] == ["requested"], f"same InvoicePaid delivered twice -> fulfilments for o1={rows} deliver exits={exits}"


def s3_2(repo, base, ctx):
    exits = deliver(repo, ctx, [refunded("e3", "i2", "o2", 3), paid("e2", "i2", "o2", 2)], 3)
    rows = fulfilments(ctx["dsn"], "o2")
    return not any(r[0] == "requested" for r in rows), f"InvoiceRefunded v3 then InvoicePaid v2 -> fulfilments for o2={rows} deliver exits={exits}"


FAIL_HANDLER = """
CREATE SEQUENCE harness_attempts;
CREATE FUNCTION harness_fail_o3() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.order_id = 'o3' THEN PERFORM nextval('harness_attempts'); RAISE EXCEPTION 'harness: fulfilment refused'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER harness_fail_o3 BEFORE INSERT OR UPDATE ON fulfilments FOR EACH ROW EXECUTE FUNCTION harness_fail_o3();
"""


def s3_3(repo, base, ctx):
    dsn = ctx["dsn"]
    _, dead_sql = consumer_spec(repo)
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(FAIL_HANDLER)
    exits = deliver(repo, ctx, [paid("e4", "i3", "o3", 2)], 8)
    with psycopg.connect(dsn, autocommit=True) as conn:
        attempts = conn.execute("SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM harness_attempts").fetchone()[0]
        bus_id = conn.execute("SELECT id FROM bus_messages WHERE body->>'event_id' = 'e4'").fetchone()[0]
        dead = [r[0] for r in conn.execute(f"SELECT t::text FROM ({dead_sql.rstrip(';')}) t").fetchall()] if dead_sql else []
    in_dead = any("e4" in row or re.search(rf"\b{bus_id}\b", row) for row in dead)
    return attempts >= 2 and in_dead, f"handler attempts={attempts} dead-letter rows={dead[:5]} message e4 (bus id {bus_id}) dead-lettered={in_dead} deliver exits={exits}"


def s4_1(repo, base, ctx):
    rolled_back, one_row, note = outbox_on_commit(repo, ctx)
    other_same = digest(repo / "src/sales/core/commands/cancel_invoice.py") == digest(base / "src/sales/core/commands/cancel_invoice.py")
    return rolled_back and one_row and other_same, f"{note}; cancel_invoice.py unchanged={other_same}"


CHECKS = {"S0.1": s0_1, "S0.2": s0_2, "S0.3": s0_3, "S1.1": s1_1, "S1.2": s1_2, "S2.1": s2_1, "S2.3": s2_3,
          "S3.1": s3_1, "S3.2": s3_2, "S3.3": s3_3, "S4.1": s4_1}


def evidence(repo, base, sid):
    code, diff = sh("diff -ruN -x __pycache__ -x '*.pyc' -x RESULT.json -x database.url ../base ../repo", repo)
    return f"diff base -> repo:\n{diff[:30000]}"


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
            base_dsn, _ = check_db(admin, form, run, base, "_base")
            base_tables = tables(base_dsn)
            p0 = result(repo) or {}
            for sid in scenarios:
                if sid in GATED and p0.get("applies") is not True:
                    table[(sid, form)] = ("NOT RUN", f"P0 stopped (applies={p0.get('applies')}), so {GATED[sid]} never ran")
                    continue
                if sid in CHECKS:
                    dsn, error = check_db(admin, form, run, repo, f"_{sid}")
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
