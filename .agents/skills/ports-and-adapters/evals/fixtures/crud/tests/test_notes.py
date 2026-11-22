import unittest

from src.adapters import notes_rest


class NotesTest(unittest.TestCase):
    def test_create_then_get(self):
        note = notes_rest.create_note("hi")
        self.assertEqual(notes_rest.get_note(note["id"])["text"], "hi")
