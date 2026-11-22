import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "aip" / "scripts" / "scan_port_types.py"


class ScanPortTypesTest(unittest.TestCase):
    def test_finds_imported_orm_annotation_but_not_matching_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "leak.py").write_text("""from orm import Query
def find(q: Query): pass
""")
            (root / "comment.py").write_text("""# Query is only a comment
def find(q: str): pass
""")
            output = subprocess.check_output(["python3", "-I", str(SCRIPT), str(root), "orm"], text=True)
        self.assertEqual([str(root / "leak.py")], json.loads(output)["violations"])


if __name__ == "__main__":
    unittest.main()
