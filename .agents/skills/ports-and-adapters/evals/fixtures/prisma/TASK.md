Add the use case `order_summary(order_id)`: it loads the order from the order store (the `prismalike` client, `Client(url).order_find_unique({"id": order_id})` returning an `OrderModel`) and returns the domain `Order` (total in decimal currency units, status as `OrderStatus`).
Acceptance criteria:
- Given a stored order with totalCents 1999 and statusCode 1, when the summary runs, then it returns an Order with total 19.99 and status PAID.
- Given an unknown order id, when the summary runs, then it raises `LookupError`.
