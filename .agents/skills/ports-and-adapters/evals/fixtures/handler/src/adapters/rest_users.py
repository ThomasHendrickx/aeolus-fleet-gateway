"""POST /users handler. Also holds its rules (not touched by the task)."""


def post_user(body):
    email = body.get("email", "")
    if "@" not in email:
        return 422, {"error": "bad email"}
    if len(body.get("name", "")) < 2:
        return 422, {"error": "name too short"}
    return 201, {"email": email.lower(), "name": body["name"].strip()}
