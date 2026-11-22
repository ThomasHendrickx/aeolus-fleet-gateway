Customers place orders made of lines (sku, quantity, unit price in cents). An order's total has to match its lines. Order numbers are unique: placing a second order with a number that is taken must fail.

Staff also need to look at a customer's orders, most recent due date first, and open a single order with its lines.

Today `place_order` in `src/core/place_order.py` does the saving. Put orders and their lines on a proper footing so the above holds.
