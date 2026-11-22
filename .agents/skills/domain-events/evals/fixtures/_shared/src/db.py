"""Postgres connection. The database URL is in database.url at the repo root (or EVENTS_DSN)."""
import os
from pathlib import Path

import psycopg

ROOT = Path(__file__).parents[1]


def dsn():
    return os.environ.get("EVENTS_DSN") or (ROOT / "database.url").read_text().strip()


def connect(**kwargs):
    return psycopg.connect(dsn(), **kwargs)


def reset_schema():
    """Drop everything and apply schema.sql. Tests call this; never run it against a real database."""
    with connect() as conn:
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")
        conn.execute((ROOT / "schema.sql").read_text())
