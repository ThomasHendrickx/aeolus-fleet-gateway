from src.adapters import notes_rest

ROUTES = {"POST /notes": notes_rest.create_note, "GET /notes": notes_rest.get_note}
