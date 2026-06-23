from __future__ import annotations

import argparse
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = ROOT / "data" / "transactions.sqlite"
SCHEMA_PATH = ROOT / "db" / "schema.sql"
EXPECTED_ACCOUNT_COLUMNS = {"id", "institution_id", "name", "account_type", "external_account_id", "created_at", "updated_at"}
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
    "transaction_import_rule_tags",
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
    "external_transaction_id",
    "raw_imported_row_id",
    "transaction_hash",
    "created_at",
    "updated_at",
}
EXPECTED_TRANSACTION_RULE_COLUMNS = {
    "id",
    "name",
    "rule_type",
    "match_field",
    "match_type",
    "match_value",
    "match_description",
    "match_category",
    "match_amount",
    "set_category_id",
    "set_clean_description",
    "set_transaction_type",
    "add_tag_id",
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
    "default_clean_description",
    "raw_amount",
    "parsed_transaction_id",
    "import_status",
    "import_error",
    "raw_row_hash",
    "created_at",
    "updated_at",
}
NEW_TRANSACTION_TYPES = ("income", "expense", "transfer")
RULE_TYPES = ("auto-import", "template")
BILL_TAG_NAME = "bill"


def normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = re.sub(r"\s+", " ", str(value).strip())
    return normalized or None


def default_clean_description(value: str | None) -> str | None:
    text = normalize_text(value) or ""
    if len(text) > 25:
        next_space = text.find(" ", 25)
        text = (text if next_space == -1 else text[:next_space]).strip()
    cleaned = re.sub(r"[^a-zA-Z0-9'\s]+", " ", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return normalize_text(value)
    return re.sub(r"\b[a-z]", lambda match: match.group(0).upper(), cleaned.lower())


def init_db(db_path: Path = DEFAULT_DB_PATH, schema_path: Path = SCHEMA_PATH) -> Path:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    rebuild_empty_incompatible_db(db_path)

    schema = schema_path.read_text(encoding="utf-8")
    with closing(sqlite3.connect(db_path)) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(schema)
        ensure_bill_tag(conn)
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
    if "tags" in table_set:
        ensure_bill_tag(conn)
    if "accounts" in table_set:
        account_columns = {row[1] for row in conn.execute("PRAGMA table_info(accounts)").fetchall()}
        if "currency" in account_columns:
            conn.commit()
            rebuild_accounts_without_currency(conn)
            conn.commit()
    if "transactions" in table_set:
        transaction_columns = {row[1] for row in conn.execute("PRAGMA table_info(transactions)").fetchall()}
        transaction_table_ddl = table_ddl(conn, "transactions")
        if "transaction_type" not in transaction_columns:
            conn.execute(
                """
                ALTER TABLE transactions
                ADD COLUMN transaction_type TEXT NOT NULL DEFAULT 'expense'
                    CHECK (transaction_type IN ('income', 'expense', 'transfer'))
                """
            )
        conn.execute(
            """
            UPDATE transactions
            SET transaction_type = CASE
                WHEN amount_cents > 0 THEN 'income'
                ELSE 'expense'
            END
            WHERE transaction_type IS NULL
            """
        )
        transaction_columns = conn.execute("PRAGMA table_info(transactions)").fetchall()
        transaction_type_column = next((row for row in transaction_columns if row[1] == "transaction_type"), None)
        if (
            transaction_type_column is not None
            and not int(transaction_type_column[3])
        ) or "status" in {row[1] for row in transaction_columns} or "currency" in {row[1] for row in transaction_columns} or "'splurge'" in transaction_table_ddl or "'bill'" in transaction_table_ddl:
            conn.commit()
            rebuild_transactions_with_required_type(conn)
            conn.commit()
    if "transaction_import_rules" in table_set:
        rule_columns = {row[1] for row in conn.execute("PRAGMA table_info(transaction_import_rules)").fetchall()}
        rule_table_ddl = table_ddl(conn, "transaction_import_rules")
        if "rule_type" not in rule_columns:
            conn.execute(
                """
                ALTER TABLE transaction_import_rules
                ADD COLUMN rule_type TEXT NOT NULL DEFAULT 'auto-import'
                    CHECK (rule_type IN ('auto-import', 'template'))
                """
            )
        if "set_transaction_type" not in rule_columns:
            conn.execute(
                """
                ALTER TABLE transaction_import_rules
                ADD COLUMN set_transaction_type TEXT
                    CHECK (set_transaction_type IS NULL OR set_transaction_type IN ('income', 'expense', 'transfer'))
                """
            )
        if "match_description" not in rule_columns:
            conn.execute("ALTER TABLE transaction_import_rules ADD COLUMN match_description TEXT")
        if "match_category" not in rule_columns:
            conn.execute("ALTER TABLE transaction_import_rules ADD COLUMN match_category TEXT")
        if "match_amount" not in rule_columns:
            conn.execute(
                """
                ALTER TABLE transaction_import_rules
                ADD COLUMN match_amount TEXT NOT NULL DEFAULT 'any'
                    CHECK (match_amount IN ('positive', 'negative', 'any'))
                """
            )
        conn.execute("DROP INDEX IF EXISTS idx_transaction_import_rules_unique_match")
        conn.execute(
            """
            UPDATE transaction_import_rules
            SET match_description = CASE
                    WHEN match_description IS NULL AND match_field = 'description' THEN match_value
                    ELSE match_description
                END,
                match_category = CASE
                    WHEN match_category IS NULL AND match_field = 'category' THEN match_value
                    ELSE match_category
                END
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS transaction_import_rule_tags (
                rule_id INTEGER NOT NULL REFERENCES transaction_import_rules(id) ON DELETE CASCADE,
                tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (rule_id, tag_id)
            )
            """
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO transaction_import_rule_tags (rule_id, tag_id)
            SELECT id, add_tag_id
            FROM transaction_import_rules
            WHERE add_tag_id IS NOT NULL
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_transaction_import_rule_tags_tag_id
            ON transaction_import_rule_tags(tag_id)
            """
        )
        rule_columns = {row[1] for row in conn.execute("PRAGMA table_info(transaction_import_rules)").fetchall()}
        rule_table_ddl = table_ddl(conn, "transaction_import_rules")
        if "priority" in rule_columns or "'auto-import'" not in rule_table_ddl or "'template'" not in rule_table_ddl or "'splurge'" in rule_table_ddl or "'bill'" in rule_table_ddl:
            conn.commit()
            rebuild_transaction_import_rules_with_expense_type(conn)
            conn.commit()
    if "categories" in table_set:
        category_columns = {row[1] for row in conn.execute("PRAGMA table_info(categories)").fetchall()}
        if "color" not in category_columns:
            conn.execute("ALTER TABLE categories ADD COLUMN color TEXT")
    if "raw_imported_rows" in table_set:
        raw_imported_rows_sql = conn.execute(
            """
            SELECT sql
            FROM sqlite_master
            WHERE type = 'table' AND name = 'raw_imported_rows'
            """
        ).fetchone()
        raw_imported_rows_ddl = raw_imported_rows_sql[0] if raw_imported_rows_sql else ""
        if (
            "DEFAULT 'new'" in raw_imported_rows_ddl
            or "DEFAULT 'notImportable'" in raw_imported_rows_ddl
            or "'ready'" in raw_imported_rows_ddl
            or "'importable'" in raw_imported_rows_ddl
            or "'notImportable'" in raw_imported_rows_ddl
            or "'template'" in raw_imported_rows_ddl
            or "'pre-fill'" not in raw_imported_rows_ddl
        ):
            conn.commit()
            rebuild_raw_imported_rows_with_importability_status(conn)
            conn.commit()
        raw_imported_row_columns = {row[1] for row in conn.execute("PRAGMA table_info(raw_imported_rows)").fetchall()}
        if "default_clean_description" not in raw_imported_row_columns:
            conn.execute("ALTER TABLE raw_imported_rows ADD COLUMN default_clean_description TEXT")
        backfill_default_clean_descriptions(conn)
        normalize_raw_imported_row_spaces(conn)
    conn.commit()


def table_ddl(conn: sqlite3.Connection, table: str) -> str:
    row = conn.execute(
        """
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        """,
        (table,),
    ).fetchone()
    return row[0] if row else ""


def backfill_default_clean_descriptions(conn: sqlite3.Connection, *, force: bool = False) -> None:
    where_clause = "" if force else "WHERE default_clean_description IS NULL OR default_clean_description = ''"
    rows = conn.execute(
        f"""
        SELECT id, raw_description
        FROM raw_imported_rows
        {where_clause}
        """
    ).fetchall()
    conn.executemany(
        """
        UPDATE raw_imported_rows
        SET default_clean_description = ?
        WHERE id = ?
        """,
        [(default_clean_description(row[1]), row[0]) for row in rows],
    )


def ensure_bill_tag(conn: sqlite3.Connection) -> int:
    cursor = conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (BILL_TAG_NAME,))
    if cursor.lastrowid:
        return int(cursor.lastrowid)
    row = conn.execute("SELECT id FROM tags WHERE name = ?", (BILL_TAG_NAME,)).fetchone()
    if row is None:
        raise RuntimeError("Could not create bill tag.")
    return int(row[0])


def rebuild_accounts_without_currency(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.execute("DROP TABLE IF EXISTS accounts_rebuild")
        conn.execute(
            """
            CREATE TABLE accounts_rebuild (
                id INTEGER PRIMARY KEY,
                institution_id INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
                name TEXT NOT NULL,
                account_type TEXT,
                external_account_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (name, institution_id)
            )
            """
        )
        conn.execute(
            """
            INSERT INTO accounts_rebuild (
                id,
                institution_id,
                name,
                account_type,
                external_account_id,
                created_at,
                updated_at
            )
            SELECT
                id,
                institution_id,
                name,
                account_type,
                external_account_id,
                created_at,
                updated_at
            FROM accounts
            """
        )
        conn.execute("DROP TABLE accounts")
        conn.execute("ALTER TABLE accounts_rebuild RENAME TO accounts")
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def rebuild_transactions_with_required_type(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        bill_tag_id = ensure_bill_tag(conn)
        conn.execute("DROP TABLE IF EXISTS bill_transaction_ids")
        conn.execute(
            """
            CREATE TEMP TABLE bill_transaction_ids AS
            SELECT id
            FROM transactions
            WHERE transaction_type = 'bill'
            """
        )
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
                external_transaction_id TEXT,
                raw_imported_row_id INTEGER REFERENCES raw_imported_rows(id) ON DELETE SET NULL,
                transaction_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                CHECK (transaction_type IN ('income', 'expense', 'transfer')),
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
                CASE
                    WHEN COALESCE(transaction_type, CASE WHEN amount_cents > 0 THEN 'income' ELSE 'expense' END) = 'bill' THEN 'expense'
                    WHEN COALESCE(transaction_type, CASE WHEN amount_cents > 0 THEN 'income' ELSE 'expense' END) = 'splurge' THEN 'expense'
                    ELSE COALESCE(transaction_type, CASE WHEN amount_cents > 0 THEN 'income' ELSE 'expense' END)
                END,
                clean_description,
                amount_cents,
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
        conn.execute(
            """
            INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
            SELECT id, ?
            FROM bill_transaction_ids
            """,
            (bill_tag_id,),
        )
        conn.execute("DROP TABLE bill_transaction_ids")
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def rebuild_transaction_import_rules_with_expense_type(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        bill_tag_id = ensure_bill_tag(conn)
        conn.execute("DROP TABLE IF EXISTS bill_rule_ids")
        conn.execute(
            """
            CREATE TEMP TABLE bill_rule_ids AS
            SELECT id
            FROM transaction_import_rules
            WHERE set_transaction_type = 'bill'
            """
        )
        conn.execute("DROP TABLE IF EXISTS transaction_import_rules_rebuild")
        conn.execute(
            """
            CREATE TABLE transaction_import_rules_rebuild (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                rule_type TEXT NOT NULL DEFAULT 'auto-import',
                match_field TEXT NOT NULL,
                match_type TEXT NOT NULL DEFAULT 'contains',
                match_value TEXT NOT NULL,
                match_description TEXT,
                match_category TEXT,
                match_amount TEXT NOT NULL DEFAULT 'any',
                set_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
                set_clean_description TEXT,
                set_transaction_type TEXT,
                add_tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                CHECK (rule_type IN ('auto-import', 'template')),
                CHECK (match_field IN ('category', 'description')),
                CHECK (match_type IN ('contains', 'equals', 'starts_with', 'regex')),
                CHECK (match_amount IN ('positive', 'negative', 'any')),
                CHECK (set_transaction_type IS NULL OR set_transaction_type IN ('income', 'expense', 'transfer')),
                CHECK (is_active IN (0, 1)),
                CHECK (set_category_id IS NOT NULL OR set_clean_description IS NOT NULL OR set_transaction_type IS NOT NULL OR add_tag_id IS NOT NULL)
            )
            """
        )
        conn.execute(
            """
            INSERT INTO transaction_import_rules_rebuild (
                id,
                name,
                rule_type,
                match_field,
                match_type,
                match_value,
                match_description,
                match_category,
                match_amount,
                set_category_id,
                set_clean_description,
                set_transaction_type,
                add_tag_id,
                is_active,
                created_at,
                updated_at
            )
            SELECT
                id,
                name,
                CASE COALESCE(rule_type, 'auto-import')
                    WHEN 'rule' THEN 'auto-import'
                    ELSE COALESCE(rule_type, 'auto-import')
                END,
                match_field,
                match_type,
                match_value,
                match_description,
                match_category,
                COALESCE(match_amount, 'any'),
                set_category_id,
                set_clean_description,
                CASE
                    WHEN set_transaction_type IN ('bill', 'splurge') THEN 'expense'
                    ELSE set_transaction_type
                END,
                add_tag_id,
                is_active,
                created_at,
                updated_at
            FROM transaction_import_rules
            WHERE id IN (
                SELECT MIN(id)
                FROM transaction_import_rules
                GROUP BY
                    CASE COALESCE(rule_type, 'auto-import')
                        WHEN 'rule' THEN 'auto-import'
                        ELSE COALESCE(rule_type, 'auto-import')
                    END,
                    COALESCE(match_description, ''),
                    COALESCE(match_category, ''),
                    COALESCE(match_amount, 'any')
            )
            """
        )
        conn.execute("DROP TABLE transaction_import_rules")
        conn.execute("ALTER TABLE transaction_import_rules_rebuild RENAME TO transaction_import_rules")
        conn.execute(
            """
            DELETE FROM transaction_import_rule_tags
            WHERE rule_id NOT IN (
                SELECT id
                FROM transaction_import_rules
            )
            """
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO transaction_import_rule_tags (rule_id, tag_id)
            SELECT id, ?
            FROM bill_rule_ids
            """,
            (bill_tag_id,),
        )
        conn.execute("DROP TABLE bill_rule_ids")
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def rebuild_raw_imported_rows_with_importability_status(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.execute("DROP TABLE IF EXISTS raw_imported_rows_rebuild")
        conn.execute(
            """
            CREATE TABLE raw_imported_rows_rebuild (
                id INTEGER PRIMARY KEY,
                imported_source_id INTEGER NOT NULL REFERENCES imported_source(id) ON DELETE CASCADE,
                raw_date TEXT,
                raw_category TEXT,
                raw_description TEXT,
                default_clean_description TEXT,
                raw_amount TEXT,
                parsed_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
                import_status TEXT NOT NULL DEFAULT 'manual',
                import_error TEXT,
                raw_row_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CHECK (import_status IN ('auto-importable', 'manual', 'pre-fill', 'imported', 'duplicate', 'error')),
                CHECK (
                    raw_date IS NOT NULL
                    OR raw_category IS NOT NULL
                    OR raw_description IS NOT NULL
                    OR raw_amount IS NOT NULL
                )
            )
            """
        )
        conn.execute(
            """
            INSERT INTO raw_imported_rows_rebuild (
                id,
                imported_source_id,
                raw_date,
                raw_category,
                raw_description,
                default_clean_description,
                raw_amount,
                parsed_transaction_id,
                import_status,
                import_error,
                raw_row_hash,
                created_at,
                updated_at
            )
            SELECT
                id,
                imported_source_id,
                raw_date,
                raw_category,
                raw_description,
                NULL,
                raw_amount,
                parsed_transaction_id,
                CASE import_status
                    WHEN 'ready' THEN 'auto-importable'
                    WHEN 'importable' THEN 'auto-importable'
                    WHEN 'new' THEN 'manual'
                    WHEN 'notImportable' THEN 'manual'
                    WHEN 'template' THEN 'pre-fill'
                    WHEN 'pre-fill' THEN 'pre-fill'
                    ELSE import_status
                END,
                import_error,
                raw_row_hash,
                created_at,
                updated_at
            FROM raw_imported_rows
            """
        )
        conn.execute("DROP TABLE raw_imported_rows")
        conn.execute("ALTER TABLE raw_imported_rows_rebuild RENAME TO raw_imported_rows")
        backfill_default_clean_descriptions(conn)
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_raw_imported_rows_imported_source_id
            ON raw_imported_rows(imported_source_id)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_raw_imported_rows_status
            ON raw_imported_rows(import_status)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_raw_imported_rows_raw_date
            ON raw_imported_rows(raw_date)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_raw_imported_rows_parsed_transaction_id
            ON raw_imported_rows(parsed_transaction_id)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_raw_imported_rows_hash
            ON raw_imported_rows(imported_source_id, raw_row_hash)
            """
        )
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def normalize_raw_imported_row_spaces(conn: sqlite3.Connection) -> None:
    for column in ("raw_category", "raw_description"):
        while True:
            cursor = conn.execute(
                f"""
                UPDATE raw_imported_rows
                SET {column} = replace({column}, '  ', ' ')
                WHERE {column} LIKE '%  %'
                """
            )
            if cursor.rowcount == 0:
                break
    backfill_default_clean_descriptions(conn, force=True)


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
    transaction_ddl = table_ddl(conn, "transactions")
    transaction_rule_ddl = table_ddl(conn, "transaction_import_rules")
    return (
        EXPECTED_ACCOUNT_COLUMNS.issubset(account_columns)
        and EXPECTED_CATEGORY_COLUMNS.issubset(category_columns)
        and EXPECTED_TRANSACTION_COLUMNS.issubset(transaction_columns)
        and int(transaction_column_info["transaction_type"][3]) == 1
        and "'expense'" in transaction_ddl
        and "'transfer'" in transaction_ddl
        and "'splurge'" not in transaction_ddl
        and "'bill'" not in transaction_ddl
        and "currency" not in account_columns
        and "currency" not in transaction_columns
        and "status" not in transaction_columns
        and "payee" not in transaction_columns
        and "description" not in transaction_columns
        and EXPECTED_TRANSACTION_RULE_COLUMNS.issubset(transaction_rule_columns)
        and "rule_type" in transaction_rule_columns
        and "match_amount" in transaction_rule_columns
        and "priority" not in transaction_rule_columns
        and "'auto-import'" in transaction_rule_ddl
        and "'positive'" in transaction_rule_ddl
        and "'negative'" in transaction_rule_ddl
        and "'any'" in transaction_rule_ddl
        and "'expense'" in transaction_rule_ddl
        and "'transfer'" in transaction_rule_ddl
        and "'template'" in transaction_rule_ddl
        and "'splurge'" not in transaction_rule_ddl
        and "'bill'" not in transaction_rule_ddl
        and EXPECTED_IMPORTED_SOURCE_COLUMNS.issubset(imported_source_columns)
        and "imported_source_id" not in transaction_columns
        and "import_source_file_id" not in transaction_columns
        and "institution" not in account_columns
        and EXPECTED_RAW_IMPORTED_ROW_COLUMNS.issubset(raw_imported_row_columns)
        and "raw_type" not in raw_imported_row_columns
        and "DEFAULT 'manual'" in raw_imported_rows_ddl
        and "'auto-importable'" in raw_imported_rows_ddl
        and "'manual'" in raw_imported_rows_ddl
        and "'pre-fill'" in raw_imported_rows_ddl
        and "'importable'" not in raw_imported_rows_ddl
        and "'notImportable'" not in raw_imported_rows_ddl
        and "'template'" not in raw_imported_rows_ddl
        and "'ready'" not in raw_imported_rows_ddl
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
