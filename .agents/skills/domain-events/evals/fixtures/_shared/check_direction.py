#!/usr/bin/env python3
"""Fixture dependency-direction check: a context's core imports no infra module, nothing outward, and no other context."""
import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
infra = re.search(r"^infraModules: (.*)$", (ROOT / "COMPANION.md").read_text(), re.M).group(1).split()
CONTEXTS = ("sales", "shipping")
bad = []
for context in CONTEXTS:
    outward = ("src.main", "src.db", f"src.{context}.adapters") + tuple(f"src.{c}" for c in CONTEXTS if c != context)
    for path in sorted((ROOT / "src" / context / "core").rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text())):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else (
                [node.module or ""] if isinstance(node, ast.ImportFrom) and node.level == 0 else [])
            for name in names:
                if any(name == m or name.startswith(m + ".") for m in outward + tuple(infra)):
                    bad.append(f"{path.relative_to(ROOT)} imports {name}")
print("\n".join(bad) or "direction ok")
sys.exit(1 if bad else 0)
