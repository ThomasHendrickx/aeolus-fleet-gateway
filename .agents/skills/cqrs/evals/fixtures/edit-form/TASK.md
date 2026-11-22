Staff open an order's edit form, which shows the order number, status, shipping address, note and the customer's email so they can contact the customer. The form is `order_edit_form` in `src/web/staff_pages.py`.

Today the `Order` class carries the customer's email and a `to_form` method only for this screen, and every order load joins customers for it. Keep the form showing the same data while the `Order` model goes back to being about orders.
