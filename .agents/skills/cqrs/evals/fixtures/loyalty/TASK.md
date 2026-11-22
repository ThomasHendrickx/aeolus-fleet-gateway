The staff customer list shows name, email and loyalty tier, sorted by name, 25 per page. Gold means more than 10 orders that were not cancelled, unless the customer is suspended; everyone else is standard. The list is `customer_list` in `src/web/staff_pages.py`.

It loads every customer and then each customer's orders to work out the tier, and it has become unusable for staff. Rework the list so it stays fast as customers and orders grow; tiers must stay correct when orders are placed or cancelled and when customers are suspended or reinstated.
