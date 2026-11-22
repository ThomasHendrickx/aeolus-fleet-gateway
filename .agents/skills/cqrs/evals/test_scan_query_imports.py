"""Unit test for aip/scripts/scan_query_imports.py, with cases a substring search gets wrong."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCAN = Path(__file__).parents[1] / "aip" / "scripts" / "scan_query_imports.py"

FILES = {
    "src/__init__.py": "",
    "src/core/__init__.py": "",
    "src/core/orders.py": "class Order: ...\n",
    "src/core/commands/__init__.py": "",
    # rule 9: a relative import of the queries; no "src.queries" text appears in the file
    "src/core/commands/cancel.py": "from ...queries.status import order_status\n",
    # clean: mentions the queries only in a docstring and a comment
    "src/core/commands/place.py": '"""Never import src.queries here."""\n# from src.queries import x\nfrom src.core.orders import Order\n',
    "src/queries/__init__.py": "",
    # rule 4: an absolute import of the domain
    "src/queries/summary.py": "from src.core.orders import Order\n",
    # rule 4: a relative import of the domain
    "src/queries/detail.py": "from ..core import orders\n",
    # clean: the domain only in a string, and a module whose name merely starts with "core"
    "src/queries/status.py": 'SQL = "SELECT status FROM orders -- see src.core.orders"\nimport src.corelib\n',
    "src/corelib.py": "",
}


class ScanTest(unittest.TestCase):
    def test_structure_not_text(self):
        with tempfile.TemporaryDirectory() as root:
            for name, text in FILES.items():
                path = Path(root) / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
            out = subprocess.run([sys.executable, "-I", str(SCAN), "src/core", "src/queries"], cwd=root, capture_output=True, text=True, check=True).stdout
            found = {(v["path"], v["rule"]) for v in json.loads(out)["violations"]}
            self.assertEqual(found, {
                ("src/queries/summary.py", 4),
                ("src/queries/detail.py", 4),
                ("src/core/commands/cancel.py", 9),
            })


if __name__ == "__main__":
    unittest.main()
