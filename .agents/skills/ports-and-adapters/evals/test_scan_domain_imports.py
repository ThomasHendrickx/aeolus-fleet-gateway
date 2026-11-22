#!/usr/bin/env python3
"""Unit tests: the P0 scan matches import statements only."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCAN = Path(__file__).parents[1] / "aip" / "scripts" / "scan_domain_imports.py"

HITS = {
    "a.py": "import email_sdk\n",
    "b.py": "from email_sdk.client import Client\n",
    "c.py": "import os, email_sdk as e\n",
    "d.py": "def f():\n    import email_sdk\n",
    "e.ts": "import { x } from 'email_sdk';\n",
    "f.ts": "import type { X } from \"email_sdk/types\";\n",
    "g.js": "const c = require('email_sdk');\n",
    "h.js": "import 'email_sdk';\n",
    "i.ts": "export * from 'email_sdk';\n",
    "j.ts": "const m = await import('email_sdk');\n",
    "k.go": 'package d\nimport "email_sdk"\n',
    "l.go": 'package d\nimport (\n\t"fmt"\n\tsdk "email_sdk/v2"\n)\n',
    "m.ts": "import {\n  a,\n  b,\n} from 'email_sdk';\n",
}
MISSES = {
    "comment.py": "# import email_sdk\nx = 1\n",
    "string.py": "NAME = 'email_sdk'\nDOC = \"import email_sdk\"\n",
    "docstring.py": '"""Uses email_sdk."""\nx = 1\n',
    "prefix.py": "import email_sdk_fake\nfrom email_sdkx import y\n",
    "relative.py": "from .email_sdk import y\n",
    "comment.ts": "// import x from 'email_sdk'\n/* require('email_sdk') */\nconst a = 1;\n",
    "string.ts": "const s = \"import x from 'email_sdk'\";\n",
    "prefix.ts": "import x from 'email_sdk_fake';\n",
    "text.md": "import email_sdk\n",
    "comment.go": 'package d\n// import "email_sdk"\n',
}


def scan(root, *modules):
    out = subprocess.check_output([sys.executable, "-I", str(SCAN), str(root), *modules], text=True)
    return {Path(p).name for p in json.loads(out)["violations"]}


class ScanTest(unittest.TestCase):
    def test_import_statements_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name, text in {**HITS, **MISSES}.items():
                (Path(tmp) / name).write_text(text)
            self.assertEqual(scan(tmp, "email_sdk"), set(HITS))


if __name__ == "__main__":
    unittest.main()
