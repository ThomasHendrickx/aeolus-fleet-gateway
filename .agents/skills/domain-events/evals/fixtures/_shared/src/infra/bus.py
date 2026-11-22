"""Message-bus client. The broker stores messages in bus_messages; each call uses its own connection,
so a publish is never part of the caller's database transaction (as with any real broker)."""
from psycopg.types.json import Jsonb

from src.db import connect


def publish(topic: str, body: dict) -> None:
    with connect(autocommit=True) as conn:
        conn.execute("INSERT INTO bus_messages (topic, body) VALUES (%s, %s)", (topic, Jsonb(body)))


def fetch(topic: str, after_id: int = 0, limit: int = 100) -> list:
    """Messages on `topic` with id > after_id, oldest first, as (id, body) pairs."""
    with connect(autocommit=True) as conn:
        return conn.execute("SELECT id, body FROM bus_messages WHERE topic = %s AND id > %s ORDER BY id LIMIT %s",
                            (topic, after_id, limit)).fetchall()
