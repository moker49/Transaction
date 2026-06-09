from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = ROOT / "data" / "transactions.sqlite"
SCHEMA_PATH = ROOT / "db" / "schema.sql"
EXPECTED_ACCOUNT_COLUMNS = {"id", "institution_id", "name", "account_type", "currency", "external_account_id", "created_at", "updated_at"}
EXPECTED_TABLES = {
    "accounts",
    "categories",
    "imported_source",
    "institutions",
    "raw_imported_rows",
    "tags",
    "transaction_import_rules",
    "transaction_notes",
    "transaction_tags",
    "transactions",
}
EXPECTED_TRANSACTION_COLUMNS = {
    "id",
    "account_id",
    "category_id",
    "posted_date",
    "transaction_date",
    "payee",
    "description",
    "amount_cents",
    "currency",
    "status",
    "external_transaction_id",
    "raw_imported_row_id",
    "created_at",
    "updated_at",
}
EXPECTED_RAW_IMPORTED_ROW_COLUMNS = {
    "id",
    "imported_source_id",
    "raw_account",
    "raw_date",
    "raw_type",
    "raw_category",
    "raw_description",
    "raw_amount",
    "parsed_transaction_id",
    "created_at",
    "reviewed",
}


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
    if not EXPECTED_TABLES.issubset(tables):
        return False

    account_columns = {row[1] for row in conn.execute("PRAGMA table_info(accounts)").fetchall()}
    transaction_columns = {row[1] for row in conn.execute("PRAGMA table_info(transactions)").fetchall()}
    raw_imported_row_columns = {row[1] for row in conn.execute("PRAGMA table_info(raw_imported_rows)").fetchall()}
    return (
        EXPECTED_ACCOUNT_COLUMNS.issubset(account_columns)
        and EXPECTED_TRANSACTION_COLUMNS.issubset(transaction_columns)
        and "imported_source_id" not in transaction_columns
        and "import_source_file_id" not in transaction_columns
        and "institution" not in account_columns
        and EXPECTED_RAW_IMPORTED_ROW_COLUMNS.issubset(raw_imported_row_columns)
        and "imported_source_files" not in tables
        and "import_id" not in raw_imported_row_columns
        and "imported_source_file_id" not in raw_imported_row_columns
        and "raw_json" not in raw_imported_row_columns
        and "raw_data_json" not in raw_imported_row_columns
        and "raw_row_text" not in raw_imported_row_columns
    )


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
