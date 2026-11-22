"""Composition root: wires use cases and reads to Postgres. The web handlers in src/web call these."""
from src.adapters.pg_unit_of_work import PgUnitOfWork
from src.core.commands.place_order import place_order as _place_order
from src.core.commands.register_customer import register_customer as _register_customer
from src.core.commands.ship_order import ship_order as _ship_order


def place_order(*args, **kwargs):
    return _place_order(PgUnitOfWork(), *args, **kwargs)


def ship_order(order_id):
    return _ship_order(PgUnitOfWork(), order_id)


def register_customer(*args, **kwargs):
    return _register_customer(PgUnitOfWork(), *args, **kwargs)
