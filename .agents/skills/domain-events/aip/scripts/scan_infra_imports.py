#!/usr/bin/env python3
"""Print domain and use-case modules that import a bus, mail or third-party client (rule 2).

Usage: scan_infra_imports.py DIR [DIR ...] --infra MODULE [MODULE ...]
  DIR: paths.domain (domain model and use cases), run from the repo root.
  MODULE: infraModules, dotted module names (a name also covers its submodules).
Imports are parsed with ast; relative imports resolve against the importing file's package.
Prints {"violations": [{"path", "imports", "rule"}]}.
"""
import argparse
import ast
import json
from pathlib import Path


def dotted(directory):
    """Dotted module name of a directory, counted from its topmost package (the first parent without __init__.py)."""
    directory = Path(directory).resolve()
    parts = [directory.name]
    parent = directory.parent
    while (parent / "__init__.py").is_file():
        parts.insert(0, parent.name)
        parent = parent.parent
    return ".".join(parts)


def imported(path):
    """Every module name the file imports, relative imports resolved; `from a import b` also yields `a.b`."""
    tree = ast.parse(path.read_text(), filename=str(path))
    package = dotted(path.parent).split(".")
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names += [item.name for item in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base = package[: len(package) - node.level + 1]
                module = ".".join(base + ([node.module] if node.module else []))
            else:
                module = node.module or ""
            names.append(module)
            names += [f"{module}.{item.name}" for item in node.names]
    return names


def inside(name, prefix):
    return name == prefix or name.startswith(prefix + ".")


def main():
    parser = argparse.ArgumentParser(usage=__doc__)
    parser.add_argument("dirs", nargs="+")
    parser.add_argument("--infra", nargs="+", required=True)
    args = parser.parse_args()
    violations = []
    for directory in args.dirs:
        for path in sorted(Path(directory).rglob("*.py")):
            hits = sorted({name for name in imported(path) if any(inside(name, m) for m in args.infra)})
            if hits:
                violations.append({"path": path.as_posix(), "imports": hits, "rule": 2})
    print(json.dumps({"violations": violations}))


if __name__ == "__main__":
    main()
