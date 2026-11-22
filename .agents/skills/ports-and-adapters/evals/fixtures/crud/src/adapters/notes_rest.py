"""REST entry point for notes: plain CRUD over one sqlite table."""
import sqlite3

DB = sqlite3.connect(":memory:")
DB.execute("create table if not exists notes (id integer primary key, text text)")


def create_note(text):
    cur = DB.execute("insert into notes (text) values (?)", (text,))
    DB.commit()
    return {"id": cur.lastrowid, "text": text}


def get_note(note_id):
    row = DB.execute("select id, text from notes where id = ?", (note_id,)).fetchone()
    return {"id": row[0], "text": row[1]} if row else None
