#!/usr/bin/env python3
"""Validate aip/SKILL.md against its bundled schema and check the graph.

Needs pyyaml and jsonschema. The pinned-compiler validate.py run is recorded separately in results/validate-aip.txt.
Checks: bundled schema, source/ORIGINAL_SKILL.md equals SKILL.md, P0..P3 step counts (3, 7, 5, 5),
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
COMPANION_INPUTS = {"paths.domain", "paths.ports", "paths.adapters", "paths.compositionRoot",
                    "checks.dependencyDirection", "checks.contractTests", "infraModules", "task"}
COUNTS = {"p0": 3, "p1": 7, "p2": 5, "p3": 5}


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
    check("every step is a P0..P3 node", len(steps) == sum(COUNTS.values()))
    check("scripts exist", all((AIP / s["script"]).is_file() for s in steps.values() if "script" in s))
    check("four script steps", sum("script" in s for s in steps.values()) == 4)

    missing = [(n, d) for n, s in steps.items() for d in s.get("depends_on", []) if d not in steps]
    check("depends_on targets exist", not missing)
    entries = [n for n, s in steps.items() if not s.get("depends_on")]
    check("P0 step 1 is the only entry node", entries == ["p0-1-scan-port-types"])

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
    check("4 problems in trigger_when", len(doc["trigger_when"]) == 4)
    check("6 failure modes in anti_patterns", len(doc["anti_patterns"]) == 6)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
