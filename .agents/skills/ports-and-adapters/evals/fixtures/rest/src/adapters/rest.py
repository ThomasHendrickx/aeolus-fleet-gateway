"""REST handler for pricing. The discount rules live here."""


def post_price(body):
    total = sum(item["cents"] * item["qty"] for item in body["items"])
    if total < 0:
        return 422, {"error": "negative total"}
    discount = 0.0
    if total >= 10000:
        discount += 0.10
    if body.get("coupon", "").startswith("VIP"):
        discount += 0.05
    return 200, {"total_cents": round(total * (1 - discount)), "discount": discount}
