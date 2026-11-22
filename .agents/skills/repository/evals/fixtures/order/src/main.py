from src.adapters.unit_of_work import SqliteUnitOfWork
from src.core.place_order import place_order

uow = SqliteUnitOfWork()
place = lambda *args: place_order(uow, *args)
