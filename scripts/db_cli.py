from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any, Iterable

from init_db import DEFAULT_DB_PATH, init_db


READONLY_PREFIXES = ("select", "with", "pragma")
FORBIDDEN_SQL_WORDS = {
    "insert",
    "update",
    "delete",
    "drop",
    "alter",
    "create",
    "replace",
    "truncate",
    "vacuum",
    "attach",
    "detach",
    "reindex",
}
VALID_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
MATCH_FIELDS = {"merchant_raw", "description_raw"}
MATCH_TYPES = {"contains", "equals", "starts_with", "regex"}


class CliError(Exception):
    pass


def connect(db_path: Path, readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        require_existing_db(db_path)
        uri = f"file:{db_path.resolve().as_posix()}?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
    else:
        require_existing_db(db_path)
        conn = sqlite3.connect(db_path)

    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def require_existing_db(db_path: Path) -> None:
    if not db_path.exists():
        raise CliError(f"Database not found at {db_path}. Run: python scripts/db_cli.py init")
    if not db_path.is_file():
        raise CliError(f"Database path is not a file: {db_path}")


def rows_to_dicts(rows: Iterable[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def print_json(payload: Any) -> None:
    print(json.dumps(payload, indent=2, sort_keys=True))


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        """,
        (table,),
    ).fetchone()
    return row is not None


def nonempty(value: str, field_name: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise CliError(f"{field_name} cannot be empty.")
    return normalized


def optional_nonempty(value: str | None, field_name: str) -> str | None:
    if value is None:
        return None
    return nonempty(value, field_name)


def normalize_currency(value: str) -> str:
    currency = nonempty(value, "currency").upper()
    if not VALID_CURRENCY_RE.match(currency):
        raise CliError("currency must be a three-letter ISO code such as USD.")
    return currency


def positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be an integer") from exc
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be greater than 0")
    return parsed


def nonnegative_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be an integer") from exc
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be 0 or greater")
    return parsed


def validate_match_field(value: str) -> str:
    normalized = nonempty(value, "match_field")
    if normalized not in MATCH_FIELDS:
        raise CliError(f"match_field must be one of: {', '.join(sorted(MATCH_FIELDS))}")
    return normalized


def validate_match_type(value: str) -> str:
    normalized = nonempty(value, "match_type")
    if normalized not in MATCH_TYPES:
        raise CliError(f"match_type must be one of: {', '.join(sorted(MATCH_TYPES))}")
    return normalized


def validate_rule_actions(set_category_id: int | None, set_merchant_clean: str | None, add_tag_id: int | None) -> None:
    if set_category_id is None and set_merchant_clean is None and add_tag_id is None:
        raise CliError("A transaction rule must set a category, set a cleaned merchant, and/or add a tag.")


def require_category(conn: sqlite3.Connection, category_id: int) -> None:
    row = conn.execute("SELECT 1 FROM categories WHERE id = ?", (category_id,)).fetchone()
    if row is None:
        raise CliError(f"Category not found: {category_id}")


def require_tag_id(conn: sqlite3.Connection, tag_id: int) -> None:
    row = conn.execute("SELECT 1 FROM tags WHERE id = ?", (tag_id,)).fetchone()
    if row is None:
        raise CliError(f"Tag not found: {tag_id}")


def require_transaction(conn: sqlite3.Connection, transaction_id: int) -> None:
    row = conn.execute("SELECT 1 FROM transactions WHERE id = ?", (transaction_id,)).fetchone()
    if row is None:
        raise CliError(f"Transaction not found: {transaction_id}")


def fetch_account(conn: sqlite3.Connection, account_id: int) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT
            a.id,
            a.name,
            a.institution_id,
            i.name AS institution,
            a.account_type,
            a.currency,
            a.external_account_id,
            a.created_at,
            a.updated_at
        FROM accounts a
        LEFT JOIN institutions i ON i.id = a.institution_id
        WHERE a.id = ?
        """,
        (account_id,),
    ).fetchone()
    if row is None:
        raise CliError(f"Account not found: {account_id}")
    return row


def fetch_imported_source(conn: sqlite3.Connection, imported_source_id: int) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT
            src.id,
            src.account_id,
            a.name AS account,
            src.filename,
            src.source_type,
            src.sha256,
            src.imported_at,
            src.row_count,
            src.metadata_json
        FROM imported_source src
        JOIN accounts a ON a.id = src.account_id
        WHERE src.id = ?
        """,
        (imported_source_id,),
    ).fetchone()
    if row is None:
        raise CliError(f"Imported source not found: {imported_source_id}")
    return row


def fetch_tag_by_name(conn: sqlite3.Connection, name: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT id, name, created_at
        FROM tags
        WHERE name = ?
        """,
        (name,),
    ).fetchone()


def fetch_tag_by_id(conn: sqlite3.Connection, tag_id: int) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT id, name, created_at
        FROM tags
        WHERE id = ?
        """,
        (tag_id,),
    ).fetchone()
    if row is None:
        raise CliError(f"Tag not found: {tag_id}")
    return row


def fetch_note(conn: sqlite3.Connection, note_id: int) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT id, transaction_id, note, created_at, updated_at
        FROM transaction_notes
        WHERE id = ?
        """,
        (note_id,),
    ).fetchone()
    if row is None:
        raise CliError(f"Note not found after write: {note_id}")
    return row


def fetch_transaction_tag(conn: sqlite3.Connection, transaction_id: int, tag_id: int) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT
            tt.transaction_id,
            tt.tag_id,
            tags.name AS tag,
            tt.created_at
        FROM transaction_tags tt
        JOIN tags ON tags.id = tt.tag_id
        WHERE tt.transaction_id = ? AND tt.tag_id = ?
        """,
        (transaction_id, tag_id),
    ).fetchone()
    if row is None:
        raise CliError("Transaction tag row not found after write.")
    return row


def fetch_transaction_rule(conn: sqlite3.Connection, rule_id: int) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT
            r.id,
            r.name,
            r.match_field,
            r.match_type,
            r.match_value,
            r.set_category_id,
            c.name AS set_category,
            r.set_merchant_clean,
            r.add_tag_id,
            tags.name AS add_tag,
            r.priority,
            r.is_active,
            r.created_at,
            r.updated_at
        FROM transaction_import_rules r
        LEFT JOIN categories c ON c.id = r.set_category_id
        LEFT JOIN tags ON tags.id = r.add_tag_id
        WHERE r.id = ?
        """,
        (rule_id,),
    ).fetchone()
    if row is None:
        raise CliError(f"Transaction import rule not found: {rule_id}")
    return row


def get_or_create_institution(conn: sqlite3.Connection, name: str | None) -> int | None:
    if name is None:
        return None

    row = conn.execute("SELECT id FROM institutions WHERE name = ?", (name,)).fetchone()
    if row is not None:
        return int(row["id"])

    cursor = conn.execute("INSERT INTO institutions (name) VALUES (?)", (name,))
    return int(cursor.lastrowid)


def clean_csv_value(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def first_csv_value(row: dict[str, str | None], *names: str) -> str | None:
    for name in names:
        if name in row:
            value = clean_csv_value(row[name])
            if value is not None:
                return value
    return None


def signed_amount_from_debit_credit(row: dict[str, str | None]) -> str | None:
    debit = first_csv_value(row, "Debit")
    credit = first_csv_value(row, "Credit")
    if debit is not None and credit is not None:
        return f"debit={debit}; credit={credit}"
    if debit is not None:
        return debit if debit.startswith("-") else f"-{debit}"
    return credit


def detect_csv_layout(fieldnames: list[str]) -> str:
    fields = set(fieldnames)
    if {"Transaction Date", "Posted Date", "Description", "Category", "Debit", "Credit"}.issubset(fields):
        return "capital_one_credit"
    if {"Details", "Posting Date", "Description", "Amount", "Type", "Balance"}.issubset(fields):
        return "chase_checking"
    if {"Date", "Description", "Type", "Amount", "Current balance", "Status"}.issubset(fields):
        return "sofi_bank"
    return "generic_csv"


def normalize_csv_row(row: dict[str, str | None]) -> dict[str, str | None]:
    raw_amount = first_csv_value(row, "Amount")
    if raw_amount is None and ("Debit" in row or "Credit" in row):
        raw_amount = signed_amount_from_debit_credit(row)

    return {
        "raw_date": first_csv_value(row, "Posted Date", "Posting Date", "Date", "Transaction Date"),
        "raw_type": first_csv_value(row, "Type", "Details", "Status"),
        "raw_category": first_csv_value(row, "Category"),
        "raw_description": first_csv_value(row, "Description", "Memo", "Name", "Payee"),
        "raw_amount": raw_amount,
    }


def read_csv_import_rows(csv_path: Path) -> tuple[list[str], list[dict[str, str | None]]]:
    if not csv_path.exists():
        raise CliError(f"CSV file not found: {csv_path}")
    if not csv_path.is_file():
        raise CliError(f"CSV path is not a file: {csv_path}")

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
            reader = csv.DictReader(csv_file)
            if reader.fieldnames is None:
                raise CliError("CSV file does not contain a header row.")
            fieldnames = [field.strip() for field in reader.fieldnames if field is not None]
            rows = []
            for source_row in reader:
                normalized_source_row = {
                    key.strip() if key is not None else "": value for key, value in source_row.items()
                }
                raw_row = normalize_csv_row(normalized_source_row)
                if any(value is not None for value in raw_row.values()):
                    rows.append(raw_row)
    except UnicodeDecodeError as exc:
        raise CliError("CSV file must be UTF-8 or UTF-8 with BOM.") from exc
    except csv.Error as exc:
        raise CliError(f"Could not parse CSV: {exc}") from exc

    return fieldnames, rows


def ensure_readonly_sql(sql: str) -> None:
    stripped = sql.strip()
    lowered = stripped.lower()

    if not stripped:
        raise CliError("SQL cannot be empty.")
    if ";" in lowered.rstrip(";"):
        raise CliError("Only one read-only SQL statement is allowed.")
    if not lowered.startswith(READONLY_PREFIXES):
        raise CliError("Only SELECT, WITH, and PRAGMA statements are allowed.")

    words = set(re.findall(r"\b[a-z_]+\b", lowered))
    forbidden = sorted(words.intersection(FORBIDDEN_SQL_WORDS))
    if forbidden:
        raise CliError(f"Read-only query rejected because it contains forbidden keyword(s): {', '.join(forbidden)}")


def command_init(args: argparse.Namespace) -> None:
    db_path = init_db(args.db)
    print_json({"database": str(db_path), "status": "initialized"})


def command_tables(args: argparse.Namespace) -> None:
    with connect(args.db, readonly=True) as conn:
        rows = conn.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            """
        ).fetchall()
    print_json({"tables": [row["name"] for row in rows]})


def command_describe(args: argparse.Namespace) -> None:
    with connect(args.db, readonly=True) as conn:
        if not table_exists(conn, args.table):
            raise CliError(f"Table not found: {args.table}")
        columns = conn.execute(f"PRAGMA table_info({quote_identifier(args.table)})").fetchall()
        indexes = conn.execute(f"PRAGMA index_list({quote_identifier(args.table)})").fetchall()

    print_json(
        {
            "table": args.table,
            "columns": rows_to_dicts(columns),
            "indexes": rows_to_dicts(indexes),
        }
    )


def command_query_readonly(args: argparse.Namespace) -> None:
    ensure_readonly_sql(args.sql)
    with connect(args.db, readonly=True) as conn:
        rows = conn.execute(args.sql).fetchall()
    print_json({"row_count": len(rows), "rows": rows_to_dicts(rows)})


def command_recent(args: argparse.Namespace) -> None:
    if args.limit < 1:
        raise CliError("--limit must be greater than 0.")

    with connect(args.db, readonly=True) as conn:
        rows = conn.execute(
            """
            SELECT
                t.id,
                t.posted_date,
                a.name AS account,
                t.payee,
                t.description,
                t.amount_cents,
                printf('%.2f', t.amount_cents / 100.0) AS amount,
                t.currency,
                c.name AS category
            FROM transactions t
            JOIN accounts a ON a.id = t.account_id
            LEFT JOIN categories c ON c.id = t.category_id
            ORDER BY t.posted_date DESC, t.id DESC
            LIMIT ?
            """,
            (args.limit,),
        ).fetchall()
    print_json({"limit": args.limit, "transactions": rows_to_dicts(rows)})


def command_accounts(args: argparse.Namespace) -> None:
    with connect(args.db, readonly=True) as conn:
        rows = conn.execute(
            """
            SELECT
                a.id,
                a.name,
                i.name AS institution,
                a.account_type,
                a.currency,
                COUNT(t.id) AS transaction_count
            FROM accounts a
            LEFT JOIN institutions i ON i.id = a.institution_id
            LEFT JOIN transactions t ON t.account_id = a.id
            GROUP BY a.id
            ORDER BY a.name
            """
        ).fetchall()
    print_json({"accounts": rows_to_dicts(rows)})


def command_transaction(args: argparse.Namespace) -> None:
    with connect(args.db, readonly=True) as conn:
        transaction = conn.execute(
            """
            SELECT
                t.id,
                t.posted_date,
                t.transaction_date,
                a.name AS account,
                t.payee,
                t.description,
                t.amount_cents,
                printf('%.2f', t.amount_cents / 100.0) AS amount,
                t.currency,
                t.status,
                c.name AS category,
                t.external_transaction_id,
                rr.id AS raw_imported_row_id,
                src.id AS imported_source_id,
                src.filename AS imported_source
            FROM transactions t
            JOIN accounts a ON a.id = t.account_id
            LEFT JOIN categories c ON c.id = t.category_id
            LEFT JOIN raw_imported_rows rr ON rr.id = t.raw_imported_row_id
            LEFT JOIN imported_source src ON src.id = rr.imported_source_id
            WHERE t.id = ?
            """,
            (args.id,),
        ).fetchone()
        tags = conn.execute(
            """
            SELECT tags.name
            FROM tags
            JOIN transaction_tags ON transaction_tags.tag_id = tags.id
            WHERE transaction_tags.transaction_id = ?
            ORDER BY tags.name
            """,
            (args.id,),
        ).fetchall()
        notes = conn.execute(
            """
            SELECT id, note, created_at, updated_at
            FROM transaction_notes
            WHERE transaction_id = ?
            ORDER BY created_at, id
            """,
            (args.id,),
        ).fetchall()

    if transaction is None:
        raise CliError(f"Transaction not found: {args.id}")

    print_json(
        {
            "transaction": dict(transaction),
            "tags": [row["name"] for row in tags],
            "notes": rows_to_dicts(notes),
        }
    )


def command_import_csv(args: argparse.Namespace) -> None:
    csv_path = args.csv_path.expanduser()
    source_type = optional_nonempty(args.source_type, "source_type") or "csv"
    fieldnames, raw_rows = read_csv_import_rows(csv_path)
    file_hash = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    metadata = {
        "columns": fieldnames,
        "layout": detect_csv_layout(fieldnames),
    }

    with connect(args.db) as conn:
        account = fetch_account(conn, args.account_id)
        existing = conn.execute(
            """
            SELECT id, account_id
            FROM imported_source
            WHERE sha256 = ?
            """,
            (file_hash,),
        ).fetchone()
        if existing is not None:
            if int(existing["account_id"]) != args.account_id:
                raise CliError(
                    "CSV file has already been imported for a different account "
                    f"({existing['account_id']})."
                )
            source = fetch_imported_source(conn, int(existing["id"]))
            print_json(
                {
                    "status": "already_imported",
                    "account": dict(account),
                    "imported_source": dict(source),
                    "inserted_raw_row_count": 0,
                }
            )
            return

        cursor = conn.execute(
            """
            INSERT INTO imported_source (
                account_id,
                filename,
                source_type,
                sha256,
                row_count,
                metadata_json
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                args.account_id,
                csv_path.name,
                source_type,
                file_hash,
                len(raw_rows),
                json.dumps(metadata, sort_keys=True),
            ),
        )
        imported_source_id = int(cursor.lastrowid)
        conn.executemany(
            """
            INSERT INTO raw_imported_rows (
                imported_source_id,
                raw_date,
                raw_type,
                raw_category,
                raw_description,
                raw_amount
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    imported_source_id,
                    row["raw_date"],
                    row["raw_type"],
                    row["raw_category"],
                    row["raw_description"],
                    row["raw_amount"],
                )
                for row in raw_rows
            ],
        )
        source = fetch_imported_source(conn, imported_source_id)

    print_json(
        {
            "status": "imported",
            "account": dict(account),
            "imported_source": dict(source),
            "inserted_raw_row_count": len(raw_rows),
        }
    )


def command_add_account(args: argparse.Namespace) -> None:
    name = nonempty(args.name, "name")
    institution = optional_nonempty(args.institution, "institution")
    account_type = optional_nonempty(args.account_type, "account_type")
    currency = normalize_currency(args.currency)
    external_account_id = optional_nonempty(args.external_account_id, "external_account_id")

    with connect(args.db) as conn:
        institution_id = get_or_create_institution(conn, institution)
        try:
            cursor = conn.execute(
                """
                INSERT INTO accounts (institution_id, name, account_type, currency, external_account_id)
                VALUES (?, ?, ?, ?, ?)
                """,
                (institution_id, name, account_type, currency, external_account_id),
            )
        except sqlite3.IntegrityError as exc:
            raise CliError(f"Could not add account: {exc}") from exc
        account = fetch_account(conn, int(cursor.lastrowid))

    print_json({"account": dict(account)})


def command_rename_account(args: argparse.Namespace) -> None:
    name = nonempty(args.name, "name")

    with connect(args.db) as conn:
        fetch_account(conn, args.id)
        try:
            conn.execute(
                """
                UPDATE accounts
                SET name = ?, updated_at = datetime('now')
                WHERE id = ?
                """,
                (name, args.id),
            )
        except sqlite3.IntegrityError as exc:
            raise CliError(f"Could not rename account: {exc}") from exc
        account = fetch_account(conn, args.id)

    print_json({"account": dict(account)})


def command_add_note(args: argparse.Namespace) -> None:
    note = nonempty(args.note, "note")

    with connect(args.db) as conn:
        require_transaction(conn, args.transaction_id)
        cursor = conn.execute(
            """
            INSERT INTO transaction_notes (transaction_id, note)
            VALUES (?, ?)
            """,
            (args.transaction_id, note),
        )
        changed_note = fetch_note(conn, int(cursor.lastrowid))

    print_json({"note": dict(changed_note)})


def command_add_tag(args: argparse.Namespace) -> None:
    name = nonempty(args.name, "name")

    with connect(args.db) as conn:
        existing = fetch_tag_by_name(conn, name)
        if existing is not None:
            raise CliError(f"Tag already exists: {name}")
        cursor = conn.execute("INSERT INTO tags (name) VALUES (?)", (name,))
        tag = fetch_tag_by_id(conn, int(cursor.lastrowid))

    print_json({"tag": dict(tag)})


def command_tag_transaction(args: argparse.Namespace) -> None:
    tag_name = nonempty(args.tag, "tag")

    with connect(args.db) as conn:
        require_transaction(conn, args.transaction_id)
        tag = fetch_tag_by_name(conn, tag_name)
        if tag is None:
            raise CliError(f"Tag not found: {tag_name}. Run add-tag first.")
        try:
            conn.execute(
                """
                INSERT INTO transaction_tags (transaction_id, tag_id)
                VALUES (?, ?)
                """,
                (args.transaction_id, tag["id"]),
            )
        except sqlite3.IntegrityError as exc:
            raise CliError(f"Could not tag transaction: {exc}") from exc
        transaction_tag = fetch_transaction_tag(conn, args.transaction_id, int(tag["id"]))

    print_json({"transaction_tag": dict(transaction_tag)})


def command_untag_transaction(args: argparse.Namespace) -> None:
    tag_name = nonempty(args.tag, "tag")

    with connect(args.db) as conn:
        require_transaction(conn, args.transaction_id)
        tag = fetch_tag_by_name(conn, tag_name)
        if tag is None:
            raise CliError(f"Tag not found: {tag_name}")
        transaction_tag = fetch_transaction_tag(conn, args.transaction_id, int(tag["id"]))
        conn.execute(
            """
            DELETE FROM transaction_tags
            WHERE transaction_id = ? AND tag_id = ?
            """,
            (args.transaction_id, tag["id"]),
        )

    print_json({"status": "removed", "transaction_tag": dict(transaction_tag)})


def command_add_transaction_rule(args: argparse.Namespace) -> None:
    name = nonempty(args.name, "name")
    match_field = validate_match_field(args.match_field)
    match_type = validate_match_type(args.match_type)
    match_value = nonempty(args.match_value, "match_value")
    set_merchant_clean = optional_nonempty(args.set_merchant_clean, "set_merchant_clean")
    is_active = 0 if args.inactive else 1

    validate_rule_actions(args.set_category_id, set_merchant_clean, args.add_tag_id)

    with connect(args.db) as conn:
        if args.set_category_id is not None:
            require_category(conn, args.set_category_id)
        if args.add_tag_id is not None:
            require_tag_id(conn, args.add_tag_id)

        cursor = conn.execute(
            """
            INSERT INTO transaction_import_rules (
                name,
                match_field,
                match_type,
                match_value,
                set_category_id,
                set_merchant_clean,
                add_tag_id,
                priority,
                is_active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                match_field,
                match_type,
                match_value,
                args.set_category_id,
                set_merchant_clean,
                args.add_tag_id,
                args.priority,
                is_active,
            ),
        )
        rule = fetch_transaction_rule(conn, int(cursor.lastrowid))

    print_json({"transaction_rule": dict(rule)})


def command_update_transaction_rule(args: argparse.Namespace) -> None:
    updates: list[str] = []
    values: list[Any] = []

    with connect(args.db) as conn:
        current = fetch_transaction_rule(conn, args.id)

        next_set_category_id = current["set_category_id"]
        next_set_merchant_clean = current["set_merchant_clean"]
        next_add_tag_id = current["add_tag_id"]

        if args.name is not None:
            updates.append("name = ?")
            values.append(nonempty(args.name, "name"))
        if args.match_field is not None:
            updates.append("match_field = ?")
            values.append(validate_match_field(args.match_field))
        if args.match_type is not None:
            updates.append("match_type = ?")
            values.append(validate_match_type(args.match_type))
        if args.match_value is not None:
            updates.append("match_value = ?")
            values.append(nonempty(args.match_value, "match_value"))

        if args.clear_category:
            next_set_category_id = None
            updates.append("set_category_id = ?")
            values.append(None)
        elif args.set_category_id is not None:
            require_category(conn, args.set_category_id)
            next_set_category_id = args.set_category_id
            updates.append("set_category_id = ?")
            values.append(args.set_category_id)

        if args.clear_merchant_clean:
            next_set_merchant_clean = None
            updates.append("set_merchant_clean = ?")
            values.append(None)
        elif args.set_merchant_clean is not None:
            next_set_merchant_clean = nonempty(args.set_merchant_clean, "set_merchant_clean")
            updates.append("set_merchant_clean = ?")
            values.append(next_set_merchant_clean)

        if args.clear_tag:
            next_add_tag_id = None
            updates.append("add_tag_id = ?")
            values.append(None)
        elif args.add_tag_id is not None:
            require_tag_id(conn, args.add_tag_id)
            next_add_tag_id = args.add_tag_id
            updates.append("add_tag_id = ?")
            values.append(args.add_tag_id)

        if args.priority is not None:
            updates.append("priority = ?")
            values.append(args.priority)
        if args.active:
            updates.append("is_active = ?")
            values.append(1)
        elif args.inactive:
            updates.append("is_active = ?")
            values.append(0)

        if not updates:
            raise CliError("No changes requested.")

        validate_rule_actions(next_set_category_id, next_set_merchant_clean, next_add_tag_id)

        updates.append("updated_at = datetime('now')")
        values.append(args.id)
        conn.execute(
            f"""
            UPDATE transaction_import_rules
            SET {', '.join(updates)}
            WHERE id = ?
            """,
            values,
        )
        rule = fetch_transaction_rule(conn, args.id)

    print_json({"transaction_rule": dict(rule)})


def quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Agent-friendly Transaction History SQLite CLI.",
        epilog=(
            "Examples:\n"
            "  python scripts/db_cli.py init\n"
            "  python scripts/db_cli.py tables\n"
            "  python scripts/db_cli.py describe transactions\n"
            "  python scripts/db_cli.py query-readonly \"SELECT COUNT(*) AS count FROM transactions\"\n"
            "  python scripts/db_cli.py recent --limit 20\n"
            "  python scripts/db_cli.py --db data/transactions.sqlite accounts\n"
            "  python scripts/db_cli.py add-account --name Checking --institution \"Example Bank\"\n"
            "  python scripts/db_cli.py import-csv path/to/file.csv --account-id 1\n"
            "  python scripts/db_cli.py add-tag --name reimbursable\n"
            "  python scripts/db_cli.py add-note --transaction-id 1 --note \"Reviewed\"\n"
            "  python scripts/db_cli.py add-transaction-rule --name Coffee --match-field merchant_raw --match-type contains --match-value Starbucks --set-merchant-clean Starbucks"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"SQLite database path. Defaults to {DEFAULT_DB_PATH}",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init", help="Create or update the local SQLite database schema.")
    init_parser.set_defaults(func=command_init)

    tables_parser = subparsers.add_parser("tables", help="List database tables as JSON.")
    tables_parser.set_defaults(func=command_tables)

    describe_parser = subparsers.add_parser("describe", help="Describe a table as JSON.")
    describe_parser.add_argument("table")
    describe_parser.set_defaults(func=command_describe)

    query_parser = subparsers.add_parser("query-readonly", help="Run a single read-only SQL statement and print JSON.")
    query_parser.add_argument("sql")
    query_parser.set_defaults(func=command_query_readonly)

    recent_parser = subparsers.add_parser("recent", help="Show recent transactions as JSON.")
    recent_parser.add_argument("--limit", type=int, default=20)
    recent_parser.set_defaults(func=command_recent)

    accounts_parser = subparsers.add_parser("accounts", help="List accounts as JSON.")
    accounts_parser.set_defaults(func=command_accounts)

    transaction_parser = subparsers.add_parser("transaction", help="Show one transaction with tags and notes as JSON.")
    transaction_parser.add_argument("id", type=positive_int)
    transaction_parser.set_defaults(func=command_transaction)

    import_csv_parser = subparsers.add_parser(
        "import-csv",
        help="Import CSV rows into imported_source and raw_imported_rows.",
    )
    import_csv_parser.add_argument("csv_path", type=Path)
    import_csv_parser.add_argument("--account-id", type=positive_int, required=True)
    import_csv_parser.add_argument("--source-type", default="csv")
    import_csv_parser.set_defaults(func=command_import_csv)

    add_account_parser = subparsers.add_parser("add-account", help="Add an account and print the account as JSON.")
    add_account_parser.add_argument("--name", required=True)
    add_account_parser.add_argument("--institution")
    add_account_parser.add_argument("--account-type")
    add_account_parser.add_argument("--currency", default="USD")
    add_account_parser.add_argument("--external-account-id")
    add_account_parser.set_defaults(func=command_add_account)

    rename_account_parser = subparsers.add_parser("rename-account", help="Rename an account and print it as JSON.")
    rename_account_parser.add_argument("id", type=positive_int)
    rename_account_parser.add_argument("--name", required=True)
    rename_account_parser.set_defaults(func=command_rename_account)

    add_note_parser = subparsers.add_parser("add-note", help="Add a note to a transaction and print the note as JSON.")
    add_note_parser.add_argument("--transaction-id", type=positive_int, required=True)
    add_note_parser.add_argument("--note", required=True)
    add_note_parser.set_defaults(func=command_add_note)

    add_tag_parser = subparsers.add_parser("add-tag", help="Add a tag and print it as JSON.")
    add_tag_parser.add_argument("--name", required=True)
    add_tag_parser.set_defaults(func=command_add_tag)

    tag_transaction_parser = subparsers.add_parser(
        "tag-transaction",
        help="Apply an existing tag to a transaction and print the transaction tag row as JSON.",
    )
    tag_transaction_parser.add_argument("--transaction-id", type=positive_int, required=True)
    tag_transaction_parser.add_argument("--tag", required=True)
    tag_transaction_parser.set_defaults(func=command_tag_transaction)

    untag_transaction_parser = subparsers.add_parser(
        "untag-transaction",
        help="Remove a tag from a transaction and print the removed transaction tag row as JSON.",
    )
    untag_transaction_parser.add_argument("--transaction-id", type=positive_int, required=True)
    untag_transaction_parser.add_argument("--tag", required=True)
    untag_transaction_parser.set_defaults(func=command_untag_transaction)

    add_rule_parser = subparsers.add_parser(
        "add-transaction-rule",
        help="Add a transaction import rule and print it as JSON.",
    )
    add_rule_parser.add_argument("--name", required=True)
    add_rule_parser.add_argument("--match-field", choices=sorted(MATCH_FIELDS), required=True)
    add_rule_parser.add_argument("--match-type", choices=sorted(MATCH_TYPES), required=True)
    add_rule_parser.add_argument("--match-value", required=True)
    add_rule_parser.add_argument("--set-category-id", type=positive_int)
    add_rule_parser.add_argument("--set-merchant-clean")
    add_rule_parser.add_argument("--add-tag-id", type=positive_int)
    add_rule_parser.add_argument("--priority", type=nonnegative_int, default=100)
    add_rule_parser.add_argument("--inactive", action="store_true")
    add_rule_parser.set_defaults(func=command_add_transaction_rule)

    update_rule_parser = subparsers.add_parser(
        "update-transaction-rule",
        help="Update a transaction import rule and print it as JSON.",
    )
    update_rule_parser.add_argument("id", type=positive_int)
    update_rule_parser.add_argument("--name")
    update_rule_parser.add_argument("--match-field", choices=sorted(MATCH_FIELDS))
    update_rule_parser.add_argument("--match-type", choices=sorted(MATCH_TYPES))
    update_rule_parser.add_argument("--match-value")
    category_group = update_rule_parser.add_mutually_exclusive_group()
    category_group.add_argument("--set-category-id", type=positive_int)
    category_group.add_argument("--clear-category", action="store_true")
    merchant_group = update_rule_parser.add_mutually_exclusive_group()
    merchant_group.add_argument("--set-merchant-clean")
    merchant_group.add_argument("--clear-merchant-clean", action="store_true")
    tag_group = update_rule_parser.add_mutually_exclusive_group()
    tag_group.add_argument("--add-tag-id", type=positive_int)
    tag_group.add_argument("--clear-tag", action="store_true")
    update_rule_parser.add_argument("--priority", type=nonnegative_int)
    active_group = update_rule_parser.add_mutually_exclusive_group()
    active_group.add_argument("--active", action="store_true")
    active_group.add_argument("--inactive", action="store_true")
    update_rule_parser.set_defaults(func=command_update_transaction_rule)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    try:
        args.func(args)
    except CliError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    except sqlite3.Error as exc:
        print(f"sqlite error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
