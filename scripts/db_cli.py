from __future__ import annotations

import argparse
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


class CliError(Exception):
    pass


def connect(db_path: Path, readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        require_existing_db(db_path)
        uri = f"file:{db_path.resolve().as_posix()}?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
    else:
        db_path.parent.mkdir(parents=True, exist_ok=True)
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
                a.institution,
                a.account_type,
                a.currency,
                COUNT(t.id) AS transaction_count
            FROM accounts a
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
                sf.filename AS source_file,
                rr.row_number AS source_row
            FROM transactions t
            JOIN accounts a ON a.id = t.account_id
            LEFT JOIN categories c ON c.id = t.category_id
            LEFT JOIN imported_source_files sf ON sf.id = t.import_source_file_id
            LEFT JOIN raw_imported_rows rr ON rr.id = t.raw_imported_row_id
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
            "  python scripts/db_cli.py --db data/transactions.sqlite accounts"
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
    transaction_parser.add_argument("id", type=int)
    transaction_parser.set_defaults(func=command_transaction)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    try:
        args.func(args)
    except CliError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    except sqlite3.Error as exc:
        print(f"sqlite error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
