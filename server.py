from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
from contextlib import closing
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from flask import Flask, jsonify, request, send_from_directory, has_request_context


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
    require_account_unused,
    require_category_unused,
    require_tag_unused,
    raw_row_hash,
    sync_raw_row_ready_status,
    validate_transaction_type,
    validate_match_field,
    validate_match_type,
    validate_rule_actions,
    parse_amount_cents,
    make_transaction_hash,
)
from init_db import init_db  # noqa: E402


app = Flask(__name__, static_folder=str(ROOT), static_url_path="")
DUMMY_DB_PATH = DEFAULT_DB_PATH.with_name("transactions.dummy.sqlite")
DUMMY_RESTORE_DB_PATH = DEFAULT_DB_PATH.with_name("transactions.dummy.restore.sqlite")
TRANSACTION_TYPES = ("income", "bill", "splurge")
COMFORTABLE_CATEGORY_COLORS = (
    "#2f8f2f",
    "#d27da8",
    "#91a82f",
    "#3f7fc2",
    "#d07b2f",
    "#3f9f72",
    "#c85d5d",
    "#7c6bc2",
    "#239f9f",
    "#b68b2e",
    "#a8adb3",
    "#4f93a8",
    "#7a5234",
    "#6f944f",
    "#5f666d",
)
DEFAULT_CATEGORY_TREE = {
    "Income": ["Salary", "Bonus", "Interest", "Dividend", "Refund", "Gift Received"],
    "Housing": ["Rent", "Mortgage", "Property Tax", "HOA", "Home Insurance", "Home Maintenance"],
    "Utility": ["Electric", "Gas", "Water", "Sewer", "Trash", "Internet", "Phone"],
    "Transportation": ["Car Payment", "Fuel", "Charging", "Auto Insurance", "Maintenance", "Registration", "Parking", "Toll", "Public Transit"],
    "Food & Dining": ["Groceries", "Restaurant"],
    "Shopping": ["Clothing", "Electronic", "Household", "Furniture"],
    "Health": ["Medical", "Dental", "Vision", "Pharmacy", "Fitness"],
    "Entertainment": ["Activity", "Streaming", "Gaming", "Movie", "Music", "Hobby"],
    "Travel": ["Hotel", "Flight", "Rental"],
    "Financial": ["Fee", "Loan Payment", "Investment Contribution", "Tax Payment"],
    "Insurance": ["Life Insurance", "Umbrella Insurance"],
    "Education": ["Tuition", "Books", "Courses", "Certifications"],
    "Family & Personal": ["Childcare", "Pet Expense", "Gift Given", "Personal Care"],
    "Business": ["Software", "Equipment", "Service", "Office Expense"],
    "Transfer": ["Brokerage Transfer", "Internal Transfer", "Credit Card Payment"],
}
DEFAULT_CATEGORY_COLORS = {
    "Income": "#2f8f2f",
    "Housing": "#d27da8",
    "Utility": "#91a82f",
    "Transportation": "#3f7fc2",
    "Food & Dining": "#d07b2f",
    "Shopping": "#3f9f72",
    "Health": "#c85d5d",
    "Entertainment": "#7c6bc2",
    "Travel": "#239f9f",
    "Financial": "#b68b2e",
    "Insurance": "#a8adb3",
    "Education": "#4f93a8",
    "Family & Personal": "#7a5234",
    "Business": "#6f944f",
    "Transfer": "#5f666d",
}
CATEGORY_RENAMES = {
    "Dividends": "Dividend",
    "Refunds": "Refund",
    "Gifts Received": "Gift Received",
    "Utilities": "Utility",
    "Tolls": "Toll",
    "Restaurants": "Restaurant",
    "Electronics": "Electronic",
    "Movies": "Movie",
    "Hobbies": "Hobby",
    "Hotels": "Hotel",
    "Flights": "Flight",
    "Fees": "Fee",
    "Loan Payments": "Loan Payment",
    "Investment Contributions": "Investment Contribution",
    "Tax Payments": "Tax Payment",
    "Pet Expenses": "Pet Expense",
    "Gifts Given": "Gift Given",
    "Services": "Service",
    "Office Expenses": "Office Expense",
    "Transfers": "Transfer",
}
DEFAULT_CATEGORY_NAMES = frozenset(
    [parent for parent in DEFAULT_CATEGORY_TREE]
    + [child for children in DEFAULT_CATEGORY_TREE.values() for child in children]
)


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
    db_path = current_db_path()
    return jsonify({"status": "ok", "database": str(db_path), "is_dummy_database": db_path == DUMMY_DB_PATH})


@app.get("/api/state")
def get_state():
    ensure_database()
    with closing(connect(current_db_path())) as conn:
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

    with closing(connect(current_db_path())) as conn:
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
        if "currency" in data:
            updates.append("currency = ?")
            values.append(normalize_currency(str(data.get("currency", ""))))
        if not updates:
            raise CliError("No changes requested.")

        updates.append("updated_at = datetime('now')")
        values.append(account_id)
        conn.execute(f"UPDATE accounts SET {', '.join(updates)} WHERE id = ?", values)
        account = dict(fetch_account(conn, account_id))
        state = read_state(conn)
        conn.commit()

    return jsonify({"account": account, "state": state})


@app.delete("/api/accounts/<int:account_id>")
def delete_account(account_id: int):
    ensure_database()
    with closing(connect(current_db_path())) as conn:
        account = dict(fetch_account(conn, account_id))
        require_account_unused(conn, account_id)
        conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
        state = read_state(conn)
        conn.commit()

    return jsonify({"status": "deleted", "account": account, "state": state})


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
    set_transaction_type = validate_transaction_type(data.get("set_transaction_type"), allow_empty=True)
    add_tag_ids = parse_rule_tag_ids(data)
    add_tag_id = add_tag_ids[0] if add_tag_ids else None
    priority = int(data.get("priority", 100))

    validate_rule_actions(set_category_id, set_clean_description, set_transaction_type, add_tag_id)

    with closing(connect(current_db_path())) as conn:
        if set_category_id is not None:
            require_category(conn, set_category_id)
        for tag_id in add_tag_ids:
            fetch_tag_by_id(conn, tag_id)
        cursor = conn.execute(
            """
            INSERT INTO transaction_import_rules (
                name,
                match_field,
                match_type,
                match_value,
                set_category_id,
                set_clean_description,
                set_transaction_type,
                add_tag_id,
                priority
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                match_field,
                match_type,
                match_value,
                set_category_id,
                set_clean_description,
                set_transaction_type,
                add_tag_id,
                priority,
            ),
        )
        rule_id = int(cursor.lastrowid)
        replace_rule_tags(conn, rule_id, add_tag_ids)
        rule = dict(fetch_transaction_rule(conn, rule_id))
        state = read_state(conn)
        conn.commit()

    return jsonify({"transaction_rule": rule, "state": state}), 201


@app.patch("/api/rules/<int:rule_id>")
def update_rule(rule_id: int):
    ensure_database()
    data = request.get_json(silent=True) or {}
    updates: list[str] = []
    values: list[Any] = []

    with closing(connect(current_db_path())) as conn:
        current = fetch_transaction_rule(conn, rule_id)
        next_set_category_id = current["set_category_id"]
        next_set_clean_description = current["set_clean_description"]
        next_set_transaction_type = current["set_transaction_type"]
        next_add_tag_id = current["add_tag_id"]
        next_add_tag_ids = fetch_rule_tag_ids(conn, rule_id)

        if "name" in data:
            updates.append("name = ?")
            values.append(nonempty(str(data.get("name", "")), "name"))
        if "match_field" in data:
            updates.append("match_field = ?")
            values.append(validate_match_field(str(data.get("match_field", ""))))
        if "match_type" in data:
            updates.append("match_type = ?")
            values.append(validate_match_type(str(data.get("match_type", ""))))
        if "match_value" in data:
            updates.append("match_value = ?")
            values.append(nonempty(str(data.get("match_value", "")), "match_value"))
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
        if "priority" in data:
            updates.append("priority = ?")
            values.append(int(data.get("priority", 100)))
        if "is_active" in data:
            updates.append("is_active = ?")
            values.append(1 if data.get("is_active") else 0)
        if not updates:
            raise CliError("No changes requested.")

        validate_rule_actions(next_set_category_id, next_set_clean_description, next_set_transaction_type, next_add_tag_id)

        updates.append("updated_at = datetime('now')")
        values.append(rule_id)
        conn.execute(f"UPDATE transaction_import_rules SET {', '.join(updates)} WHERE id = ?", values)
        if "add_tag_ids" in data or "add_tag_id" in data:
            replace_rule_tags(conn, rule_id, next_add_tag_ids)
        rule = dict(fetch_transaction_rule(conn, rule_id))
        state = read_state(conn)
        conn.commit()

    return jsonify({"transaction_rule": rule, "state": state})


@app.delete("/api/rules/<int:rule_id>")
def delete_rule(rule_id: int):
    ensure_database()
    with closing(connect(current_db_path())) as conn:
        rule = dict(fetch_transaction_rule(conn, rule_id))
        conn.execute("DELETE FROM transaction_import_rules WHERE id = ?", (rule_id,))
        state = read_state(conn)
        conn.commit()

    return jsonify({"status": "deleted", "transaction_rule": rule, "state": state})


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
            SELECT id, account_id, posted_date, amount_cents, clean_description
            FROM transactions
            WHERE id = ?
            """,
            (transaction_id,),
        ).fetchone()
        if transaction is None:
            raise CliError(f"Transaction not found: {transaction_id}")
        next_account_id = int(transaction["account_id"])
        next_posted_date = transaction["posted_date"]
        next_amount_cents = int(transaction["amount_cents"])
        next_clean_description = transaction["clean_description"]

        if "account_id" in data:
            next_account_id = int(data.get("account_id"))
            fetch_account(conn, next_account_id)
            updates.append("account_id = ?")
            values.append(next_account_id)
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
            updates.append("category_id = ?")
            values.append(category_id)
        if "transaction_type" in data:
            transaction_type = validate_transaction_type(data.get("transaction_type"), allow_empty=False)
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
        if "status" in data:
            status = nonempty(str(data.get("status", "")), "status")
            if status not in {"pending", "posted", "void"}:
                raise CliError("status must be pending, posted, or void.")
            updates.append("status = ?")
            values.append(status)
        notes_requested = "notes" in data
        notes = optional_nonempty(data.get("notes"), "notes") if notes_requested else None
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

    with closing(connect(current_db_path())) as conn:
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

    with closing(connect(current_db_path())) as conn:
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
    init_db(current_db_path())


def read_state(conn: sqlite3.Connection) -> dict[str, Any]:
    migrate_finance_tags_to_transaction_type(conn)
    sync_raw_row_ready_status(conn)
    ensure_default_categories(conn)
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
                t.transaction_type,
                t.clean_description,
                t.amount_cents,
                printf('%.2f', t.amount_cents / 100.0) AS amount,
                t.currency,
                t.status,
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
            GROUP BY t.id
            ORDER BY t.posted_date DESC, t.id DESC
            """
        ).fetchall()
    )
    categories = rows_to_dicts(
        conn.execute("SELECT id, name, parent_id, color, created_at FROM categories ORDER BY name, id").fetchall()
    )
    tags = rows_to_dicts(conn.execute("SELECT id, name, created_at FROM tags ORDER BY name, id").fetchall())
    transaction_tags = rows_to_dicts(
        conn.execute(
            """
            SELECT
                tt.transaction_id,
                tags.id,
                tags.name
            FROM transaction_tags tt
            JOIN tags ON tags.id = tt.tag_id
            ORDER BY tags.name, tags.id
            """
        ).fetchall()
    )
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
                r.set_transaction_type,
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
    rule_tags = rows_to_dicts(
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
    tags_by_transaction: dict[int, list[dict[str, Any]]] = {}
    for tag in transaction_tags:
        transaction_id = int(tag.pop("transaction_id"))
        tags_by_transaction.setdefault(transaction_id, []).append(tag)
    for transaction in transactions:
        transaction["tags"] = tags_by_transaction.get(int(transaction["id"]), [])
    tags_by_rule: dict[int, list[dict[str, Any]]] = {}
    for tag in rule_tags:
        rule_id = int(tag.pop("rule_id"))
        tags_by_rule.setdefault(rule_id, []).append(tag)
    categories_by_id = {category["id"]: category["name"] for category in categories}
    for row in raw_rows:
        preview = apply_import_rules(conn, row) if row["import_status"] == "ready" else {}
        preview_category_id = preview.get("category_id")
        row["preview_category"] = categories_by_id.get(preview_category_id) if preview_category_id is not None else None
        row["preview_clean_description"] = preview.get("clean_description")
        row["preview_type"] = preview.get("transaction_type")
    for rule in rules:
        rule["is_active"] = bool(rule["is_active"])
        rule["tags"] = tags_by_rule.get(int(rule["id"]), [])
        rule["tag_ids"] = [tag["id"] for tag in rule["tags"]]
    for category in categories:
        category["is_default"] = category["name"] in DEFAULT_CATEGORY_NAMES
    for tag in tags:
        tag["is_protected"] = False
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
    normalize_default_category_names(conn)
    for parent_name, child_names in DEFAULT_CATEGORY_TREE.items():
        parent_id = ensure_category(conn, parent_name, None, DEFAULT_CATEGORY_COLORS[parent_name])
        for child_name in child_names:
            ensure_category(conn, child_name, parent_id, None)


def normalize_default_category_names(conn: sqlite3.Connection) -> None:
    for old_name, new_name in CATEGORY_RENAMES.items():
        old_row = conn.execute("SELECT id FROM categories WHERE name = ?", (old_name,)).fetchone()
        if old_row is None:
            continue
        old_id = int(old_row["id"])
        new_row = conn.execute("SELECT id FROM categories WHERE name = ?", (new_name,)).fetchone()
        if new_row is None:
            conn.execute("UPDATE categories SET name = ? WHERE id = ?", (new_name, old_id))
            continue
        new_id = int(new_row["id"])
        conn.execute("UPDATE transactions SET category_id = ? WHERE category_id = ?", (new_id, old_id))
        conn.execute(
            "UPDATE transaction_import_rules SET set_category_id = ? WHERE set_category_id = ?",
            (new_id, old_id),
        )
        conn.execute("UPDATE categories SET parent_id = ? WHERE parent_id = ?", (new_id, old_id))
        conn.execute("DELETE FROM categories WHERE id = ?", (old_id,))


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

