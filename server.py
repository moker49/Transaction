from __future__ import annotations

import json
import os
import sqlite3
import sys
from contextlib import closing
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from flask import Flask, jsonify, request, send_from_directory


ROOT = Path(__file__).resolve().parent
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from db_cli import (  # noqa: E402
    CliError,
    DEFAULT_DB_PATH,
    apply_import_rules,
    connect,
    detect_csv_layout,
    fetch_account,
    fetch_imported_source,
    fetch_tag_by_id,
    fetch_tag_by_name,
    fetch_transaction_rule,
    get_or_create_institution,
    import_raw_rows,
    nonempty,
    normalize_currency,
    optional_nonempty,
    read_csv_import_rows,
    require_category,
    raw_row_hash,
    sync_raw_row_ready_status,
    validate_match_field,
    validate_match_type,
    validate_rule_actions,
)
from init_db import init_db  # noqa: E402


app = Flask(__name__, static_folder=str(ROOT), static_url_path="")


@app.errorhandler(CliError)
def handle_cli_error(error: CliError):
    return jsonify({"error": str(error)}), 400


@app.errorhandler(sqlite3.IntegrityError)
def handle_integrity_error(error: sqlite3.IntegrityError):
    return jsonify({"error": f"Database constraint failed: {error}"}), 400


@app.errorhandler(sqlite3.Error)
def handle_sqlite_error(error: sqlite3.Error):
    if "readonly database" in str(error).lower():
        return jsonify(
            {
                "error": (
                    "SQLite database is read-only for this server process. "
                    "Stop the current Flask server and restart it from a normal terminal with: python server.py"
                )
            }
        ), 500
    return jsonify({"error": f"SQLite error: {error}"}), 500


@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "database": str(DEFAULT_DB_PATH)})


@app.get("/api/state")
def get_state():
    ensure_database()
    with closing(connect(DEFAULT_DB_PATH)) as conn:
        state = read_state(conn)
        conn.commit()
        return jsonify(state)


@app.post("/api/accounts")
def create_account():
    ensure_database()
    data = request.get_json(silent=True) or {}
    name = nonempty(str(data.get("name", "")), "name")
    institution = optional_nonempty(data.get("institution"), "institution")
    account_type = optional_nonempty(data.get("account_type"), "account_type")
    currency = normalize_currency(str(data.get("currency", "USD")))

    with closing(connect(DEFAULT_DB_PATH)) as conn:
        institution_id = get_or_create_institution(conn, institution)
        cursor = conn.execute(
            """
            INSERT INTO accounts (institution_id, name, account_type, currency)
            VALUES (?, ?, ?, ?)
            """,
            (institution_id, name, account_type, currency),
        )
        account = dict(fetch_account(conn, int(cursor.lastrowid)))
        state = read_state(conn)
        conn.commit()

    return jsonify({"account": account, "state": state}), 201


@app.post("/api/tags")
def create_tag():
    ensure_database()
    data = request.get_json(silent=True) or {}
    name = nonempty(str(data.get("name", "")), "name")

    with closing(connect(DEFAULT_DB_PATH)) as conn:
        if fetch_tag_by_name(conn, name) is not None:
            raise CliError(f"Tag already exists: {name}")
        cursor = conn.execute("INSERT INTO tags (name) VALUES (?)", (name,))
        tag = dict(fetch_tag_by_id(conn, int(cursor.lastrowid)))
        state = read_state(conn)
        conn.commit()

    return jsonify({"tag": tag, "state": state}), 201


@app.post("/api/categories")
def create_category():
    ensure_database()
    data = request.get_json(silent=True) or {}
    name = nonempty(str(data.get("name", "")), "name")

    with closing(connect(DEFAULT_DB_PATH)) as conn:
        existing = conn.execute(
            "SELECT id FROM categories WHERE name = ?",
            (name,),
        ).fetchone()
        if existing is not None:
            raise CliError(f"Category already exists: {name}")
        cursor = conn.execute("INSERT INTO categories (name) VALUES (?)", (name,))
        category = dict(fetch_category(conn, int(cursor.lastrowid)))
        state = read_state(conn)
        conn.commit()

    return jsonify({"category": category, "state": state}), 201


@app.post("/api/rules")
def create_rule():
    ensure_database()
    data = request.get_json(silent=True) or {}
    name = nonempty(str(data.get("name", "")), "name")
    match_field = validate_match_field(str(data.get("match_field", "")))
    match_type = validate_match_type(str(data.get("match_type", "")))
    match_value = nonempty(str(data.get("match_value", "")), "match_value")
    set_category_id = int(data["set_category_id"]) if data.get("set_category_id") is not None else None
    set_clean_description = optional_nonempty(data.get("set_clean_description"), "set_clean_description")
    add_tag_id = int(data["add_tag_id"]) if data.get("add_tag_id") is not None else None
    priority = int(data.get("priority", 100))

    validate_rule_actions(set_category_id, set_clean_description, add_tag_id)

    with closing(connect(DEFAULT_DB_PATH)) as conn:
        if set_category_id is not None:
            require_category(conn, set_category_id)
        if add_tag_id is not None:
            fetch_tag_by_id(conn, add_tag_id)
        cursor = conn.execute(
            """
            INSERT INTO transaction_import_rules (
                name,
                match_field,
                match_type,
                match_value,
                set_category_id,
                set_clean_description,
                add_tag_id,
                priority
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (name, match_field, match_type, match_value, set_category_id, set_clean_description, add_tag_id, priority),
        )
        rule = dict(fetch_transaction_rule(conn, int(cursor.lastrowid)))
        state = read_state(conn)
        conn.commit()

    return jsonify({"transaction_rule": rule, "state": state}), 201


@app.post("/api/imports/csv")
def import_csv():
    ensure_database()
    file = request.files.get("csvFile")
    if file is None or not file.filename:
        raise CliError("Choose a CSV file.")

    account_id = parse_positive_int(request.form.get("accountId"), "accountId")
    source_type = optional_nonempty(request.form.get("sourceType"), "source_type") or "csv"
    csv_bytes = file.read()
    if not csv_bytes:
        raise CliError("CSV file is empty.")

    with NamedTemporaryFile("wb", suffix=".csv", delete=False) as temp_file:
        temp_file.write(csv_bytes)
        temp_path = Path(temp_file.name)

    try:
        fieldnames, raw_rows = read_csv_import_rows(temp_path)
    finally:
        temp_path.unlink(missing_ok=True)

    file_hash = __import__("hashlib").sha256(csv_bytes).hexdigest()
    metadata = {
        "columns": fieldnames,
        "layout": detect_csv_layout(fieldnames),
    }

    with closing(connect(DEFAULT_DB_PATH)) as conn:
        account = dict(fetch_account(conn, account_id))
        existing = conn.execute(
            "SELECT id, account_id FROM imported_source WHERE sha256 = ?",
            (file_hash,),
        ).fetchone()
        if existing is not None:
            if int(existing["account_id"]) != account_id:
                raise CliError(
                    "CSV file has already been imported for a different account "
                    f"({existing['account_id']})."
                )
            source = dict(fetch_imported_source(conn, int(existing["id"])))
            state = read_state(conn)
            return jsonify(
                {
                    "status": "already_imported",
                    "account": account,
                    "imported_source": source,
                    "inserted_raw_row_count": 0,
                    "state": state,
                }
            )

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
                account_id,
                Path(file.filename).name,
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
                raw_category,
                raw_description,
                raw_amount,
                raw_row_hash
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    imported_source_id,
                    row["raw_date"],
                    row["raw_category"],
                    row["raw_description"],
                    row["raw_amount"],
                    raw_row_hash(row),
                )
                for row in raw_rows
            ],
        )
        source = dict(fetch_imported_source(conn, imported_source_id))
        state = read_state(conn)
        conn.commit()

    return jsonify(
        {
            "status": "imported",
            "account": account,
            "imported_source": source,
            "inserted_raw_row_count": len(raw_rows),
            "state": state,
        }
    ), 201


@app.post("/api/raw-rows/import")
def import_selected_raw_rows():
    ensure_database()
    data = request.get_json(silent=True) or {}
    raw_row_ids = data.get("raw_row_ids")
    if not isinstance(raw_row_ids, list):
        raise CliError("raw_row_ids must be a list.")
    raw_row_notes = data.get("raw_row_notes") or {}
    if not isinstance(raw_row_notes, dict):
        raise CliError("raw_row_notes must be an object.")

    with closing(connect(DEFAULT_DB_PATH)) as conn:
        result = import_raw_rows(
            conn,
            [parse_positive_int(str(row_id), "raw_row_id") for row_id in raw_row_ids],
            {
                parse_positive_int(str(row_id), "raw_row_note id"): str(note)
                for row_id, note in raw_row_notes.items()
            },
        )
        state = read_state(conn)
        conn.commit()

    return jsonify({"import_result": result, "state": state})


def ensure_database() -> None:
    init_db(DEFAULT_DB_PATH)


def read_state(conn: sqlite3.Connection) -> dict[str, Any]:
    sync_raw_row_ready_status(conn)
    accounts = rows_to_dicts(
        conn.execute(
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
            ORDER BY a.name, a.id
            """
        ).fetchall()
    )
    imports = rows_to_dicts(
        conn.execute(
            """
            SELECT
                id,
                account_id,
                filename,
                source_type,
                sha256,
                imported_at,
                row_count,
                metadata_json
            FROM imported_source
            ORDER BY imported_at, id
            """
        ).fetchall()
    )
    raw_rows = rows_to_dicts(
        conn.execute(
            """
            SELECT
                rr.id,
                rr.imported_source_id,
                src.account_id,
                rr.raw_date,
                rr.raw_category,
                rr.raw_description,
                rr.raw_amount,
                rr.parsed_transaction_id,
                rr.import_status,
                rr.import_error,
                rr.raw_row_hash,
                rr.created_at,
                rr.updated_at
            FROM raw_imported_rows rr
            JOIN imported_source src ON src.id = rr.imported_source_id
            ORDER BY rr.id
            """
        ).fetchall()
    )
    transactions = rows_to_dicts(
        conn.execute(
            """
            SELECT
                t.id,
                t.account_id,
                a.name AS account,
                t.category_id,
                c.name AS category,
                t.posted_date,
                t.transaction_date,
                t.clean_description,
                t.amount_cents,
                printf('%.2f', t.amount_cents / 100.0) AS amount,
                t.currency,
                t.status,
                t.raw_imported_row_id,
                COALESCE(group_concat(n.note, char(10)), '') AS notes,
                t.created_at,
                t.updated_at
            FROM transactions t
            JOIN accounts a ON a.id = t.account_id
            LEFT JOIN categories c ON c.id = t.category_id
            LEFT JOIN transaction_notes n ON n.transaction_id = t.id
            GROUP BY t.id
            ORDER BY t.posted_date DESC, t.id DESC
            """
        ).fetchall()
    )
    categories = rows_to_dicts(
        conn.execute("SELECT id, name, parent_id, created_at FROM categories ORDER BY name, id").fetchall()
    )
    tags = rows_to_dicts(conn.execute("SELECT id, name, created_at FROM tags ORDER BY name, id").fetchall())
    rules = rows_to_dicts(
        conn.execute(
            """
            SELECT
                r.id,
                r.name,
                r.match_field,
                r.match_type,
                r.match_value,
                r.set_category_id,
                c.name AS set_category,
                r.set_clean_description,
                r.add_tag_id,
                tags.name AS add_tag,
                r.priority,
                r.is_active,
                r.created_at,
                r.updated_at
            FROM transaction_import_rules r
            LEFT JOIN categories c ON c.id = r.set_category_id
            LEFT JOIN tags ON tags.id = r.add_tag_id
            ORDER BY r.priority, r.id
            """
        ).fetchall()
    )
    logs = rows_to_dicts(
        conn.execute(
            """
            SELECT id, level, source, message, details_json, created_at
            FROM logs
            ORDER BY created_at DESC, id DESC
            LIMIT 100
            """
        ).fetchall()
    )

    for item in imports:
        item["metadata"] = parse_metadata(item.pop("metadata_json"))
    categories_by_id = {category["id"]: category["name"] for category in categories}
    for row in raw_rows:
        preview = apply_import_rules(conn, row) if row["import_status"] == "ready" else {}
        preview_category_id = preview.get("category_id")
        row["preview_category"] = categories_by_id.get(preview_category_id) if preview_category_id is not None else None
        row["preview_clean_description"] = preview.get("clean_description")
    for rule in rules:
        rule["is_active"] = bool(rule["is_active"])
    for log in logs:
        log["details"] = parse_metadata(log.pop("details_json"))

    return {
        "accounts": accounts,
        "categories": categories,
        "tags": tags,
        "rules": rules,
        "imports": imports,
        "transactions": transactions,
        "rawRows": raw_rows,
        "logs": logs,
    }


def rows_to_dicts(rows) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def fetch_category(conn: sqlite3.Connection, category_id: int) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT id, name, parent_id, created_at
        FROM categories
        WHERE id = ?
        """,
        (category_id,),
    ).fetchone()
    if row is None:
        raise CliError(f"Category not found: {category_id}")
    return row


def parse_metadata(value: str | None) -> dict[str, Any]:
    if not value:
        return {"columns": [], "layout": "generic_csv"}
    try:
        metadata = json.loads(value)
    except json.JSONDecodeError:
        return {"columns": [], "layout": "generic_csv"}
    if not isinstance(metadata, dict):
        return {"columns": [], "layout": "generic_csv"}
    metadata.setdefault("columns", [])
    metadata.setdefault("layout", "generic_csv")
    return metadata


def parse_positive_int(value: str | None, field_name: str) -> int:
    try:
        parsed = int(value or "")
    except ValueError as exc:
        raise CliError(f"{field_name} must be an integer.") from exc
    if parsed < 1:
        raise CliError(f"{field_name} must be greater than 0.")
    return parsed


if __name__ == "__main__":
    ensure_database()
    app.run(debug=True, port=int(os.environ.get("PORT", "5050")), use_reloader=False)
