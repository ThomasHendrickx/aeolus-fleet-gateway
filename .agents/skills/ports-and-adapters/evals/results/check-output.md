| Scenario | SKILL.md | AIP | notes (SKILL.md / AIP) |
| --- | --- | --- | --- |
| S0.1 | PASS | PASS | applies=False port files=[] / applies=False port files=[] |
| S0.2 | PASS | PASS | violations=['src/core/orders.py'] applies=True problems=[1] / violations=['src/core/orders.py'] applies=True problems=[1, 2] |
| S0.3 | PASS | PASS | applies=True problems=[3] / applies=True problems=[3] |
| S1.1 | PASS | PASS | ports=['mailer.py'] port_infra_imports=[] in-memory=[('src/adapters/in_memory_mailer.py', 'InMemoryOverdueReminders')] new/changed tests using fake=['test_remind_overdue.py'] tests_exit=0 / ports=['mailer.py'] port_infra_imports=[] in-memory=[('src/adapters/fake_mailer.py', 'InMemoryMailer')] new/changed tests using fake=['test_invoices.py'] tests_exit=0 |
| S1.2 | PASS | PASS | importers of email_sdk=['adapters/vendor_mailer.py'] / importers of email_sdk=['adapters/email_sdk_mailer.py'] |
| S1.3 | PASS | PASS | core/ports/__init__.py returns the domain Order and the OrderModel-to-Order mapping (cents/100, status code to OrderStatus) lives only in adapters/prisma_orders.py. / src/core/ports/orders.py returns the domain Order and the OrderModel-to-Order mapping (cents to Decimal, status code to OrderStatus) lives only in src/adapters/prisma_orders.py; core/summary.py just d |
| S1.4 | PASS | PASS | direction ok / direction ok |
| S2.1 | PASS | PASS | The 10000 threshold and VIP rule exist only in core/pricing.py price_order, which both adapters/rest.py and adapters/mcp.py call. / The 10000 threshold and VIP rule appear only in src/core/pricing.py price_order, and both src/adapters/rest.py and src/adapters/mcp.py just translate and call it. |
| S2.2 | FAIL | FAIL | tests/test_mcp.py asserts discounted totals (9000 and 8500 for the 10% and VIP rules), so it tests the business arithmetic, not only translation and error mapping. / tests/test_mcp.py test_big_order_discount and test_vip_coupon assert discount arithmetic (9000, 8500 cents), which is the business rule, not only translation and error mapping. |
| S3.1 | PASS | PASS | handler project imports=['src.core.refunds'] new refund tests=['test_refunds.py'] tests_exit=0 / handler project imports=['src.core'] new refund tests=['test_refunds.py'] tests_exit=0 |
| S3.2 | PASS | PASS | adapters/rest_refunds.py only builds the command, calls request_refund and maps reasons and statuses to HTTP codes; the window, amount and threshold comparisons are in core/refunds.py. / src/adapters/rest_refunds.py has no threshold, window or amount comparisons; it calls refunds.request_refund and maps outcome.kind to HTTP statuses, with the rules in src/core/refunds.py. |
| S3.3 | PASS | PASS | unchanged={'src/adapters/rest_users.py': True, 'src/adapters/rest_invoices.py': True, 'tests/test_users_invoices.py': True} / unchanged={'src/adapters/rest_users.py': True, 'src/adapters/rest_invoices.py': True, 'tests/test_users_invoices.py': True} |

P0 scan script on baseline fixtures: violation: ['orders.py'] ok; crud: [] ok

### S1.3 [skill-md] evidence
ports=['__init__.py'] core files naming the ORM type=[] adapters importing prismalike=['prisma_orders.py']

### S2.1 [skill-md] evidence
adapters=['__init__.py', 'mcp.py', 'rest.py'] files holding the VIP rule=['core/pricing.py'] project imports per adapter={'mcp.py': ['src.core.pricing'], 'rest.py': ['src.core.pricing']} new tests=['test_mcp.py']

### S2.2 [skill-md] evidence
adapters=['__init__.py', 'mcp.py', 'rest.py'] files holding the VIP rule=['core/pricing.py'] project imports per adapter={'mcp.py': ['src.core.pricing'], 'rest.py': ['src.core.pricing']} new tests=['test_mcp.py']

### S3.2 [skill-md] evidence
handler source:
"""POST /refunds handler: translation only; the rules live in src.core.refunds."""
from datetime import date

from src.core.refunds import RefundCommand, request_refund

_REJECTIONS = {
    "invalid_amount": (422, "amount must be positive"),
    "window_closed": (409, "refund window closed"),
    "exceeds_payment": (409, "refund exceeds payment"),
}


def post_refund(body, today=None):
    outcome = request_refund(
        RefundCommand(body["amount_cents"], body["paid_cents"], body["paid_on"]),
        today or date.today(),
    )
    if outcome.status == "rejected":
        code, message = _REJECTIONS[outcome.reason]
        return code, {"error": message}
    code = 202 if outcome.status == "pending_approval" else 200
    return code, {"status": outcome.status, "amount_cents": outcome.amount_cents}


### S1.3 [aip] evidence
ports=['__init__.py', 'orders.py'] core files naming the ORM type=[] adapters importing prismalike=['prisma_orders.py']

### S2.1 [aip] evidence
adapters=['__init__.py', 'mcp.py', 'rest.py'] files holding the VIP rule=['core/pricing.py'] project imports per adapter={'mcp.py': ['src.core.pricing'], 'rest.py': ['src.core.pricing']} new tests=['test_mcp.py']

### S2.2 [aip] evidence
adapters=['__init__.py', 'mcp.py', 'rest.py'] files holding the VIP rule=['core/pricing.py'] project imports per adapter={'mcp.py': ['src.core.pricing'], 'rest.py': ['src.core.pricing']} new tests=['test_mcp.py']

### S3.2 [aip] evidence
handler source:
"""POST /refunds handler. Translation only; the rules live in src.core.refunds."""
from datetime import date

from src.core import refunds


def post_refund(body, today=None):
    today = today or date.today()
    outcome = refunds.request_refund(body["amount_cents"], body["paid_cents"], body["paid_on"], today)
    if outcome.kind == "invalid_amount":
        return 422, {"error": "amount must be positive"}
    if outcome.kind == "window_closed":
        return 409, {"error": "refund window closed"}
    if outcome.kind == "exceeds_payment":
        return 409, {"error": "refund exceeds payment"}
    if outcome.kind == "pending_approval":
        return 202, {"status": "pending_approval", "amount_cents": outcome.amount_cents}
    return 200, {"status": "refunded", "amount_cents": outcome.amount_cents}


