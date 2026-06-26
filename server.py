from __future__ import annotations

import json
import mimetypes
import os
import shutil
import sqlite3
import sys
import time
from contextlib import closing
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from flask import Flask, jsonify, request, send_from_directory, has_request_context, g


ROOT = Path(__file__).resolve().parent
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import db_cli as db_cli_module  # noqa: E402
from db_cli import (  # noqa: E402
    CliError,
    DEFAULT_DB_PATH,
    apply_import_rule_rows,
    connect,
    detect_csv_layout,
    fetch_active_rules,
    fetch_account,
    fetch_account_by_import_key,
    fetch_imported_source,
    find_imported_source_by_signature,
    fetch_duplicate_transaction_rule,
    fetch_rule_tag_ids_by_rule,
    fetch_tag_by_id,
    fetch_tag_by_name,
    fetch_transaction_rule,
    format_prefilled_clean_description,
    get_or_create_institution,
    import_raw_rows,
    imported_source_signature,
    nonempty,
    optional_nonempty,
    read_csv_import_rows,
    require_category_allowed_for_transaction_type,
    require_category,
    require_account_unused,
    require_category_unused,
    require_tag_unused,
    raw_row_hash,
    sync_raw_row_importability_status,
    validate_rule_type,
    validate_match_amount,
    validate_transaction_type,
    validate_rule_payload,
    parse_amount_cents,
    parse_transaction_date,
    make_transaction_hash,
    normalize_match_text,
    normalize_rule_match_text,
    normalize_text,
)
from init_db import init_db  # noqa: E402


mimetypes.add_type("application/javascript", ".mjs")
app = Flask(__name__, static_folder=str(ROOT), static_url_path="")
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
DUMMY_DB_PATH = DEFAULT_DB_PATH.with_name("transactions.dummy.sqlite")
DUMMY_RESTORE_DB_PATH = DEFAULT_DB_PATH.with_name("transactions.dummy.restore.sqlite")
BILL_TAG_NAME = "bill"
TRANSACTION_TYPES = ("income", "expense", "transfer")
DASHBOARD_CATEGORY_SEGMENT_LIMIT = 8
ENSURED_DATABASE_PATHS: set[Path] = set()
DEFAULT_CATEGORIES = (
    {"name": "Income", "color": "#208020", "children": ("Salary", "Bonus", "Interest", "Dividend", "Refund", "Gift Received", "Resale")},
    {"name": "Housing", "color": "#c4588e", "children": ("Rent", "Mortgage", "Property Tax", "HOA", "Home Insurance", "Home Maintenance")},
    {"name": "Utility", "color": "#91a82f", "children": ("Electric", "Gas", "Water", "Sewer", "Trash", "Internet", "Phone")},
    {"name": "Food", "color": "#d16630", "children": ("Groceries", "Restaurant", "Cafe", "Convenience")},
    {"name": "Transportation", "color": "#3a67c2", "children": ("Car Payment", "Fuel", "Charging", "Auto Insurance", "Maintenance", "Registration", "Parking", "Toll", "Public Transit", "Taxi")},
    {"name": "Shopping", "color": "#8161c2", "children": ("Clothing", "Electronic", "Household", "Furniture")},
    {"name": "Health", "color": "#ad3131", "children": ("Medical", "Dental", "Vision", "Pharmacy", "Fitness")},
    {"name": "Lifestyle", "color": "#36b36a", "children": ("Activity", "Hobby", "Alcohol", "Substance")},
    {"name": "Entertainment", "color": "#602699", "children": ("Streaming", "Gaming", "Movie", "Music", "App")},
    {"name": "Travel", "color": "#109e9e", "children": ("Hotel", "Flight", "Rental")},
    {"name": "Financial", "color": "#b68b2e", "children": ("Fee", "Loan Payment", "Investment", "Tax Payment", "Fine", "Loss")},
    {"name": "Insurance", "color": "#d18eb0", "children": ("Life Insurance", "Umbrella Insurance", "Protection")},
    {"name": "Education", "color": "#4d8fbf", "children": ("Tuition", "Books", "Courses", "Certifications")},
    {"name": "Personal", "color": "#7a5234", "children": ("Childcare", "Pet Expense", "Gift Given", "Personal Care", "Reimbursement")},
    {"name": "Business", "color": "#60943b", "children": ("Software", "Equipment", "Service", "Office Expense")},
    {"name": "Transfer", "color": "#787b80", "children": ("Internal Transfer", "Card Payment")},
    {"name": "Unknown", "color": "#1f2328", "children": ()},
)
DEFAULT_CATEGORY_NAMES = frozenset(
    name
    for category in DEFAULT_CATEGORIES
    for name in (str(category["name"]), *tuple(str(child) for child in category["children"]))
)
DEFAULT_CATEGORY_SORT_ORDER = {
    str(category["name"]): index * 1000
    for index, category in enumerate(DEFAULT_CATEGORIES)
} | {
    str(child): index * 1000 + child_index + 1
    for index, category in enumerate(DEFAULT_CATEGORIES)
    for child_index, child in enumerate(category["children"])
}


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


@app.before_request
def record_request_start():
    g.request_started_at = time.perf_counter()


@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.after_request
def prevent_static_cache(response):
    if request.path in {"/", "/index.html"} or request.path.endswith((".js", ".mjs", ".css")):
        response.headers["Cache-Control"] = "no-store, max-age=0"
    started_at = getattr(g, "request_started_at", None)
    if started_at is not None:
        timing = f"total;dur={elapsed_ms(started_at):.1f}"
        existing_timing = response.headers.get("Server-Timing")
        response.headers["Server-Timing"] = f"{existing_timing}, {timing}" if existing_timing else timing
    return response


@app.get("/api/debug/runtime")
def debug_runtime():
    db_cli_path = Path(db_cli_module.__file__).resolve()
    return jsonify(
        {
            "db_cli_path": str(db_cli_path),
            "db_cli_mtime": db_cli_path.stat().st_mtime,
            "server_path": str(Path(__file__).resolve()),
        }
    )


@app.get("/api/health")
def health():
    db_path = current_db_path()
    return jsonify({"status": "ok", "database": str(db_path), "is_dummy_database": db_path == DUMMY_DB_PATH})


@app.get("/api/state")
def get_state():
    ensure_database()
    with closing(connect(current_db_path())) as conn:
        state = read_state(conn)
        conn.commit()
        return jsonify(state)


@app.get("/api/reference-data")
def get_reference_data():
    ensure_database()
    with closing(connect(current_db_path())) as conn:
        reference_data = read_reference_data(conn)
        conn.commit()
    return jsonify({"referenceData": reference_data})


@app.get("/api/transactions")
def get_transaction_data():
    request_started_at = time.perf_counter()
    ensure_started_at = time.perf_counter()
    ensure_database()
    ensure_elapsed_ms = elapsed_ms(ensure_started_at)
    start_date = parse_date_query_param(request.args.get("startDate"), "startDate")
    end_date = parse_date_query_param(request.args.get("endDate"), "endDate")
    if start_date > end_date:
        raise CliError("startDate must be on or before endDate.")
    with closing(connect(current_db_path())) as conn:
        read_started_at = time.perf_counter()
        transaction_data = read_transaction_data(conn, start_date, end_date)
        read_elapsed_ms = elapsed_ms(read_started_at)
        conn.commit()
    response = jsonify({"transactionData": transaction_data})
    total_elapsed_ms = elapsed_ms(request_started_at)
    response.headers["Server-Timing"] = (
        f"ensure;dur={ensure_elapsed_ms:.1f}, "
        f"read;dur={read_elapsed_ms:.1f}, "
        f"handler;dur={total_elapsed_ms:.1f}"
    )
    response.headers["X-Transaction-Count"] = str(len(transaction_data["realTransactions"]))
    response.headers["X-Raw-Transaction-Count"] = str(len(transaction_data["rawTransactions"]))
    return response


@app.post("/api/accounts")
def create_account():
    ensure_database()
    data = request.get_json(silent=True) or {}
    name = nonempty(str(data.get("name", "")), "name")
    if name.casefold() == BILL_TAG_NAME:
        raise CliError(f"Tag is protected and already managed by the system: {BILL_TAG_NAME}")
    institution = optional_nonempty(data.get("institution"), "institution")
    account_type = optional_nonempty(data.get("account_type"), "account_type")

    with closing(connect(current_db_path())) as conn:
        institution_id = get_or_create_institution(conn, institution)
        cursor = conn.execute(
            """
            INSERT INTO accounts (institution_id, name, account_type)
            VALUES (?, ?, ?)
            """,
            (institution_id, name, account_type),
        )
        account = dict(fetch_account(conn, int(cursor.lastrowid)))
        reference_data = read_reference_data(conn)
        conn.commit()

    return jsonify({"account": account, "referenceData": reference_data}), 201


@app.patch("/api/accounts/<int:account_id>")
def update_account(account_id: int):
    ensure_database()
    data = request.get_json(silent=True) or {}
    updates: list[str] = []
    values: list[Any] = []

    with closing(connect(current_db_path())) as conn:
        fetch_account(conn, account_id)
        if "name" in data:
            updates.append("name = ?")
            values.append(nonempty(str(data.get("name", "")), "name"))
        if "institution" in data:
            updates.append("institution_id = ?")
            values.append(get_or_create_institution(conn, optional_nonempty(data.get("institution"), "institution")))
        if "account_type" in data:
            updates.append("account_type = ?")
            values.append(optional_nonempty(data.get("account_type"), "account_type"))
        if not updates:
            raise CliError("No changes requested.")

        updates.append("updated_at = datetime('now')")
        values.append(account_id)
        conn.execute(f"UPDATE accounts SET {', '.join(updates)} WHERE id = ?", values)
        account = dict(fetch_account(conn, account_id))
        payload = mutation_response_payload(conn, raw_status_current=True)
        conn.commit()

    return jsonify({"account": account, **payload})


@app.delete("/api/accounts/<int:account_id>")
def delete_account(account_id: int):
    ensure_database()
    with closing(connect(current_db_path())) as conn:
        account = dict(fetch_account(conn, account_id))
        require_account_unused(conn, account_id)
        conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
        reference_data = read_reference_data(conn)
        conn.commit()

    return jsonify({"status": "deleted", "account": account, "referenceData": reference_data})


@app.delete("/api/imports/<int:imported_source_id>")
def delete_imported_source(imported_source_id: int):
    ensure_database()
    with closing(connect(current_db_path())) as conn:
        ensure_uploaded_file_delete_indexes(conn)
        source = conn.execute(
            """
            SELECT id, filename
            FROM imported_source
            WHERE id = ?
            """,
            (imported_source_id,),
        ).fetchone()
        if source is None:
            raise CliError(f"Uploaded file not found: {imported_source_id}")

        raw_row_count = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM raw_imported_rows
            WHERE imported_source_id = ?
            """,
            (imported_source_id,),
        ).fetchone()["count"]
        deleted_transactions = conn.execute(
            """
            DELETE FROM transactions
            WHERE raw_imported_row_id IN (
                SELECT id
                FROM raw_imported_rows
                WHERE imported_source_id = ?
            )
            """,
            (imported_source_id,),
        )
        deleted_transaction_count = max(deleted_transactions.rowcount or 0, 0)
        conn.execute("DELETE FROM imported_source WHERE id = ?", (imported_source_id,))
        payload = mutation_response_payload(conn, refresh_raw_status=True)
        conn.commit()

    return jsonify(
        {
            "status": "deleted",
            "imported_source": dict(source),
            "deleted_raw_row_count": raw_row_count,
            "deleted_transaction_count": deleted_transaction_count,
            **payload,
        }
    )


@app.post("/api/tags")
def create_tag():
    ensure_database()
    data = request.get_json(silent=True) or {}
    name = nonempty(str(data.get("name", "")), "name")

    with closing(connect(current_db_path())) as conn:
        if fetch_tag_by_name(conn, name) is not None:
            raise CliError(f"Tag already exists: {name}")
        cursor = conn.execute("INSERT INTO tags (name) VALUES (?)", (name,))
        tag = dict(fetch_tag_by_id(conn, int(cursor.lastrowid)))
        state = read_state(conn)
        conn.commit()

    return jsonify({"tag": tag, "state": state}), 201


@app.patch("/api/tags/<int:tag_id>")
def update_tag(tag_id: int):
    ensure_database()
    data = request.get_json(silent=True) or {}
    name = nonempty(str(data.get("name", "")), "name")

    with closing(connect(current_db_path())) as conn:
        tag = dict(fetch_tag_by_id(conn, tag_id))
        if is_protected_tag(tag):
            raise CliError(f"Tag is protected and cannot be edited: {tag['name']}")
        if name.casefold() == BILL_TAG_NAME:
            raise CliError(f"Tag is protected and already managed by the system: {BILL_TAG_NAME}")
        conn.execute("UPDATE tags SET name = ? WHERE id = ?", (name, tag_id))
        tag = dict(fetch_tag_by_id(conn, tag_id))
        state = read_state(conn)
        conn.commit()

    return jsonify({"tag": tag, "state": state})


@app.delete("/api/tags/<int:tag_id>")
def delete_tag(tag_id: int):
    ensure_database()
    with closing(connect(current_db_path())) as conn:
        tag = dict(fetch_tag_by_id(conn, tag_id))
        if is_protected_tag(tag):
            raise CliError(f"Tag is protected and cannot be deleted: {tag['name']}")
        require_tag_unused(conn, tag_id)
        conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        state = read_state(conn)
        conn.commit()

    return jsonify({"status": "deleted", "tag": tag, "state": state})


@app.post("/api/categories")
def create_category():
    ensure_database()
    data = request.get_json(silent=True) or {}
    name = nonempty(str(data.get("name", "")), "name")
    parent_id = int(data["parent_id"]) if data.get("parent_id") is not None else None
    color = validate_category_color(data.get("color")) if parent_id is None else None

    with closing(connect(current_db_path())) as conn:
        if parent_id is not None:
            parent = dict(fetch_category(conn, parent_id))
            if parent["parent_id"] is not None:
                raise CliError("Category parent must be a top-level category.")
        existing = conn.execute(
            "SELECT id FROM categories WHERE name = ?",
            (name,),
        ).fetchone()
        if existing is not None:
            raise CliError(f"Category already exists: {name}")
        cursor = conn.execute("INSERT INTO categories (name, parent_id, color) VALUES (?, ?, ?)", (name, parent_id, color))
        category = dict(fetch_category(conn, int(cursor.lastrowid)))
        state = read_state(conn)
        conn.commit()

    return jsonify({"category": category, "state": state}), 201


@app.patch("/api/categories/<int:category_id>")
def update_category(category_id: int):
    ensure_database()
    data = request.get_json(silent=True) or {}
    name = nonempty(str(data.get("name", "")), "name")
    parent_id = int(data["parent_id"]) if data.get("parent_id") is not None else None
    color = validate_category_color(data.get("color")) if parent_id is None else None

    with closing(connect(current_db_path())) as conn:
        category = dict(fetch_category(conn, category_id))
        if category["name"] in DEFAULT_CATEGORY_NAMES:
            raise CliError(f"Default category cannot be edited: {category['name']}")
        if parent_id == category_id:
            raise CliError("Category cannot be its own parent.")
        if parent_id is not None:
            if category_descendant_ids(conn, category_id):
                raise CliError("Category with child categories cannot be moved under another parent.")
            parent = dict(fetch_category(conn, parent_id))
            if parent["parent_id"] is not None:
                raise CliError("Category parent must be a top-level category.")
            if parent_id in category_descendant_ids(conn, category_id):
                raise CliError("Category cannot use a descendant as its parent.")
        conn.execute("UPDATE categories SET name = ?, parent_id = ?, color = ? WHERE id = ?", (name, parent_id, color, category_id))
        category = dict(fetch_category(conn, category_id))
        state = read_state(conn)
        conn.commit()

    return jsonify({"category": category, "state": state})


@app.delete("/api/categories/<int:category_id>")
def delete_category(category_id: int):
    ensure_database()
    with closing(connect(current_db_path())) as conn:
        category = dict(fetch_category(conn, category_id))
        if category["name"] in DEFAULT_CATEGORY_NAMES:
            raise CliError(f"Default category cannot be deleted: {category['name']}")
        require_category_unused(conn, category_id)
        conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))
        state = read_state(conn)
        conn.commit()

    return jsonify({"status": "deleted", "category": category, "state": state})


def parse_rule_match_inputs(data: dict[str, Any]) -> tuple[str | None, str | None]:
    match_description = optional_nonempty(data.get("match_description"), "match_description")
    match_category = optional_nonempty(data.get("match_category"), "match_category")
    if match_description is None and match_category is None:
        raise CliError("Rule must match description, category, or both.")
    return match_description, match_category


def legacy_rule_match(match_description: str | None, match_category: str | None) -> tuple[str, str, str]:
    if match_description is not None:
        return "description", "contains", match_description
    if match_category is not None:
        return "category", "contains", match_category
    raise CliError("Rule must match description, category, or both.")


def opposite_match_amount(match_amount: str) -> str:
    if match_amount == "positive":
        return "negative"
    if match_amount == "negative":
        return "positive"
    raise CliError("Only positive and negative match amounts can be split.")


def fetch_rule_by_match_amount(
    conn: sqlite3.Connection,
    rule_type: str,
    match_description: str | None,
    match_category: str | None,
    match_amount: str,
    exclude_rule_id: int | None = None,
) -> sqlite3.Row | None:
    return fetch_duplicate_transaction_rule(
        conn,
        rule_type,
        match_description,
        match_category,
        match_amount,
        exclude_rule_id=exclude_rule_id,
    )


def prepare_rule_amount_create(
    conn: sqlite3.Connection,
    rule_type: str,
    match_description: str | None,
    match_category: str | None,
    match_amount: str,
) -> None:
    duplicate = fetch_rule_by_match_amount(conn, rule_type, match_description, match_category, match_amount)
    if duplicate is not None:
        raise CliError(f"Duplicate rule matches existing rule {duplicate['id']}: {duplicate['name']}")

    if match_amount == "any":
        positive_rule = fetch_rule_by_match_amount(conn, rule_type, match_description, match_category, "positive")
        negative_rule = fetch_rule_by_match_amount(conn, rule_type, match_description, match_category, "negative")
        if positive_rule is not None or negative_rule is not None:
            raise CliError("Match amount already has a positive or negative rule for the same match criteria.")
        return

    any_rule = fetch_rule_by_match_amount(conn, rule_type, match_description, match_category, "any")
    if any_rule is None:
        return
    conn.execute(
        """
        UPDATE transaction_import_rules
        SET match_amount = ?,
            updated_at = datetime('now')
        WHERE id = ?
        """,
        (opposite_match_amount(match_amount), any_rule["id"]),
    )


@app.post("/api/rules")
def create_rule():
    ensure_database()
    data = request.get_json(silent=True) or {}
    name = nonempty(str(data.get("name", "")), "name")
    rule_type = validate_rule_type(data.get("rule_type"))
    match_description, match_category = parse_rule_match_inputs(data)
    match_amount = validate_match_amount(data.get("match_amount"))
    match_field, match_type, match_value = legacy_rule_match(match_description, match_category)
    set_category_id = int(data["set_category_id"]) if data.get("set_category_id") is not None else None
    set_clean_description = optional_nonempty(data.get("set_clean_description"), "set_clean_description")
    set_transaction_type = validate_transaction_type(data.get("set_transaction_type"), allow_empty=True)
    add_tag_ids = parse_rule_tag_ids(data)
    add_tag_id = add_tag_ids[0] if add_tag_ids else None

    validate_rule_payload(rule_type, set_category_id, set_clean_description, set_transaction_type, add_tag_id)

    with closing(connect(current_db_path())) as conn:
        prepare_rule_amount_create(conn, rule_type, match_description, match_category, match_amount)
        if set_category_id is not None:
            require_category_allowed_for_transaction_type(conn, set_category_id, set_transaction_type)
        for tag_id in add_tag_ids:
            fetch_tag_by_id(conn, tag_id)
        cursor = conn.execute(
            """
            INSERT INTO transaction_import_rules (
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
                add_tag_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
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
            ),
        )
        rule_id = int(cursor.lastrowid)
        replace_rule_tags(conn, rule_id, add_tag_ids)
        rule = dict(fetch_transaction_rule(conn, rule_id))
        payload = mutation_response_payload(conn, refresh_raw_status=True)
        conn.commit()

    return jsonify({"transaction_rule": rule, **payload}), 201


@app.patch("/api/rules/<int:rule_id>")
def update_rule(rule_id: int):
    ensure_database()
    data = request.get_json(silent=True) or {}
    updates: list[str] = []
    values: list[Any] = []

    with closing(connect(current_db_path())) as conn:
        current = fetch_transaction_rule(conn, rule_id)
        next_rule_type = current["rule_type"]
        next_set_category_id = current["set_category_id"]
        next_set_clean_description = current["set_clean_description"]
        next_set_transaction_type = current["set_transaction_type"]
        next_add_tag_id = current["add_tag_id"]
        next_add_tag_ids = fetch_rule_tag_ids(conn, rule_id)
        next_match_description = current["match_description"]
        next_match_category = current["match_category"]
        next_match_amount = current["match_amount"]

        if "name" in data:
            updates.append("name = ?")
            values.append(nonempty(str(data.get("name", "")), "name"))
        if "rule_type" in data:
            next_rule_type = validate_rule_type(data.get("rule_type"))
            updates.append("rule_type = ?")
            values.append(next_rule_type)
        if "match_description" in data:
            next_match_description = optional_nonempty(data.get("match_description"), "match_description")
            updates.append("match_description = ?")
            values.append(next_match_description)
        if "match_category" in data:
            next_match_category = optional_nonempty(data.get("match_category"), "match_category")
            updates.append("match_category = ?")
            values.append(next_match_category)
        if "match_amount" in data:
            next_match_amount = validate_match_amount(data.get("match_amount"))
            updates.append("match_amount = ?")
            values.append(next_match_amount)
        if "set_category_id" in data:
            raw_category_id = data.get("set_category_id")
            next_set_category_id = int(raw_category_id) if raw_category_id is not None else None
            if next_set_category_id is not None:
                require_category(conn, next_set_category_id)
            updates.append("set_category_id = ?")
            values.append(next_set_category_id)
        if "set_clean_description" in data:
            next_set_clean_description = optional_nonempty(data.get("set_clean_description"), "set_clean_description")
            updates.append("set_clean_description = ?")
            values.append(next_set_clean_description)
        if "set_transaction_type" in data:
            next_set_transaction_type = validate_transaction_type(data.get("set_transaction_type"), allow_empty=True)
            updates.append("set_transaction_type = ?")
            values.append(next_set_transaction_type)
        if "add_tag_id" in data:
            raw_tag_id = data.get("add_tag_id")
            next_add_tag_id = int(raw_tag_id) if raw_tag_id is not None else None
            if next_add_tag_id is not None:
                fetch_tag_by_id(conn, next_add_tag_id)
            next_add_tag_ids = [next_add_tag_id] if next_add_tag_id is not None else []
            updates.append("add_tag_id = ?")
            values.append(next_add_tag_id)
        if "add_tag_ids" in data:
            next_add_tag_ids = parse_rule_tag_ids(data)
            next_add_tag_id = next_add_tag_ids[0] if next_add_tag_ids else None
            for tag_id in next_add_tag_ids:
                fetch_tag_by_id(conn, tag_id)
            updates.append("add_tag_id = ?")
            values.append(next_add_tag_id)
        if "is_active" in data:
            updates.append("is_active = ?")
            values.append(1 if data.get("is_active") else 0)
        if not updates:
            raise CliError("No changes requested.")

        if "match_description" in data or "match_category" in data:
            match_field, match_type, match_value = legacy_rule_match(next_match_description, next_match_category)
            updates.append("match_field = ?")
            values.append(match_field)
            updates.append("match_type = ?")
            values.append(match_type)
            updates.append("match_value = ?")
            values.append(match_value)

        validate_rule_payload(next_rule_type, next_set_category_id, next_set_clean_description, next_set_transaction_type, next_add_tag_id)
        if next_set_category_id is not None:
            require_category_allowed_for_transaction_type(conn, int(next_set_category_id), next_set_transaction_type)
        duplicate = fetch_duplicate_transaction_rule(
            conn,
            next_rule_type,
            next_match_description,
            next_match_category,
            next_match_amount,
            exclude_rule_id=rule_id,
        )
        if duplicate is not None:
            raise CliError(f"Duplicate rule matches existing rule {duplicate['id']}: {duplicate['name']}")

        updates.append("updated_at = datetime('now')")
        values.append(rule_id)
        conn.execute(f"UPDATE transaction_import_rules SET {', '.join(updates)} WHERE id = ?", values)
        if "add_tag_ids" in data or "add_tag_id" in data:
            replace_rule_tags(conn, rule_id, next_add_tag_ids)
        rule = dict(fetch_transaction_rule(conn, rule_id))
        payload = mutation_response_payload(conn, refresh_raw_status=True)
        conn.commit()

    return jsonify({"transaction_rule": rule, **payload})


@app.delete("/api/rules/<int:rule_id>")
def delete_rule(rule_id: int):
    ensure_database()
    with closing(connect(current_db_path())) as conn:
        rule = dict(fetch_transaction_rule(conn, rule_id))
        conn.execute("DELETE FROM transaction_import_rules WHERE id = ?", (rule_id,))
        payload = mutation_response_payload(conn, refresh_raw_status=True)
        conn.commit()

    return jsonify({"status": "deleted", "transaction_rule": rule, **payload})


@app.delete("/api/transactions/<int:transaction_id>")
def delete_transaction(transaction_id: int):
    ensure_database()
    data = request.get_json(silent=True) or {}
    delete_raw_row = bool(data.get("delete_raw_row"))
    with closing(connect(current_db_path())) as conn:
        transaction = conn.execute(
            "SELECT id, raw_imported_row_id FROM transactions WHERE id = ?",
            (transaction_id,),
        ).fetchone()
        if transaction is None:
            raise CliError(f"Transaction not found: {transaction_id}")
        raw_row_id = transaction["raw_imported_row_id"]
        conn.execute("DELETE FROM transactions WHERE id = ?", (transaction_id,))
        if delete_raw_row and raw_row_id is not None:
            conn.execute("DELETE FROM raw_imported_rows WHERE id = ?", (raw_row_id,))
        elif raw_row_id is not None:
            conn.execute(
                """
                UPDATE raw_imported_rows
                SET import_status = 'manual',
                    import_error = NULL,
                    parsed_transaction_id = NULL,
                    updated_at = datetime('now')
                WHERE id = ?
                """,
                (raw_row_id,),
            )
            sync_raw_row_importability_status(conn)
        state = read_state(conn)
        conn.commit()
    return jsonify({"status": "deleted", "transaction_id": transaction_id, "state": state})


@app.delete("/api/raw-rows/<int:raw_row_id>")
def delete_raw_row(raw_row_id: int):
    ensure_database()
    data = request.get_json(silent=True) or {}
    delete_transaction_too = bool(data.get("delete_transaction"))
    with closing(connect(current_db_path())) as conn:
        raw_row = conn.execute(
            "SELECT id, parsed_transaction_id FROM raw_imported_rows WHERE id = ?",
            (raw_row_id,),
        ).fetchone()
        if raw_row is None:
            raise CliError(f"Raw row not found: {raw_row_id}")
        transaction_id = raw_row["parsed_transaction_id"]
        if delete_transaction_too and transaction_id is not None:
            conn.execute("DELETE FROM transactions WHERE id = ?", (transaction_id,))
        conn.execute("DELETE FROM raw_imported_rows WHERE id = ?", (raw_row_id,))
        state = read_state(conn)
        conn.commit()
    return jsonify({"status": "deleted", "raw_row_id": raw_row_id, "state": state})


@app.patch("/api/transactions/<int:transaction_id>")
def update_transaction(transaction_id: int):
    ensure_database()
    data = request.get_json(silent=True) or {}
    updates: list[str] = []
    values: list[Any] = []

    with closing(connect(current_db_path())) as conn:
        transaction = conn.execute(
            """
            SELECT id, account_id, category_id, transaction_type, posted_date, amount_cents, clean_description
            FROM transactions
            WHERE id = ?
            """,
            (transaction_id,),
        ).fetchone()
        if transaction is None:
            raise CliError(f"Transaction not found: {transaction_id}")
        next_account_id = int(transaction["account_id"])
        next_category_id = int(transaction["category_id"]) if transaction["category_id"] is not None else None
        next_transaction_type = transaction["transaction_type"]
        next_posted_date = transaction["posted_date"]
        next_amount_cents = int(transaction["amount_cents"])
        next_clean_description = transaction["clean_description"]

        if "posted_date" in data:
            next_posted_date = nonempty(str(data.get("posted_date", "")), "posted_date")
            updates.append("posted_date = ?")
            updates.append("transaction_date = ?")
            values.extend([next_posted_date, next_posted_date])
        if "category_id" in data:
            raw_category_id = data.get("category_id")
            if raw_category_id in (None, ""):
                raise CliError("category_id cannot be empty.")
            category_id = int(raw_category_id)
            require_category(conn, category_id)
            next_category_id = category_id
            updates.append("category_id = ?")
            values.append(category_id)
        if "transaction_type" in data:
            transaction_type = validate_transaction_type(data.get("transaction_type"), allow_empty=False)
            next_transaction_type = transaction_type
            updates.append("transaction_type = ?")
            values.append(transaction_type)
        if "amount" in data:
            next_amount_cents = parse_amount_cents(str(data.get("amount", "")))
            updates.append("amount_cents = ?")
            values.append(next_amount_cents)
        if "clean_description" in data:
            next_clean_description = optional_nonempty(data.get("clean_description"), "clean_description")
            updates.append("clean_description = ?")
            values.append(next_clean_description)
        notes_requested = "notes" in data
        notes = normalize_text(data.get("notes")) if notes_requested else None
        tag_ids_requested = "tag_ids" in data
        tag_ids: list[int] = []
        if tag_ids_requested:
            raw_tag_ids = data.get("tag_ids")
            if not isinstance(raw_tag_ids, list):
                raise CliError("tag_ids must be a list.")
            tag_ids = sorted({int(tag_id) for tag_id in raw_tag_ids})
            for tag_id in tag_ids:
                fetch_tag_by_id(conn, tag_id)

        if updates:
            if next_category_id is not None:
                require_category_allowed_for_transaction_type(conn, next_category_id, next_transaction_type)
            updates.append("transaction_hash = ?")
            values.append(
                make_transaction_hash(
                    next_account_id,
                    next_posted_date,
                    next_amount_cents,
                    next_clean_description,
                )
            )
            updates.append("updated_at = datetime('now')")
            values.append(transaction_id)
            conn.execute(f"UPDATE transactions SET {', '.join(updates)} WHERE id = ?", values)
        if notes_requested:
            conn.execute("DELETE FROM transaction_notes WHERE transaction_id = ?", (transaction_id,))
            if notes is not None:
                conn.execute(
                    "INSERT INTO transaction_notes (transaction_id, note) VALUES (?, ?)",
                    (transaction_id, notes),
                )
        if tag_ids_requested:
            conn.execute("DELETE FROM transaction_tags WHERE transaction_id = ?", (transaction_id,))
            conn.executemany(
                "INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)",
                [(transaction_id, tag_id) for tag_id in tag_ids],
            )
        if not updates and not notes_requested and not tag_ids_requested:
            raise CliError("No changes requested.")

        state = read_state(conn)
        updated_transaction = next(
            (item for item in state["transactions"] if int(item["id"]) == transaction_id),
            None,
        )
        if updated_transaction is None:
            raise CliError(f"Transaction not found: {transaction_id}")
        conn.commit()

    return jsonify({"transaction": updated_transaction, "state": state})


@app.post("/api/transactions/bulk-edit")
def bulk_edit_transactions():
    ensure_database()
    data = request.get_json(silent=True) or {}
    raw_transaction_ids = data.get("transaction_ids")
    overrides = data.get("overrides") or {}
    if not isinstance(raw_transaction_ids, list) or not raw_transaction_ids:
        raise CliError("transaction_ids must be a non-empty list.")
    if not isinstance(overrides, dict):
        raise CliError("overrides must be an object.")
    transaction_ids = sorted({int(transaction_id) for transaction_id in raw_transaction_ids})
    allowed_override_keys = {"transaction_type", "category_id", "clean_description", "tag_ids"}
    unknown_keys = sorted(set(overrides) - allowed_override_keys)
    if unknown_keys:
        raise CliError(f"Unsupported bulk edit field: {', '.join(unknown_keys)}")

    next_transaction_type = None
    if "transaction_type" in overrides:
        next_transaction_type = validate_transaction_type(overrides.get("transaction_type"), allow_empty=False)

    next_category_id = None
    if "category_id" in overrides:
        raw_category_id = overrides.get("category_id")
        if raw_category_id in (None, ""):
            raise CliError("category_id cannot be empty.")
        next_category_id = int(raw_category_id)

    next_clean_description = None
    if "clean_description" in overrides:
        next_clean_description = optional_nonempty(overrides.get("clean_description"), "clean_description")

    tag_ids_requested = "tag_ids" in overrides
    tag_ids: list[int] = []
    if tag_ids_requested:
        raw_tag_ids = overrides.get("tag_ids")
        if not isinstance(raw_tag_ids, list):
            raise CliError("tag_ids must be a list.")
        tag_ids = sorted({int(tag_id) for tag_id in raw_tag_ids})

    if next_transaction_type is None and next_category_id is None and next_clean_description is None and not tag_ids_requested:
        raise CliError("No changes requested.")

    with closing(connect(current_db_path())) as conn:
        if next_category_id is not None:
            require_category(conn, next_category_id)
        for tag_id in tag_ids:
            fetch_tag_by_id(conn, tag_id)

        transactions = conn.execute(
            f"""
            SELECT id, account_id, category_id, transaction_type, posted_date, amount_cents, clean_description
            FROM transactions
            WHERE id IN ({','.join('?' for _ in transaction_ids)})
            """,
            transaction_ids,
        ).fetchall()
        found_ids = {int(transaction["id"]) for transaction in transactions}
        missing_ids = [transaction_id for transaction_id in transaction_ids if transaction_id not in found_ids]
        if missing_ids:
            raise CliError(f"Transaction not found: {missing_ids[0]}")

        for transaction in transactions:
            transaction_id = int(transaction["id"])
            final_category_id = next_category_id if next_category_id is not None else int(transaction["category_id"])
            final_transaction_type = next_transaction_type if next_transaction_type is not None else transaction["transaction_type"]
            final_clean_description = next_clean_description if next_clean_description is not None else transaction["clean_description"]
            require_category_allowed_for_transaction_type(conn, final_category_id, final_transaction_type)

            updates: list[str] = []
            values: list[Any] = []
            if next_transaction_type is not None:
                updates.append("transaction_type = ?")
                values.append(next_transaction_type)
            if next_category_id is not None:
                updates.append("category_id = ?")
                values.append(next_category_id)
            if next_clean_description is not None:
                updates.append("clean_description = ?")
                values.append(next_clean_description)
            if updates:
                updates.append("transaction_hash = ?")
                values.append(
                    make_transaction_hash(
                        int(transaction["account_id"]),
                        transaction["posted_date"],
                        int(transaction["amount_cents"]),
                        final_clean_description,
                    )
                )
                updates.append("updated_at = datetime('now')")
                values.append(transaction_id)
                conn.execute(f"UPDATE transactions SET {', '.join(updates)} WHERE id = ?", values)
            if tag_ids_requested:
                conn.execute("DELETE FROM transaction_tags WHERE transaction_id = ?", (transaction_id,))
                conn.executemany(
                    "INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)",
                    [(transaction_id, tag_id) for tag_id in tag_ids],
                )

        state = read_state(conn)
        conn.commit()

    return jsonify({"status": "updated", "updated_count": len(transaction_ids), "state": state})


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
        fieldnames, raw_rows, source_account_key = read_csv_import_rows(temp_path)
    finally:
        temp_path.unlink(missing_ok=True)

    file_hash = __import__("hashlib").sha256(csv_bytes).hexdigest()
    source_signature = imported_source_signature(raw_rows)
    metadata = {
        "columns": fieldnames,
        "layout": detect_csv_layout(fieldnames),
    }

    with closing(connect(current_db_path())) as conn:
        account = dict(fetch_account(conn, account_id))
        if source_account_key is not None:
            matched_account = fetch_account_by_import_key(conn, source_account_key)
            if matched_account is None:
                raise CliError(f'No existing account matches CSV account "{source_account_key}".')
            if int(matched_account["id"]) != account_id:
                raise CliError(f'CSV account "{source_account_key}" matches a different account.')
        existing = find_imported_source_by_signature(conn, source_signature)
        if existing is not None:
            if int(existing["account_id"]) != account_id:
                raise CliError("CSV file has already been imported.")
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
                default_clean_description,
                raw_amount,
                raw_row_hash
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    imported_source_id,
                    row["raw_date"],
                    row["raw_category"],
                    row["raw_description"],
                    format_prefilled_clean_description(row["raw_description"]),
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
    raw_row_overrides = data.get("raw_row_overrides") or {}
    if not isinstance(raw_row_overrides, dict):
        raise CliError("raw_row_overrides must be an object.")

    with closing(connect(current_db_path())) as conn:
        result = import_raw_rows(
            conn,
            [parse_positive_int(str(row_id), "raw_row_id") for row_id in raw_row_ids],
            {
                parse_positive_int(str(row_id), "raw_row_note id"): str(note)
                for row_id, note in raw_row_notes.items()
            },
            raw_row_overrides,
        )
        payload = mutation_response_payload(conn, raw_status_current=True, include_reference=False)
        conn.commit()

    return jsonify({"import_result": result, **payload})


@app.post("/api/raw-rows/<int:raw_row_id>/manual-import")
def manual_import_raw_row(raw_row_id: int):
    ensure_database()
    data = request.get_json(silent=True) or {}
    category_id = parse_positive_int(str(data.get("category_id")), "category_id")
    transaction_type = validate_transaction_type(data.get("transaction_type"), allow_empty=False)
    clean_description = optional_nonempty(data.get("clean_description"), "clean_description")
    raw_tag_ids = data.get("tag_ids") or []
    if not isinstance(raw_tag_ids, list):
        raise CliError("tag_ids must be a list.")
    tag_ids = sorted({parse_positive_int(str(tag_id), "tag_id") for tag_id in raw_tag_ids})
    note = normalize_text(data.get("note"))

    with closing(connect(current_db_path())) as conn:
        require_category_allowed_for_transaction_type(conn, category_id, transaction_type)
        for tag_id in tag_ids:
            fetch_tag_by_id(conn, tag_id)
        raw_row = conn.execute(
            """
            SELECT
                r.id,
                s.account_id,
                r.raw_date,
                r.raw_description,
                r.raw_amount,
                r.import_status
            FROM raw_imported_rows r
            JOIN imported_source s ON s.id = r.imported_source_id
            WHERE r.id = ?
            """,
            (raw_row_id,),
        ).fetchone()
        if raw_row is None:
            raise CliError(f"Raw row not found: {raw_row_id}")
        if raw_row["import_status"] in ("imported", "duplicate"):
            raise CliError(f"Raw row {raw_row_id} has already been processed.")

        posted_date = parse_transaction_date(raw_row["raw_date"])
        amount_cents = parse_amount_cents(raw_row["raw_amount"])
        transaction_hash = make_transaction_hash(
            int(raw_row["account_id"]),
            posted_date,
            amount_cents,
            clean_description,
        )
        duplicate = conn.execute(
            """
            SELECT id
            FROM transactions
            WHERE account_id = ? AND transaction_hash = ?
            """,
            (raw_row["account_id"], transaction_hash),
        ).fetchone()
        if duplicate is not None:
            conn.execute(
                """
                UPDATE raw_imported_rows
                SET import_status = 'duplicate',
                    import_error = NULL,
                    updated_at = datetime('now')
                WHERE id = ?
                """,
                (raw_row_id,),
            )
            result = {"raw_row_id": raw_row_id, "status": "duplicate", "transaction_id": int(duplicate["id"])}
        else:
            cursor = conn.execute(
                """
                INSERT INTO transactions (
                    account_id,
                    category_id,
                    posted_date,
                    transaction_date,
                    transaction_type,
                    clean_description,
                    amount_cents,
                    raw_imported_row_id,
                    transaction_hash
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    raw_row["account_id"],
                    category_id,
                    posted_date,
                    posted_date,
                    transaction_type,
                    clean_description,
                    amount_cents,
                    raw_row_id,
                    transaction_hash,
                ),
            )
            transaction_id = int(cursor.lastrowid)
            if note is not None:
                conn.execute(
                    "INSERT INTO transaction_notes (transaction_id, note) VALUES (?, ?)",
                    (transaction_id, note),
                )
            conn.executemany(
                "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)",
                [(transaction_id, tag_id) for tag_id in tag_ids],
            )
            conn.execute(
                """
                UPDATE raw_imported_rows
                SET import_status = 'imported',
                    import_error = NULL,
                    parsed_transaction_id = ?,
                    updated_at = datetime('now')
                WHERE id = ?
                """,
                (transaction_id, raw_row_id),
            )
            result = {"raw_row_id": raw_row_id, "status": "imported", "transaction_id": transaction_id}

        payload = mutation_response_payload(conn, raw_status_current=True, include_reference=False)
        conn.commit()

    return jsonify({"import_result": result, **payload})


@app.post("/api/dev/regenerate-database")
def regenerate_database():
    data = request.get_json(silent=True) or {}
    if data.get("confirm") != "RESTORE DUMMY DATABASE":
        raise CliError("Dummy database restore requires confirmation.")

    db_path = DUMMY_DB_PATH
    if not DUMMY_RESTORE_DB_PATH.exists():
        raise CliError("Dummy restore snapshot is missing.")
    for path in [
        db_path,
        db_path.with_name(f"{db_path.name}-wal"),
        db_path.with_name(f"{db_path.name}-shm"),
    ]:
        path.unlink(missing_ok=True)

    shutil.copy2(DUMMY_RESTORE_DB_PATH, db_path)
    init_db(db_path)
    with closing(connect(db_path)) as conn:
        state = read_state(conn)
        conn.commit()

    return jsonify({"status": "restored", "state": state})


def current_db_path() -> Path:
    if has_request_context() and request.headers.get("X-Use-Dummy-Database") == "1":
        return DUMMY_DB_PATH
    return DEFAULT_DB_PATH


def ensure_database() -> None:
    db_path = current_db_path()
    if db_path in ENSURED_DATABASE_PATHS and db_path.exists():
        return
    init_db(db_path)
    ENSURED_DATABASE_PATHS.add(db_path)


def ensure_uploaded_file_delete_indexes(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_transactions_raw_imported_row_id
        ON transactions(raw_imported_row_id)
        """
    )


def parse_date_query_param(value: str | None, field_name: str) -> str:
    if value is None:
        raise CliError(f"{field_name} is required.")
    return parse_transaction_date(value)


def optional_date_range_query() -> tuple[str, str] | None:
    start_value = request.args.get("startDate")
    end_value = request.args.get("endDate")
    if start_value is None and end_value is None:
        return None
    if start_value is None or end_value is None:
        raise CliError("startDate and endDate must be provided together.")
    start_date = parse_date_query_param(start_value, "startDate")
    end_date = parse_date_query_param(end_value, "endDate")
    if start_date > end_date:
        raise CliError("startDate must be on or before endDate.")
    return start_date, end_date


def mutation_response_payload(
    conn: sqlite3.Connection,
    *,
    raw_status_current: bool = False,
    refresh_raw_status: bool = False,
    include_reference: bool = True,
) -> dict[str, Any]:
    date_range = optional_date_range_query()
    if date_range is not None:
        start_date, end_date = date_range
        payload = {
            "transactionData": read_transaction_data(
                conn,
                start_date,
                end_date,
                refresh_raw_status=refresh_raw_status,
            ),
        }
        if include_reference:
            payload["referenceData"] = read_reference_data(conn)
        return payload
    return {"state": read_state(conn, sync_status=not raw_status_current)}


def elapsed_ms(started_at: float) -> float:
    return (time.perf_counter() - started_at) * 1000


def reference_data_from_state(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "accounts": state["accounts"],
        "categories": state["categories"],
        "tags": state["tags"],
        "rules": state["rules"],
        "imports": state["imports"],
    }


def transaction_data_from_state(state: dict[str, Any], start_date: str, end_date: str) -> dict[str, Any]:
    real_transactions = [
        transaction
        for transaction in state["transactions"]
        if start_date <= str(transaction["posted_date"]) <= end_date
    ]
    raw_transactions = [
        raw_row
        for raw_row in state["rawRows"]
        if raw_row["import_status"] in ("auto-importable", "manual", "pre-fill")
        or raw_row_in_date_range(raw_row, start_date, end_date)
    ]
    return {
        "startDate": start_date,
        "endDate": end_date,
        "dashboard": dashboard_data(real_transactions, state["categories"]),
        "realTransactions": real_transactions,
        "rawTransactions": raw_transactions,
    }


def raw_row_in_date_range(raw_row: dict[str, Any], start_date: str, end_date: str) -> bool:
    try:
        raw_date = parse_transaction_date(raw_row.get("raw_date"))
    except Exception:
        return False
    return start_date <= raw_date <= end_date


def dashboard_data(transactions: list[dict[str, Any]], categories: list[dict[str, Any]]) -> dict[str, Any]:
    dashboard_transactions = transactions
    income = sum_typed_transactions(dashboard_transactions, "income", False)
    bills = sum_expense_transactions(dashboard_transactions, True)
    splurge = sum_expense_transactions(dashboard_transactions, False)
    return {
        "income": income,
        "bills": bills,
        "splurge": splurge,
        "saved": income - bills - splurge,
        "typeSegments": [
            {"label": "Bills", "value": bills, "color": "#c85d5d"},
            {"label": "Splurge", "value": splurge, "color": "#7c6bc2"},
            {"label": "Saved", "value": max(income - bills - splurge, 0), "color": "#2f8f2f"},
        ],
        "incomeSegments": category_transaction_segments(dashboard_transactions, categories, "income"),
        "categorySegments": category_spending_segments(dashboard_transactions, categories, "all-expenses"),
        "billSegments": category_spending_segments(dashboard_transactions, categories, "bills"),
        "splurgeSegments": category_spending_segments(dashboard_transactions, categories, "splurge"),
    }


def sum_typed_transactions(transactions: list[dict[str, Any]], transaction_type: str, use_absolute_value: bool) -> int:
    total = 0
    for transaction in transactions:
        if transaction["transaction_type"] != transaction_type:
            continue
        amount = int(transaction["amount_cents"] or 0)
        total += abs(amount) if use_absolute_value else amount
    return total


def sum_expense_transactions(transactions: list[dict[str, Any]], bill_tagged: bool) -> int:
    total = 0
    for transaction in transactions:
        if transaction["transaction_type"] != "expense" or has_bill_tag(transaction) != bill_tagged:
            continue
        total += abs(int(transaction["amount_cents"] or 0))
    return total


def has_bill_tag(transaction: dict[str, Any]) -> bool:
    return any(str(tag["name"]).casefold() == BILL_TAG_NAME for tag in transaction.get("tags", []))


def category_spending_segments(
    transactions: list[dict[str, Any]],
    categories: list[dict[str, Any]],
    expense_mode: str,
) -> list[dict[str, Any]]:
    return category_transaction_segments(
        [transaction for transaction in transactions if is_dashboard_expense(transaction, expense_mode)],
        categories,
        "expense",
    )


def category_transaction_segments(
    transactions: list[dict[str, Any]],
    categories: list[dict[str, Any]],
    transaction_type: str,
) -> list[dict[str, Any]]:
    categories_by_id = {int(category["id"]): category for category in categories}
    totals: dict[int, dict[str, Any]] = {}
    for transaction in transactions:
        if transaction["transaction_type"] != transaction_type:
            continue
        parent = parent_category_for_transaction(transaction, categories_by_id)
        if parent is None:
            continue
        parent_id = int(parent["id"])
        totals[parent_id] = {
            "label": parent["name"],
            "value": totals.get(parent_id, {}).get("value", 0) + abs(int(transaction["amount_cents"] or 0)),
            "color": parent.get("color") or "#000000",
        }
    segments = sorted(totals.values(), key=lambda item: item["value"], reverse=True)
    if len(segments) <= DASHBOARD_CATEGORY_SEGMENT_LIMIT:
        return segments
    visible_limit = DASHBOARD_CATEGORY_SEGMENT_LIMIT - 1
    visible = segments[:visible_limit]
    visible.append({
        "label": "Other",
        "value": sum(segment["value"] for segment in segments[visible_limit:]),
        "color": "#888888",
    })
    return visible


def is_dashboard_expense(transaction: dict[str, Any], mode: str) -> bool:
    if transaction["transaction_type"] != "expense":
        return False
    if mode == "splurge":
        return not has_bill_tag(transaction)
    if mode == "bills":
        return has_bill_tag(transaction)
    return True


def parent_category_for_transaction(
    transaction: dict[str, Any],
    categories_by_id: dict[int, dict[str, Any]],
) -> dict[str, Any] | None:
    category_id = transaction.get("category_id")
    if category_id is None:
        return None
    category = categories_by_id.get(int(category_id))
    if category is None:
        return None
    parent_id = category.get("parent_id")
    return categories_by_id.get(int(parent_id)) if parent_id is not None else category


def read_reference_data(conn: sqlite3.Connection) -> dict[str, Any]:
    ensure_default_categories(conn)
    ensure_system_tags(conn)
    accounts = rows_to_dicts(
        conn.execute(
            """
            SELECT
                a.id,
                a.name,
                a.institution_id,
                i.name AS institution,
                a.account_type,
                a.external_account_id,
                COUNT(rr.id) AS raw_row_count,
                a.created_at,
                a.updated_at
            FROM accounts a
            LEFT JOIN institutions i ON i.id = a.institution_id
            LEFT JOIN imported_source src ON src.account_id = a.id
            LEFT JOIN raw_imported_rows rr ON rr.imported_source_id = src.id
            GROUP BY a.id
            ORDER BY a.name, a.id
            """
        ).fetchall()
    )
    imports = rows_to_dicts(
        conn.execute(
            """
            SELECT
                src.id,
                src.account_id,
                src.filename,
                src.source_type,
                src.sha256,
                src.imported_at,
                src.row_count,
                COUNT(rr.id) AS raw_row_count,
                MIN(rr.raw_date) AS first_date,
                MAX(rr.raw_date) AS last_date,
                COUNT(DISTINCT t.id) AS transaction_count,
                src.metadata_json
            FROM imported_source src
            LEFT JOIN raw_imported_rows rr ON rr.imported_source_id = src.id
            LEFT JOIN transactions t ON t.raw_imported_row_id = rr.id
            GROUP BY src.id
            ORDER BY src.imported_at, src.id
            """
        ).fetchall()
    )
    categories = read_categories(conn)
    tags = read_tags(conn)
    rules = read_rules(conn)
    rule_tags = read_rule_tags(conn)
    for item in imports:
        item["metadata"] = parse_metadata(item.pop("metadata_json"))
    apply_rule_tags(rules, rule_tags)
    apply_category_metadata(categories)
    apply_tag_metadata(tags)
    return {
        "accounts": accounts,
        "categories": categories,
        "tags": tags,
        "rules": rules,
        "imports": imports,
    }


def read_transaction_data(
    conn: sqlite3.Connection,
    start_date: str,
    end_date: str,
    *,
    refresh_raw_status: bool = False,
) -> dict[str, Any]:
    ensure_default_categories(conn)
    ensure_system_tags(conn)
    categories = read_categories(conn)
    raw_rows = read_raw_rows(conn, start_date, end_date)
    transactions = read_transactions(conn, start_date, end_date)
    transaction_tags = read_transaction_tags(conn, start_date, end_date)
    apply_transaction_tags(transactions, transaction_tags)
    apply_raw_row_previews(conn, raw_rows, categories, refresh_status=refresh_raw_status)
    return transaction_data_from_state(
        {
            "categories": categories,
            "transactions": transactions,
            "rawRows": raw_rows,
        },
        start_date,
        end_date,
    )


def read_categories(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return rows_to_dicts(
        conn.execute("SELECT id, name, parent_id, color, created_at FROM categories ORDER BY name, id").fetchall()
    )


def read_tags(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return rows_to_dicts(conn.execute("SELECT id, name, created_at FROM tags ORDER BY name, id").fetchall())


def read_raw_rows(conn: sqlite3.Connection, start_date: str | None = None, end_date: str | None = None) -> list[dict[str, Any]]:
    date_expression = """
        CASE
            WHEN rr.raw_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN rr.raw_date
            WHEN rr.raw_date GLOB '[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN
                substr(rr.raw_date, 7, 4) || '-' || substr(rr.raw_date, 1, 2) || '-' || substr(rr.raw_date, 4, 2)
            WHEN rr.raw_date GLOB '[0-9][0-9]/[0-9][0-9]/[0-9][0-9]' THEN
                '20' || substr(rr.raw_date, 7, 2) || '-' || substr(rr.raw_date, 1, 2) || '-' || substr(rr.raw_date, 4, 2)
            ELSE NULL
        END
    """
    filters: list[str] = []
    values: list[Any] = []
    if start_date is not None:
        filters.append(f"({date_expression}) >= ?")
        values.append(start_date)
    if end_date is not None:
        filters.append(f"({date_expression}) <= ?")
        values.append(end_date)
    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
    return rows_to_dicts(
        conn.execute(
            f"""
            SELECT
                rr.id,
                rr.imported_source_id,
                src.account_id,
                rr.raw_date,
                rr.raw_category,
                rr.raw_description,
                rr.default_clean_description,
                rr.raw_amount,
                rr.parsed_transaction_id,
                rr.import_status,
                rr.import_error,
                rr.raw_row_hash,
                rr.created_at,
                rr.updated_at
            FROM raw_imported_rows rr
            JOIN imported_source src ON src.id = rr.imported_source_id
            {where_clause}
            ORDER BY rr.id
            """,
            values,
        ).fetchall()
    )


def read_transactions(conn: sqlite3.Connection, start_date: str | None = None, end_date: str | None = None) -> list[dict[str, Any]]:
    filters: list[str] = []
    values: list[Any] = []
    if start_date is not None:
        filters.append("t.posted_date >= ?")
        values.append(start_date)
    if end_date is not None:
        filters.append("t.posted_date <= ?")
        values.append(end_date)
    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
    return rows_to_dicts(
        conn.execute(
            f"""
            SELECT
                t.id,
                t.account_id,
                a.name AS account,
                t.category_id,
                c.name AS category,
                t.posted_date,
                t.transaction_date,
                t.transaction_type,
                t.clean_description,
                t.amount_cents,
                printf('%.2f', t.amount_cents / 100.0) AS amount,
                t.transaction_hash,
                t.raw_imported_row_id,
                rr.raw_date,
                rr.raw_category,
                rr.raw_description,
                rr.raw_amount,
                rr.import_status AS raw_import_status,
                rr.import_error AS raw_import_error,
                src.filename AS import_filename,
                src.source_type AS import_source_type,
                src.imported_at,
                COALESCE(group_concat(n.note, char(10)), '') AS notes,
                t.created_at,
                t.updated_at
            FROM transactions t
            JOIN accounts a ON a.id = t.account_id
            LEFT JOIN categories c ON c.id = t.category_id
            LEFT JOIN raw_imported_rows rr ON rr.id = t.raw_imported_row_id
            LEFT JOIN imported_source src ON src.id = rr.imported_source_id
            LEFT JOIN transaction_notes n ON n.transaction_id = t.id
            {where_clause}
            GROUP BY t.id
            ORDER BY t.posted_date DESC, t.id DESC
            """,
            values,
        ).fetchall()
    )


def read_transaction_tags(conn: sqlite3.Connection, start_date: str | None = None, end_date: str | None = None) -> list[dict[str, Any]]:
    filters: list[str] = []
    values: list[Any] = []
    if start_date is not None:
        filters.append("t.posted_date >= ?")
        values.append(start_date)
    if end_date is not None:
        filters.append("t.posted_date <= ?")
        values.append(end_date)
    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
    return rows_to_dicts(
        conn.execute(
            f"""
            SELECT
                tt.transaction_id,
                tags.id,
                tags.name
            FROM transaction_tags tt
            JOIN tags ON tags.id = tt.tag_id
            JOIN transactions t ON t.id = tt.transaction_id
            {where_clause}
            ORDER BY tags.name, tags.id
            """,
            values,
        ).fetchall()
    )


def read_rules(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return rows_to_dicts(
        conn.execute(
            """
            SELECT
                r.id,
                r.name,
                r.rule_type,
                r.match_field,
                r.match_type,
                r.match_value,
                r.match_description,
                r.match_category,
                r.match_amount,
                r.set_category_id,
                c.name AS set_category,
                r.set_clean_description,
                r.set_transaction_type,
                r.add_tag_id,
                tags.name AS add_tag,
                r.is_active,
                r.created_at,
                r.updated_at
            FROM transaction_import_rules r
            LEFT JOIN categories c ON c.id = r.set_category_id
            LEFT JOIN tags ON tags.id = r.add_tag_id
            ORDER BY
                CASE
                    WHEN r.match_description IS NOT NULL AND r.match_category IS NOT NULL THEN 0
                    WHEN r.match_description IS NOT NULL THEN 1
                    WHEN r.match_category IS NOT NULL THEN 2
                END,
                r.id
            """
        ).fetchall()
    )


def read_rule_tags(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    return rows_to_dicts(
        conn.execute(
            """
            SELECT
                rt.rule_id,
                tags.id,
                tags.name
            FROM transaction_import_rule_tags rt
            JOIN tags ON tags.id = rt.tag_id
            ORDER BY tags.name, tags.id
            """
        ).fetchall()
    )


def apply_transaction_tags(transactions: list[dict[str, Any]], transaction_tags: list[dict[str, Any]]) -> None:
    tags_by_transaction: dict[int, list[dict[str, Any]]] = {}
    for tag in transaction_tags:
        transaction_id = int(tag.pop("transaction_id"))
        tags_by_transaction.setdefault(transaction_id, []).append(tag)
    for transaction in transactions:
        transaction["tags"] = tags_by_transaction.get(int(transaction["id"]), [])


def apply_rule_tags(rules: list[dict[str, Any]], rule_tags: list[dict[str, Any]]) -> None:
    tags_by_rule: dict[int, list[dict[str, Any]]] = {}
    for tag in rule_tags:
        rule_id = int(tag.pop("rule_id"))
        tags_by_rule.setdefault(rule_id, []).append(tag)
    for rule in rules:
        rule["is_active"] = bool(rule["is_active"])
        rule["tags"] = tags_by_rule.get(int(rule["id"]), [])
        rule["tag_ids"] = [tag["id"] for tag in rule["tags"]]


def apply_category_metadata(categories: list[dict[str, Any]]) -> None:
    for category in categories:
        category["is_default"] = category["name"] in DEFAULT_CATEGORY_NAMES
        category["sort_order"] = DEFAULT_CATEGORY_SORT_ORDER.get(category["name"], 999999)


def apply_tag_metadata(tags: list[dict[str, Any]]) -> None:
    for tag in tags:
        tag["is_protected"] = is_protected_tag(tag)


def apply_raw_row_previews(
    conn: sqlite3.Connection,
    raw_rows: list[dict[str, Any]],
    categories: list[dict[str, Any]],
    *,
    refresh_status: bool = False,
) -> None:
    auto_import_rules = fetch_active_rules(conn, "auto-import")
    template_rules = fetch_active_rules(conn, "template")
    rule_tag_ids_by_rule = fetch_rule_tag_ids_by_rule(conn)
    auto_import_matchers = build_rule_matchers(auto_import_rules, rule_tag_ids_by_rule)
    template_matchers = build_rule_matchers(template_rules, rule_tag_ids_by_rule)
    categories_by_id = {category["id"]: category["name"] for category in categories}
    for row in raw_rows:
        if row["import_status"] in ("auto-importable", "manual", "pre-fill"):
            row_match = build_raw_row_match(row)
            auto_import_preview = apply_rule_matchers(auto_import_matchers, row_match)
            if rule_preview_has_values(auto_import_preview):
                preview = auto_import_preview
                next_status = "auto-importable" if (
                    preview.get("category_id") is not None
                    and preview.get("transaction_type") is not None
                    and normalize_text(preview.get("clean_description")) is not None
                ) else "manual"
            else:
                preview = apply_rule_matchers(template_matchers, row_match)
                next_status = "pre-fill" if rule_preview_has_values(preview) else "manual"
                if next_status == "pre-fill" and normalize_text(preview.get("clean_description")) is None:
                    preview["clean_description"] = normalize_text(row.get("default_clean_description"))
        else:
            preview = {}
            next_status = row["import_status"]
        if refresh_status and next_status != row["import_status"]:
            conn.execute(
                """
                UPDATE raw_imported_rows
                SET import_status = ?,
                    updated_at = datetime('now')
                WHERE id = ?
                """,
                (next_status, row["id"]),
            )
            row["import_status"] = next_status
        preview_category_id = preview.get("category_id")
        row["preview_category_id"] = preview_category_id
        row["preview_category"] = categories_by_id.get(preview_category_id) if preview_category_id is not None else None
        row["preview_clean_description"] = preview.get("clean_description")
        row["preview_type"] = preview.get("transaction_type")
        row["preview_tag_ids"] = preview.get("tag_ids", [])


def build_rule_matchers(rules: list[Any], rule_tag_ids_by_rule: dict[int, list[int]]) -> list[dict[str, Any]]:
    matchers = []
    for rule in rules:
        rule_id = int(rule["id"])
        tag_ids = rule_tag_ids_by_rule.get(rule_id)
        if not tag_ids and rule["add_tag_id"] is not None:
            tag_ids = [int(rule["add_tag_id"])]
        matchers.append({
            "id": rule_id,
            "match_amount": rule["match_amount"] or "any",
            "match_description": normalize_rule_match_text(rule["match_description"]),
            "match_category": normalize_rule_match_text(rule["match_category"]),
            "match_field": rule["match_field"],
            "match_value": normalize_rule_match_text(rule["match_value"]),
            "set_category_id": int(rule["set_category_id"]) if rule["set_category_id"] is not None else None,
            "set_clean_description": rule["set_clean_description"],
            "set_transaction_type": rule["set_transaction_type"],
            "tag_ids": tag_ids or [],
        })
    return matchers


def build_raw_row_match(row: dict[str, Any]) -> dict[str, Any]:
    try:
        amount_cents = parse_amount_cents(row.get("raw_amount"))
    except CliError:
        amount_cents = None
    return {
        "description": normalize_rule_match_text(row.get("raw_description")),
        "category": normalize_rule_match_text(row.get("raw_category")),
        "amount_cents": amount_cents,
    }


def apply_rule_matchers(matchers: list[dict[str, Any]], row_match: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"category_id": None, "clean_description": None, "transaction_type": None, "tag_ids": []}
    for matcher in matchers:
        if not rule_matcher_matches(matcher, row_match):
            continue
        result["category_id"] = matcher["set_category_id"]
        result["clean_description"] = matcher["set_clean_description"]
        result["transaction_type"] = matcher["set_transaction_type"]
        result["tag_ids"] = list(matcher["tag_ids"])
        break
    return result


def rule_matcher_matches(matcher: dict[str, Any], row_match: dict[str, Any]) -> bool:
    amount_match = matcher["match_amount"]
    amount_cents = row_match["amount_cents"]
    if amount_match == "positive" and (amount_cents is None or amount_cents <= 0):
        return False
    if amount_match == "negative" and (amount_cents is None or amount_cents >= 0):
        return False

    match_description = matcher["match_description"]
    match_category = matcher["match_category"]
    if match_description or match_category:
        if match_description and match_description not in row_match["description"]:
            return False
        if match_category and match_category not in row_match["category"]:
            return False
        return True

    field_value = row_match["category"] if matcher["match_field"] == "category" else row_match["description"]
    needle = matcher["match_value"]
    return bool(needle) and needle in field_value


def read_state(conn: sqlite3.Connection, *, sync_status: bool = True) -> dict[str, Any]:
    if sync_status:
        sync_raw_row_importability_status(conn)
    reference_data = read_reference_data(conn)
    categories = reference_data["categories"]
    transactions = read_transactions(conn)
    transaction_tags = read_transaction_tags(conn)
    raw_rows = read_raw_rows(conn)
    apply_transaction_tags(transactions, transaction_tags)
    apply_raw_row_previews(conn, raw_rows, categories)
    return {
        **reference_data,
        "transactions": transactions,
        "rawRows": raw_rows,
    }


def rule_preview_has_values(preview: dict[str, Any]) -> bool:
    return (
        preview.get("category_id") is not None
        or normalize_text(preview.get("clean_description")) is not None
        or preview.get("transaction_type") is not None
        or bool(preview.get("tag_ids"))
    )


def migrate_finance_tags_to_transaction_type(conn: sqlite3.Connection) -> None:
    for transaction_type in TRANSACTION_TYPES:
        tag = conn.execute("SELECT id FROM tags WHERE name = ?", (transaction_type,)).fetchone()
        if tag is None:
            continue
        tag_id = int(tag["id"])
        conn.execute(
            """
            UPDATE transactions
            SET transaction_type = ?
            WHERE id IN (
                SELECT transaction_id
                FROM transaction_tags
                WHERE tag_id = ?
            )
            """,
            (transaction_type, tag_id),
        )
        conn.execute(
            """
            UPDATE transaction_import_rules
            SET set_transaction_type = ?,
                add_tag_id = NULL
            WHERE add_tag_id = ?
            """,
            (transaction_type, tag_id),
        )
        conn.execute("DELETE FROM transaction_tags WHERE tag_id = ?", (tag_id,))
        conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))


def validate_category_color(value: Any) -> str:
    color = str(value or "").strip()
    if not color:
        return COMFORTABLE_CATEGORY_COLORS[0]
    if len(color) == 7 and color.startswith("#") and all(char in "0123456789abcdefABCDEF" for char in color[1:]):
        return color.lower()
    raise CliError("color must be a hex color like #4f9f6e.")


def ensure_default_categories(conn: sqlite3.Connection) -> None:
    migrate_default_category_name(conn, "Food & Dining", "Food", default_category_color("Food"))
    migrate_default_category_name(conn, "Family & Personal", "Personal", default_category_color("Personal"))
    for category in DEFAULT_CATEGORIES:
        parent_name = str(category["name"])
        parent_id = ensure_category(conn, parent_name, None, str(category["color"]))
        for child_name in category["children"]:
            ensure_category(conn, child_name, parent_id, None)


def default_category_color(name: str) -> str:
    category = next((item for item in DEFAULT_CATEGORIES if item["name"] == name), None)
    if category is None:
        raise CliError(f"Default category not found: {name}")
    return str(category["color"])


def migrate_default_category_name(conn: sqlite3.Connection, old_name: str, new_name: str, color: str) -> None:
    old_row = conn.execute("SELECT id FROM categories WHERE name = ?", (old_name,)).fetchone()
    if old_row is None:
        return
    new_row = conn.execute("SELECT id FROM categories WHERE name = ?", (new_name,)).fetchone()
    old_id = int(old_row["id"])
    if new_row is None:
        conn.execute(
            "UPDATE categories SET name = ?, parent_id = NULL, color = ? WHERE id = ?",
            (new_name, color, old_id),
        )
        return

    new_id = int(new_row["id"])
    conn.execute("UPDATE categories SET parent_id = ?, color = NULL WHERE parent_id = ?", (new_id, old_id))
    conn.execute("UPDATE transactions SET category_id = ? WHERE category_id = ?", (new_id, old_id))
    conn.execute("UPDATE transaction_import_rules SET set_category_id = ? WHERE set_category_id = ?", (new_id, old_id))
    conn.execute("DELETE FROM categories WHERE id = ?", (old_id,))


def ensure_system_tags(conn: sqlite3.Connection) -> None:
    conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (BILL_TAG_NAME,))


def is_protected_tag(tag: dict[str, Any] | sqlite3.Row) -> bool:
    return str(tag["name"]).casefold() == BILL_TAG_NAME


def ensure_category(conn: sqlite3.Connection, name: str, parent_id: int | None, color: str | None) -> int:
    row = conn.execute("SELECT id, parent_id, color FROM categories WHERE name = ?", (name,)).fetchone()
    if row is not None:
        if row["parent_id"] != parent_id:
            conn.execute("UPDATE categories SET parent_id = ? WHERE id = ?", (parent_id, row["id"]))
        if parent_id is None and row["color"] != color:
            conn.execute("UPDATE categories SET color = ? WHERE id = ?", (color, row["id"]))
        if parent_id is not None and row["color"] is not None:
            conn.execute("UPDATE categories SET color = NULL WHERE id = ?", (row["id"],))
        return int(row["id"])
    cursor = conn.execute("INSERT INTO categories (name, parent_id, color) VALUES (?, ?, ?)", (name, parent_id, color))
    return int(cursor.lastrowid)


def category_descendant_ids(conn: sqlite3.Connection, category_id: int) -> set[int]:
    descendants: set[int] = set()
    pending = [category_id]
    while pending:
        current_id = pending.pop()
        rows = conn.execute("SELECT id FROM categories WHERE parent_id = ?", (current_id,)).fetchall()
        for row in rows:
            child_id = int(row["id"])
            if child_id not in descendants:
                descendants.add(child_id)
                pending.append(child_id)
    return descendants


def rows_to_dicts(rows) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def parse_rule_tag_ids(data: dict[str, Any]) -> list[int]:
    if "add_tag_ids" in data:
        raw_tag_ids = data.get("add_tag_ids")
        if not isinstance(raw_tag_ids, list):
            raise CliError("add_tag_ids must be a list.")
        return sorted({int(tag_id) for tag_id in raw_tag_ids if tag_id not in (None, "")})
    raw_tag_id = data.get("add_tag_id")
    if raw_tag_id is None:
        return []
    return [int(raw_tag_id)]


def fetch_rule_tag_ids(conn: sqlite3.Connection, rule_id: int) -> list[int]:
    rows = conn.execute(
        """
        SELECT tag_id
        FROM transaction_import_rule_tags
        WHERE rule_id = ?
        ORDER BY tag_id
        """,
        (rule_id,),
    ).fetchall()
    if rows:
        return [int(row["tag_id"]) for row in rows]
    rule = fetch_transaction_rule(conn, rule_id)
    return [int(rule["add_tag_id"])] if rule["add_tag_id"] is not None else []


def replace_rule_tags(conn: sqlite3.Connection, rule_id: int, tag_ids: list[int]) -> None:
    conn.execute("DELETE FROM transaction_import_rule_tags WHERE rule_id = ?", (rule_id,))
    conn.executemany(
        "INSERT INTO transaction_import_rule_tags (rule_id, tag_id) VALUES (?, ?)",
        [(rule_id, tag_id) for tag_id in tag_ids],
    )


def fetch_category(conn: sqlite3.Connection, category_id: int) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT id, name, parent_id, color, created_at
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
    app.run(
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "5050")),
        debug=True,
        use_reloader=False,
    )
