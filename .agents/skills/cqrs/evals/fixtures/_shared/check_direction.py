#!/usr/bin/env python3
"""Fixture dependency-direction check: src/core imports no infra module and nothing outward."""
import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
infra = re.search(r"^infraModules: (.*)$", (ROOT / "COMPANION.md").read_text(), re.M).group(1).split()
OUTWARD = ("src.adapters", "src.web", "src.main", "src.db")
bad = []
for path in sorted((ROOT / "src" / "core").rglob("*.py")):
    for node in ast.walk(ast.parse(path.read_text())):
        names = [a.name for a in node.names] if isinstance(node, ast.Import) else (
            [node.module or ""] if isinstance(node, ast.ImportFrom) and node.level == 0 else [])
        for name in names:
            if name.startswith(OUTWARD) or any(name == m or name.startswith(m + ".") for m in infra):
                bad.append(f"{path.relative_to(ROOT)} imports {name}")
print("\n".join(bad) or "direction ok")
sys.exit(1 if bad else 0)
