"""Mail client. Sending is immediate and outside any database transaction (the server keeps sent_mail)."""
from src.db import connect


def send(to_address: str, subject: str, body: str) -> None:
    with connect(autocommit=True) as conn:
        conn.execute("INSERT INTO sent_mail (to_address, subject, body) VALUES (%s, %s, %s)", (to_address, subject, body))
