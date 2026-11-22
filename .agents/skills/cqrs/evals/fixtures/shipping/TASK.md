Customers' "My orders" page (`my_orders_page` in `src/web/customer_pages.py`) shows each order's shipping status: pending, or dispatched with carrier and date. Shipping is another team's bounded context (`src/shipping`). They are moving their tables to their own database next quarter and have asked every other context to stop reading the `shipments` table; today the page's query joins straight into it.

Keep the shipping status on the page. A customer who just got the dispatch email and opens the page expects to see it dispatched.
