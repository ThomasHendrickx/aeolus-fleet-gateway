from datetime import date

from src.core.customers import Customer


def register_customer(uow, customer_id: str, name: str, email: str, created_on: date) -> str:
    with uow:
        uow.customers.save(Customer(customer_id, name, email, created_on))
    return customer_id
