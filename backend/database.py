
import sqlite3
from contextlib import closing
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "approval_portal.db"


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with closing(get_connection()) as conn:
        conn.executescript((BASE_DIR / "schema.sql").read_text())
        conn.commit()


if __name__ == "__main__":
    init_db()
    print(f"Database initialised: {DB_PATH}")
