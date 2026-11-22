"""POST /refunds handler. The refund rules live here."""
from datetime import date


def post_refund(body, today=None):
    today = today or date.today()
    if body["amount_cents"] <= 0:
        return 422, {"error": "amount must be positive"}
    if (today - body["paid_on"]).days > 30:
        return 409, {"error": "refund window closed"}
    if body["amount_cents"] > body["paid_cents"]:
        return 409, {"error": "refund exceeds payment"}
    return 200, {"status": "refunded", "amount_cents": body["amount_cents"]}
