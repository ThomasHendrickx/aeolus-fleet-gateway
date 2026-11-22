from src.db import connect


def customer_card(customer_id):
    """Name and email for the order page header. Reads the table only; nothing from src.core.customers."""
    with connect() as conn:
        name, email = conn.execute("SELECT name, email FROM customers WHERE id = %s", (customer_id,)).fetchone()
    return {"name": name, "email": email}
