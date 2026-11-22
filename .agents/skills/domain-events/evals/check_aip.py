#!/usr/bin/env python3
"""Validate aip/SKILL.md against its bundled schema and check the graph.

Needs pyyaml and jsonschema. The pinned-compiler validate.py run is recorded separately in results/validate-aip.txt.
Checks: bundled schema, source/ORIGINAL_SKILL.md equals SKILL.md, P0..P4 step counts (3, 5, 5, 4, 4),
P0 step 1 is the only entry node, depends_on targets exist and form a DAG, and every input is
produced upstream or is a companion/task input.
"""
import json
import re
import sys
from pathlib import Path

import jsonschema
import yaml

ROOT = Path(__file__).parents[1]
AIP = ROOT / "aip"
COMPANION_INPUTS = {"paths.domain", "paths.eventList", "paths.integrationEvents", "paths.consumers",
                    "checks.dependencyDirection", "checks.eventTests", "infraModules", "task"}
COUNTS = {"p0": 3, "p1": 5, "p2": 5, "p3": 4, "p4": 4}
# step kinds per procedure, in order, as SKILL.md tags them
KINDS = {"p0": "SAA", "p1": "AAAAS", "p2": "AAAAS", "p3": "AAAS", "p4": "AAAS"}


def main():
    failures = []

    def check(name, ok):
        print(f"{'PASS' if ok else 'FAIL'}: {name}")
        if not ok:
            failures.append(name)

    text = (AIP / "SKILL.md").read_text()
    body = re.search(r"^```yaml\n(.*)\n```\s*$", text.split("\n---\n", 1)[1], re.S | re.M).group(1)
    doc = yaml.safe_load(body)
    schema = json.loads((AIP / "source" / "procedure.schema.json").read_text())
    try:
        jsonschema.validate(doc, schema)
        valid = True
    except jsonschema.ValidationError:
        valid = False
    check("body validates against the bundled schema", valid)
    check("source/ORIGINAL_SKILL.md equals SKILL.md", (AIP / "source" / "ORIGINAL_SKILL.md").read_text() == (ROOT / "SKILL.md").read_text())

    steps = {s["name"]: s for s in doc["steps"]}
    check("step names unique", len(steps) == len(doc["steps"]))
    for proc, count in COUNTS.items():
        n = sum(1 for name in steps if name.startswith(proc + "-"))
        check(f"{proc.upper()} has {count} steps (found {n})", n == count)
    check("every step is a P0..P4 node", len(steps) == sum(COUNTS.values()))
    check("scripts exist", all((AIP / s["script"]).is_file() for s in steps.values() if "script" in s))
    for proc, kinds in KINDS.items():
        got = "".join("S" if "script" in s else "A" for name, s in steps.items() if name.startswith(proc + "-"))
        check(f"{proc.upper()} step kinds {kinds} (found {got})", got == kinds)
    source = (ROOT / "SKILL.md").read_text()
    for proc, kinds in KINDS.items():
        section = re.search(rf"^## {proc.upper()} .*?(?=^## |\Z)", source, re.S | re.M).group(0)
        tags = "".join("S" if k == "script" else "A" for k in re.findall(r"^\d+\. (script|agent):", section, re.M))
        check(f"SKILL.md {proc.upper()} tags match ({tags})", tags == kinds)
        for step in steps.values():
            if step["name"].startswith(proc + "-"):
                n = int(step["name"].split("-")[1])
                kind = "script" if kinds[n - 1] == "S" else "agent"
                if f"{proc.upper()} step {n} ({kind})" not in step["description"]:
                    failures.append(f"{step['name']} description does not cite {proc.upper()} step {n} ({kind})")
    check("each node description cites its step and kind", not any("description does not cite" in f for f in failures))

    missing = [(n, d) for n, s in steps.items() for d in s.get("depends_on", []) if d not in steps]
    check("depends_on targets exist", not missing)
    entries = [n for n, s in steps.items() if not s.get("depends_on")]
    check("P0 step 1 is the only entry node", entries == ["p0-1-scan-infra-imports"])

    order, seen = [], set()

    def visit(name, stack=()):
        if name in stack:
            raise ValueError(f"cycle at {name}")
        if name in seen:
            return
        for dep in steps[name].get("depends_on", []):
            visit(dep, stack + (name,))
        seen.add(name)
        order.append(name)

    try:
        for name in steps:
            visit(name)
        check("graph is acyclic", True)
    except ValueError as error:
        check(f"graph is acyclic ({error})", False)

    produced, bad = {}, []
    for name in order:
        step = steps[name]
        ancestors, todo = set(), list(step.get("depends_on", []))
        while todo:
            a = todo.pop()
            if a not in ancestors:
                ancestors.add(a)
                todo += steps[a].get("depends_on", [])
        available = {o["name"] for a in ancestors for o in steps[a].get("outputs", [])}
        for item in step.get("inputs", []):
            if item["name"] not in available | COMPANION_INPUTS:
                bad.append((name, item["name"]))
        for item in step.get("inputs", []) + step.get("outputs", []):
            if "type" not in item:
                bad.append((name, item["name"] + " untyped"))
        for item in step.get("outputs", []):
            if item["name"] in produced:
                bad.append((name, item["name"] + " produced twice"))
            produced[item["name"]] = name
    check("inputs resolve and edges are typed" + (f" {bad}" if bad else ""), not bad)
    def numbered(heading, start=1):
        section = re.search(rf"^# {heading}\n(.*?)(?=^# |\Z)", source, re.S | re.M).group(1)
        return [int(n) for n in re.findall(r"^(\d+)\. ", section, re.M)]

    problems, rules, failure_modes = numbered("Problem"), numbered("Rules"), numbered("Failure modes")
    check(f"{len(problems)} problems in trigger_when", len(doc["trigger_when"]) == len(problems) == 4)
    check(f"{len(failure_modes)} failure modes in anti_patterns", len(doc["anti_patterns"]) == len(failure_modes) == 9)
    check(f"{len(rules)} rules in scope_and_approval", re.findall(r"Rule (\d+):", doc["scope_and_approval"]) == [str(n) for n in rules] == [str(n) for n in range(1, 10)])
    not_needed = re.search(r"^# Not needed when\n\n(.*?)\n", source, re.S | re.M).group(1)
    check("2 not-needed-when sentences in do_not_use_when", len(re.findall(r"[^.]+\.", not_needed)) == len(doc["do_not_use_when"]) == 2)
    # every number a step cites exists in the source
    cited = re.findall(r"\b(problems?|rules?) ([\d, -]+\d)", source + "\n" + body, re.I)
    bad_cites = []
    for kind, numbers in cited:
        pool = problems if kind.lower().startswith("problem") else rules
        for part in re.split(r",\s*", numbers):
            lo, _, hi = part.partition("-")
            for n in range(int(lo), int(hi or lo) + 1):
                if n not in pool:
                    bad_cites.append(f"{kind} {n}")
    check("every cited problem and rule number exists" + (f" {bad_cites}" if bad_cites else ""), not bad_cites)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
