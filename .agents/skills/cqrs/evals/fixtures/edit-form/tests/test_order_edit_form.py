from src.web.staff_pages import order_edit_form
from tests.support import DbTest


class OrderEditFormTest(DbTest):
    def test_form_shows_order_and_customer_email(self):
        self.customer("ann")
        self.order("o1", "ann", number="N-7")
        form = order_edit_form("o1")
        self.assertEqual(form["number"], "N-7")
        self.assertEqual(form["customer_email"], "ann@example.com")
        self.assertEqual(form["city"], "Ghent")
