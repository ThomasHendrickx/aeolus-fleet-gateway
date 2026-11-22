"""POST /invoices handler. Also holds its rules (not touched by the task)."""


def post_invoice(body):
    if not body["lines"]:
        return 422, {"error": "no lines"}
    total = sum(line["cents"] for line in body["lines"])
    tax = round(total * 0.21)
    return 201, {"total_cents": total + tax, "tax_cents": tax}
