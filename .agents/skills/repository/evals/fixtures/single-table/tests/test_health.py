import unittest

from src.adapters import rest


class HealthTest(unittest.TestCase):
    def test_health(self):
        self.assertEqual((200, {"ok": True}), rest.handle("GET", "/health"))

    def test_unknown(self):
        self.assertEqual(404, rest.handle("GET", "/nope")[0])


if __name__ == "__main__":
    unittest.main()
