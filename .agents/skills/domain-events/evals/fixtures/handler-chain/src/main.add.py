

def open_account(customer_id, email):
    from src.sales.core.accounts import CustomerAccount
    with PgSalesUnitOfWork() as uow:
        uow.accounts.add(CustomerAccount(customer_id, email))
