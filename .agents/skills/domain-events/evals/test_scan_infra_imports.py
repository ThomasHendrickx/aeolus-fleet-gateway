"""Unit test for aip/scripts/scan_infra_imports.py, with cases a substring search gets wrong."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCAN = Path(__file__).parents[1] / "aip" / "scripts" / "scan_infra_imports.py"

FILES = {
    "src/__init__.py": "",
    "src/infra/__init__.py": "",
    "src/infra/bus.py": "",
    "src/infra/busy.py": "",
    "src/sales/__init__.py": "",
    "src/sales/core/__init__.py": "",
    "src/sales/core/commands/__init__.py": "",
    # a relative import of the bus client; no "src.infra.bus" text appears in the file
    "src/sales/core/commands/pay.py": "from ....infra import bus\n",
    # the package form: `from src.infra import bus`
    "src/sales/core/commands/cancel.py": "from src.infra import bus\n",
    # a third-party mail client
    "src/sales/core/receipts.py": "import smtplib\n",
    # clean: the client named only in a docstring, a comment and a string; a module whose name merely starts with "bus"
    "src/sales/core/invoices.py": '"""Never import src.infra.bus here."""\n# import smtplib\nTOPIC = "src.infra.bus"\nfrom src.infra import busy\n',
    "src/shipping/__init__.py": "",
    "src/shipping/core/__init__.py": "",
    # an absolute import in a second domain directory
    "src/shipping/core/notify.py": "import src.infra.bus as b\n",
}


class ScanTest(unittest.TestCase):
    def test_structure_not_text(self):
        with tempfile.TemporaryDirectory() as root:
            for name, text in FILES.items():
                path = Path(root) / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
            out = subprocess.run([sys.executable, "-I", str(SCAN), "src/sales/core", "src/shipping/core", "--infra", "src.infra.bus", "smtplib"],
                                 cwd=root, capture_output=True, text=True, check=True).stdout
            found = {v["path"] for v in json.loads(out)["violations"]}
            self.assertEqual(found, {
                "src/sales/core/commands/pay.py",
                "src/sales/core/commands/cancel.py",
                "src/sales/core/receipts.py",
                "src/shipping/core/notify.py",
            })


if __name__ == "__main__":
    unittest.main()
