#!/usr/bin/env python3
"""Print query modules that import the domain, and command-side modules that import the queries (rules 4, 9).

Usage: scan_query_imports.py DOMAIN_DIR QUERIES_DIR  (paths.domain and paths.queries, run from the repo root)
Command handlers are the modules under paths.domain (the domain model and its use cases).
Imports are parsed with ast; relative imports resolve against the importing file's package.
Prints {"violations": [{"path", "imports", "rule"}]}.
"""
import ast
import json
import sys
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


def module_of(path):
    package = dotted(path.parent)
    return package if path.name == "__init__.py" else f"{package}.{path.stem}"


def imported(path):
    """Every module name the file imports, relative imports resolved."""
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


def scan(source_dir, forbidden_dir, rule):
    prefix = dotted(forbidden_dir)
    found = []
    for path in sorted(Path(source_dir).rglob("*.py")):
        hits = sorted({name for name in imported(path) if inside(name, prefix)})
        if hits:
            found.append({"path": path.as_posix(), "imports": hits, "rule": rule})
    return found


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    domain, queries = sys.argv[1], sys.argv[2]
    violations = scan(queries, domain, 4) + scan(domain, queries, 9)
    print(json.dumps({"violations": violations}))


if __name__ == "__main__":
    main()
