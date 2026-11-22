#!/usr/bin/env python3
"""Fixture dependency-direction check: the core imports no infra module and nothing outward."""
import ast
import re
import sys
from pathlib import Path

companion = Path(__file__).with_name("COMPANION.md").read_text()
infra = re.search(r"^infraModules: (.*)$", companion, re.M).group(1).split()
core = Path(__file__).parent / "src" / "core"
bad = []
for path in sorted(core.rglob("*.py")):
    for node in ast.walk(ast.parse(path.read_text())):
        names = [a.name for a in node.names] if isinstance(node, ast.Import) else (
            [node.module or ""] if isinstance(node, ast.ImportFrom) and node.level == 0 else [])
        for name in names:
            outward = name.startswith(("src.adapters", "src.main"))
            if outward or any(name == m or name.startswith(m + ".") for m in infra):
                bad.append(f"{path.relative_to(core.parent.parent)} imports {name}")
print("\n".join(bad) or "direction ok")
sys.exit(1 if bad else 0)
