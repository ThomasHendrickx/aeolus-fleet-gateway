import sqlite3

from src.adapters import schema
from src.adapters.sqlite_orders import SqliteOrders

conn = schema.connect()
orders = SqliteOrders(conn)
