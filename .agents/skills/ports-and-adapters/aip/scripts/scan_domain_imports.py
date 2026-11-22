#!/usr/bin/env python3
"""List files under a domain path whose import statements name an infra module.

Usage: scan_domain_imports.py DOMAIN_DIR INFRA_MODULE [INFRA_MODULE ...]
Prints {"violations": [path, ...]}. Only import statements count (Python, JS/TS, Go);
comments, strings and other text never match. A module matches itself and its
submodules (`a` matches `a`, `a.b`, `a/b`), not names that merely start with it.
"""
import argparse
import ast
import json
import re
from pathlib import Path

JS = {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"}
JS_IMPORT = re.compile(
    r"""(?:^|[;{}\s])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\bfrom\s*)?(['"])([^'"\n]+)\1"""
    r"""|\brequire\s*\(\s*(['"])([^'"\n]+)\3\s*\)"""
    r"""|\bimport\s*\(\s*(['"])([^'"\n]+)\5\s*\)"""
)
GO_IMPORT = re.compile(r'^\s*import\s*(?:\(([^)]*)\)|(?:[\w.]+\s+)?"([^"]+)")', re.M)
GO_PATH = re.compile(r'"([^"]+)"')


def strip_comments(text, line_markers, block=("/*", "*/")):
    """Drop comments but keep string literals (and newlines) intact."""
    out, i, n = [], 0, len(text)
    while i < n:
        ch = text[i]
        if ch in "\"'`":
            j = i + 1
            while j < n and text[j] != ch:
                j += 2 if text[j] == "\\" else 1
            out.append(text[i:j + 1])
            i = j + 1
        elif any(text.startswith(m, i) for m in line_markers):
            while i < n and text[i] != "\n":
                i += 1
        elif block and text.startswith(block[0], i):
            end = text.find(block[1], i + 2)
            end = n if end < 0 else end + 2
            out.append("\n" * text.count("\n", i, end))
            i = end
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def python_imports(text):
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return []
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names += [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.append(node.module)
    return names


def js_imports(text):
    code = strip_comments(text, ("//",))
    return [m[1] or m[3] or m[5] for m in JS_IMPORT.findall(code)]


def go_imports(text):
    code = strip_comments(text, ("//",))
    names = []
    for block, single in GO_IMPORT.findall(code):
        names += GO_PATH.findall(block) if block else [single]
    return names


def imports_of(path):
    suffix = path.suffix
    if suffix not in JS | {".py", ".go"}:
        return []
    try:
        text = path.read_text()
    except UnicodeDecodeError:
        return []
    if suffix == ".py":
        return python_imports(text)
    return go_imports(text) if suffix == ".go" else js_imports(text)


def matches(name, module):
    return name == module or name.startswith((module + ".", module + "/"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("domain")
    parser.add_argument("infra_module", nargs="+")
    args = parser.parse_args()
    violations = sorted(
        str(path)
        for path in Path(args.domain).rglob("*")
        if path.is_file()
        and any(matches(name, module) for name in imports_of(path) for module in args.infra_module)
    )
    print(json.dumps({"violations": violations}))


if __name__ == "__main__":
    main()
