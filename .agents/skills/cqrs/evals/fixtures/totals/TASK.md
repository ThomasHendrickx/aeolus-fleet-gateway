The staff customer totals page lists each customer with their number of orders and total spent (cancelled orders don't count), highest spender first, 20 per page, with an optional "at least N orders" filter. Staff also want the total number of matching customers shown above the pager, which the page lacks today.

The page is `customer_totals_page` in `src/web/staff_pages.py`. It works by loading every order, and we have far more orders than when it was written. Rework the page's read and add the count.
