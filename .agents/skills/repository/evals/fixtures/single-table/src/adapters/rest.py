from src.adapters import db


def handle(method, path, body=None):
    if (method, path) == ("GET", "/health"):
        return 200, {"ok": True}
    return 404, {"error": "not found"}
