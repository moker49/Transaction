from __future__ import annotations

import argparse
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = ROOT / "data" / "transactions.sqlite"
SCHEMA_PATH = ROOT / "db" / "schema.sql"
EXPECTED_ACCOUNT_COLUMNS = {"id", "institution_id", "name", "account_type", "currency", "external_account_id", "created_at", "updated_at"}
EXPECTED_CATEGORY_COLUMNS = {"id", "name", "parent_id", "color", "created_at"}
EXPECTED_TABLES = {
    "accounts",
    "categories",
    "imported_source",
    "institutions",
    "logs",
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
    "transaction_type",
    "clean_description",
    "amount_cents",
    "currency",
    "status",
    "external_transaction_id",
    "raw_imported_row_id",
    "transaction_hash",
    "created_at",
    "updated_at",
}
EXPECTED_TRANSACTION_RULE_COLUMNS = {
    "id",
    "name",
    "match_field",
    "match_type",
    "match_value",
    "set_category_id",
    "set_clean_description",
    "set_transaction_type",
    "add_tag_id",
    "priority",
    "is_active",
    "created_at",
    "updated_at",
}
EXPECTED_IMPORTED_SOURCE_COLUMNS = {
    "id",
    "account_id",
    "filename",
    "source_type",
    "sha256",
    "imported_at",
    "row_count",
    "metadata_json",
}
EXPECTED_RAW_IMPORTED_ROW_COLUMNS = {
    "id",
    "imported_source_id",
    "raw_date",
    "raw_category",
    "raw_description",
    "raw_amount",
    "parsed_transaction_id",
    "import_status",
    "import_error",
    "raw_row_hash",
    "created_at",
    "updated_at",
}


def init_db(db_path: Path = DEFAULT_DB_PATH, schema_path: Path = SCHEMA_PATH) -> Path:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    rebuild_empty_incompatible_db(db_path)

    schema = schema_path.read_text(encoding="utf-8")
    with closing(sqlite3.connect(db_path)) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(schema)
        conn.commit()

    return db_path


def rebuild_empty_incompatible_db(db_path: Path) -> None:
    if not db_path.exists():
        return

    conn = sqlite3.connect(db_path)
    try:
        existing_tables = get_user_tables(conn)
        if not existing_tables:
            return
        migrate_existing_schema(conn, existing_tables)
        if schema_is_compatible(conn):
            return
        drop_user_tables(conn, existing_tables)
    finally:
        conn.close()


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


def drop_user_tables(conn: sqlite3.Connection, tables: Iterable[str]) -> None:
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        for table in tables:
            quoted_table = '"' + table.replace('"', '""') + '"'
            conn.execute(f"DROP TABLE IF EXISTS {quoted_table}")
        conn.commit()
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def migrate_existing_schema(conn: sqlite3.Connection, tables: Iterable[str]) -> None:
    table_set = set(tables)
    if "transactions" in table_set:
        transaction_columns = {row[1] for row in conn.execute("PRAGMA table_info(transactions)").fetchall()}
        if "transaction_type" not in transaction_columns:
            conn.execute(
                """
                ALTER TABLE transactions
                ADD COLUMN transaction_type TEXT NOT NULL DEFAULT 'splurge'
                    CHECK (transaction_type IN ('income', 'bill', 'splurge'))
                """
            )
        conn.execute(
            """
            UPDATE transactions
            SET transaction_type = CASE
                WHEN amount_cents > 0 THEN 'income'
                ELSE 'splurge'
            END
            WHERE transaction_type IS NULL
            """
        )
        transaction_columns = conn.execute("PRAGMA table_info(transactions)").fetchall()
        transaction_type_column = next((row for row in transaction_columns if row[1] == "transaction_type"), None)
        if transaction_type_column is not None and not int(transaction_type_column[3]):
            conn.commit()
            rebuild_transactions_with_required_type(conn)
            conn.commit()
    if "transaction_import_rules" in table_set:
        rule_columns = {row[1] for row in conn.execute("PRAGMA table_info(transaction_import_rules)").fetchall()}
        if "set_transaction_type" not in rule_columns:
            conn.execute(
                """
                ALTER TABLE transaction_import_rules
                ADD COLUMN set_transaction_type TEXT
                    CHECK (set_transaction_type IS NULL OR set_transaction_type IN ('income', 'bill', 'splurge'))
                """
            )
    if "categories" in table_set:
        category_columns = {row[1] for row in conn.execute("PRAGMA table_info(categories)").fetchall()}
        if "color" not in category_columns:
            conn.execute("ALTER TABLE categories ADD COLUMN color TEXT")
    conn.commit()


def rebuild_transactions_with_required_type(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.execute("DROP TABLE IF EXISTS transactions_rebuild")
        conn.execute(
            """
            CREATE TABLE transactions_rebuild (
                id INTEGER PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
                category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
                posted_date TEXT NOT NULL,
                transaction_date TEXT,
                transaction_type TEXT NOT NULL,
                clean_description TEXT,
                amount_cents INTEGER NOT NULL,
                currency TEXT NOT NULL DEFAULT 'USD',
                status TEXT NOT NULL DEFAULT 'posted',
                external_transaction_id TEXT,
                raw_imported_row_id INTEGER REFERENCES raw_imported_rows(id) ON DELETE SET NULL,
                transaction_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                CHECK (transaction_type IN ('income', 'bill', 'splurge')),
                CHECK (status IN ('pending', 'posted', 'void')),
                UNIQUE (account_id, external_transaction_id),
                UNIQUE (account_id, transaction_hash)
            )
            """
        )
        conn.execute(
            """
            INSERT INTO transactions_rebuild (
                id,
                account_id,
                category_id,
                posted_date,
                transaction_date,
                transaction_type,
                clean_description,
                amount_cents,
                currency,
                status,
                external_transaction_id,
                raw_imported_row_id,
                transaction_hash,
                created_at,
                updated_at
            )
            SELECT
                id,
                account_id,
                category_id,
                posted_date,
                transaction_date,
                COALESCE(transaction_type, CASE WHEN amount_cents > 0 THEN 'income' ELSE 'splurge' END),
                clean_description,
                amount_cents,
                currency,
                status,
                external_transaction_id,
                raw_imported_row_id,
                transaction_hash,
                created_at,
                updated_at
            FROM transactions
            """
        )
        conn.execute("DROP TABLE transactions")
        conn.execute("ALTER TABLE transactions_rebuild RENAME TO transactions")
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def schema_is_compatible(conn: sqlite3.Connection) -> bool:
    tables = set(get_user_tables(conn))
    if not EXPECTED_TABLES.issubset(tables):
        return False

    account_columns = {row[1] for row in conn.execute("PRAGMA table_info(accounts)").fetchall()}
    category_columns = {row[1] for row in conn.execute("PRAGMA table_info(categories)").fetchall()}
    transaction_columns = {row[1] for row in conn.execute("PRAGMA table_info(transactions)").fetchall()}
    transaction_column_info = {row[1]: row for row in conn.execute("PRAGMA table_info(transactions)").fetchall()}
    transaction_rule_columns = {row[1] for row in conn.execute("PRAGMA table_info(transaction_import_rules)").fetchall()}
    imported_source_columns = {row[1] for row in conn.execute("PRAGMA table_info(imported_source)").fetchall()}
    raw_imported_row_columns = {row[1] for row in conn.execute("PRAGMA table_info(raw_imported_rows)").fetchall()}
    raw_imported_rows_sql = conn.execute(
        """
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'raw_imported_rows'
        """
    ).fetchone()
    raw_imported_rows_ddl = raw_imported_rows_sql[0] if raw_imported_rows_sql else ""
    return (
        EXPECTED_ACCOUNT_COLUMNS.issubset(account_columns)
        and EXPECTED_CATEGORY_COLUMNS.issubset(category_columns)
        and EXPECTED_TRANSACTION_COLUMNS.issubset(transaction_columns)
        and int(transaction_column_info["transaction_type"][3]) == 1
        and "payee" not in transaction_columns
        and "description" not in transaction_columns
        and EXPECTED_TRANSACTION_RULE_COLUMNS.issubset(transaction_rule_columns)
        and EXPECTED_IMPORTED_SOURCE_COLUMNS.issubset(imported_source_columns)
        and "imported_source_id" not in transaction_columns
        and "import_source_file_id" not in transaction_columns
        and "institution" not in account_columns
        and EXPECTED_RAW_IMPORTED_ROW_COLUMNS.issubset(raw_imported_row_columns)
        and "raw_type" not in raw_imported_row_columns
        and "DEFAULT 'new'" in raw_imported_rows_ddl
        and "'ready'" in raw_imported_rows_ddl
        and "'pending'" not in raw_imported_rows_ddl
        and "reviewed" not in raw_imported_row_columns
        and "raw_account" not in raw_imported_row_columns
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
