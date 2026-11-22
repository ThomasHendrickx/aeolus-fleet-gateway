#!/usr/bin/env python3
"""Print ports whose annotations mention one of the supplied infrastructure modules.

Usage: scan_port_types.py PORTS_DIR INFRA_MODULE [INFRA_MODULE ...]
"""
import ast
import json
import sys
from pathlib import Path


def dotted(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = dotted(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    if isinstance(node, ast.Subscript):
        return dotted(node.value) or dotted(node.slice)
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return ""


def main():
    root, modules = Path(sys.argv[1]), set(sys.argv[2:])
    violations = []
    for path in sorted(root.rglob("*.py")):
        tree = ast.parse(path.read_text(), filename=str(path))
        aliases = {}
        for node in tree.body:
            if isinstance(node, ast.Import):
                aliases.update({item.asname or item.name.split(".")[0]: item.name for item in node.names})
            elif isinstance(node, ast.ImportFrom) and node.module:
                aliases.update({item.asname or item.name: f"{node.module}.{item.name}" for item in node.names})
        annotations = [arg.annotation for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                       for arg in [*node.args.args, *node.args.kwonlyargs] if arg.annotation] + [
                           node.returns for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.returns]
        names = {dotted(annotation) for annotation in annotations}
        resolved = {aliases.get(name.split(".")[0], name.split(".")[0]) for name in names}
        if any(any(name == module or name.startswith(module + ".") for name in resolved) for module in modules):
            violations.append(str(path))
    print(json.dumps({"violations": violations}))


if __name__ == "__main__":
    main()
