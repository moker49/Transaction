from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = ROOT / "data" / "transactions.sqlite"
SCHEMA_PATH = ROOT / "db" / "schema.sql"
EXPECTED_ACCOUNT_COLUMNS = {"id", "institution_id", "name", "account_type", "currency", "external_account_id", "created_at", "updated_at"}


def init_db(db_path: Path = DEFAULT_DB_PATH, schema_path: Path = SCHEMA_PATH) -> Path:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    rebuild_empty_incompatible_db(db_path)

    schema = schema_path.read_text(encoding="utf-8")
    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(schema)

    return db_path


def rebuild_empty_incompatible_db(db_path: Path) -> None:
    if not db_path.exists():
        return

    conn = sqlite3.connect(db_path)
    try:
        existing_tables = get_user_tables(conn)
        if not existing_tables:
            return
        if schema_is_compatible(conn):
            return
        if has_user_rows(conn, existing_tables):
            raise RuntimeError(
                f"Existing database at {db_path} does not match db/schema.sql and contains data. "
                "Create a migration before running init."
            )
    finally:
        conn.close()

    db_path.unlink()


def get_user_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
        """
    ).fetchall()
    return [row[0] for row in rows]


def schema_is_compatible(conn: sqlite3.Connection) -> bool:
    tables = set(get_user_tables(conn))
    if "institutions" not in tables or "accounts" not in tables:
        return False

    account_columns = {row[1] for row in conn.execute("PRAGMA table_info(accounts)").fetchall()}
    return EXPECTED_ACCOUNT_COLUMNS.issubset(account_columns) and "institution" not in account_columns


def has_user_rows(conn: sqlite3.Connection, tables: Iterable[str]) -> bool:
    for table in tables:
        quoted_table = '"' + table.replace('"', '""') + '"'
        row = conn.execute(f"SELECT 1 FROM {quoted_table} LIMIT 1").fetchone()
        if row is not None:
            return True
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Initialize the transaction SQLite database.")
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"SQLite database path. Defaults to {DEFAULT_DB_PATH}",
    )
    parser.add_argument(
        "--schema",
        type=Path,
        default=SCHEMA_PATH,
        help=f"Schema SQL path. Defaults to {SCHEMA_PATH}",
    )
    args = parser.parse_args()

    try:
        db_path = init_db(args.db, args.schema)
    except RuntimeError as exc:
        print(f"error: {exc}")
        raise SystemExit(1) from exc

    print(f"Initialized database: {db_path}")


if __name__ == "__main__":
    main()
