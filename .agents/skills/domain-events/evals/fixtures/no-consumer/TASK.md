Customers sometimes get an email receipt for a payment that then failed: `pay_invoice` sends the receipt while the payment is still being saved, and when saving fails (a concurrent update) the invoice stays unpaid. A receipt must go out only for a payment we really recorded.

People from other teams also keep asking Sales whether a given invoice was paid. Rather than answer each time, publish invoice payments on the message bus so that any team can pick them up whenever they need them. No team has asked to subscribe yet.
