from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sqlite3
import sys
from datetime import datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
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
MATCH_FIELDS = {"category", "description"}
MATCH_TYPES = {"contains", "equals", "starts_with", "regex"}
RULE_TYPES = {"auto-import", "template"}
IMPORTABLE_RAW_ROW_STATUSES = {"auto-importable", "pre-fill"}
TRANSACTION_TYPES = {"income", "expense", "transfer"}
MATCH_AMOUNTS = {"positive", "negative", "any"}


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


def validate_transaction_type(
    value: str | None,
    field_name: str = "transaction_type",
    allow_empty: bool = True,
) -> str | None:
    normalized = normalize_text(value)
    if normalized is None:
        if allow_empty:
            return None
        raise CliError(f"{field_name} cannot be empty.")
    if normalized not in TRANSACTION_TYPES:
        raise CliError(f"{field_name} must be one of: {', '.join(sorted(TRANSACTION_TYPES))}")
    return normalized


def validate_rule_type(value: str | None) -> str:
    normalized = normalize_text(value) or "auto-import"
    if normalized == "rule":
        normalized = "auto-import"
    if normalized not in RULE_TYPES:
        raise CliError(f"rule_type must be one of: {', '.join(sorted(RULE_TYPES))}")
    return normalized


def validate_match_amount(value: str | None) -> str:
    normalized = normalize_text(value) or "any"
    if normalized not in MATCH_AMOUNTS:
        raise CliError(f"match_amount must be one of: {', '.join(sorted(MATCH_AMOUNTS))}")
    return normalized


def validate_rule_actions(
    set_category_id: int | None,
    set_clean_description: str | None,
    set_transaction_type: str | None,
    add_tag_id: int | None,
) -> None:
    if (
        set_category_id is None
        and set_clean_description is None
        and set_transaction_type is None
        and add_tag_id is None
    ):
        raise CliError("A transaction rule must set a category, set a description, set a type, and/or add a tag.")


def validate_rule_payload(
    rule_type: str,
    set_category_id: int | None,
    set_clean_description: str | None,
    set_transaction_type: str | None,
    add_tag_id: int | None,
) -> None:
    validate_rule_actions(set_category_id, set_clean_description, set_transaction_type, add_tag_id)
    if rule_type == "auto-import" and (
        set_category_id is None
        or set_clean_description is None
        or set_transaction_type is None
    ):
        raise CliError("An auto-import rule must set a category, description, and type.")
    if rule_type == "template" and (
        set_category_id is None
        or set_transaction_type is None
    ):
        raise CliError("A pre-fill rule must set a category and type.")


def rule_specificity_order_sql() -> str:
    return """
        CASE
            WHEN match_description IS NOT NULL AND match_category IS NOT NULL THEN 0
            WHEN match_description IS NOT NULL THEN 1
            WHEN match_category IS NOT NULL THEN 2
        END,
        id
    """


def fetch_duplicate_transaction_rule(
    conn: sqlite3.Connection,
    rule_type: str,
    match_description: str | None,
    match_category: str | None,
    match_amount: str = "any",
    exclude_rule_id: int | None = None,
) -> sqlite3.Row | None:
    values: list[Any] = [
        validate_rule_type(rule_type),
        match_description or "",
        match_category or "",
        validate_match_amount(match_amount),
    ]
    exclude_clause = ""
    if exclude_rule_id is not None:
        exclude_clause = "AND id != ?"
        values.append(exclude_rule_id)
    return conn.execute(
        f"""
        SELECT id, name, rule_type, match_description, match_category, match_amount
        FROM transaction_import_rules
        WHERE rule_type = ?
            AND COALESCE(match_description, '') = ?
            AND COALESCE(match_category, '') = ?
            AND match_amount = ?
            {exclude_clause}
        ORDER BY id
        LIMIT 1
        """,
        values,
    ).fetchone()


def parse_rule_match_values(
    match_description: str | None = None,
    match_category: str | None = None,
    match_field: str | None = None,
    match_value: str | None = None,
    match_type: str | None = None,
) -> tuple[str | None, str | None, str, str, str]:
    if match_type is not None:
        validate_match_type(match_type)

    description = optional_nonempty(match_description, "match_description")
    category = optional_nonempty(match_category, "match_category")

    if description is None and category is None and (match_field is not None or match_value is not None):
        if match_field is None or match_value is None:
            raise CliError("Legacy rule matching requires both --match-field and --match-value.")
        legacy_field = validate_match_field(match_field)
        legacy_value = nonempty(match_value, "match_value")
        if legacy_field == "description":
            description = legacy_value
        else:
            category = legacy_value

    if description is None and category is None:
        raise CliError("Rule must match description, category, or both.")

    legacy_field = "description" if description is not None else "category"
    legacy_value = description if description is not None else category
    return description, category, legacy_field, "contains", legacy_value


def require_category(conn: sqlite3.Connection, category_id: int) -> None:
    row = conn.execute("SELECT 1 FROM categories WHERE id = ?", (category_id,)).fetchone()
    if row is None:
        raise CliError(f"Category not found: {category_id}")


def require_category_allowed_for_transaction_type(
    conn: sqlite3.Connection,
    category_id: int,
    transaction_type: str | None,
) -> None:
    require_category(conn, category_id)
    is_transfer_category = category_is_transfer(conn, category_id)
    if is_transfer_category and transaction_type != "transfer":
        raise CliError("Transfer categories require transaction_type transfer.")
    if transaction_type == "transfer" and not is_transfer_category:
        raise CliError("Transfer transactions require a Transfer category.")


def category_is_transfer(conn: sqlite3.Connection, category_id: int) -> bool:
    category = fetch_category_by_id(conn, category_id)
    while category["parent_id"] is not None:
        category = fetch_category_by_id(conn, int(category["parent_id"]))
    return str(category["name"]).casefold() == "transfer"


def require_tag_id(conn: sqlite3.Connection, tag_id: int) -> None:
    row = conn.execute("SELECT 1 FROM tags WHERE id = ?", (tag_id,)).fetchone()
    if row is None:
        raise CliError(f"Tag not found: {tag_id}")


def fetch_category_by_id(conn: sqlite3.Connection, category_id: int) -> sqlite3.Row:
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


def require_account_unused(conn: sqlite3.Connection, account_id: int) -> None:
    fetch_account(conn, account_id)
    transaction_count = conn.execute(
        "SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?",
        (account_id,),
    ).fetchone()["count"]
    import_count = conn.execute(
        "SELECT COUNT(*) AS count FROM imported_source WHERE account_id = ?",
        (account_id,),
    ).fetchone()["count"]
    if transaction_count or import_count:
        raise CliError("Account is being used.")


def require_category_unused(conn: sqlite3.Connection, category_id: int) -> None:
    require_category(conn, category_id)
    checks = [
        ("transactions", "SELECT COUNT(*) AS count FROM transactions WHERE category_id = ?"),
        ("rules", "SELECT COUNT(*) AS count FROM transaction_import_rules WHERE set_category_id = ?"),
        ("child categories", "SELECT COUNT(*) AS count FROM categories WHERE parent_id = ?"),
    ]
    used_by = [label for label, sql in checks if conn.execute(sql, (category_id,)).fetchone()["count"]]
    if used_by:
        raise CliError(f"Category is being used by {', '.join(used_by)}.")


def require_tag_unused(conn: sqlite3.Connection, tag_id: int) -> None:
    require_tag_id(conn, tag_id)
    checks = [
        ("transactions", "SELECT COUNT(*) AS count FROM transaction_tags WHERE tag_id = ?"),
        ("rules", "SELECT COUNT(*) AS count FROM transaction_import_rules WHERE add_tag_id = ?"),
    ]
    used_by = [label for label, sql in checks if conn.execute(sql, (tag_id,)).fetchone()["count"]]
    if used_by:
        raise CliError(f"Tag is being used by {', '.join(used_by)}.")


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
    stripped = re.sub(r" {2,}", " ", value.strip())
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


def normalized_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def raw_row_hash(row: dict[str, str | None]) -> str:
    return normalized_hash(
        {
            "date": normalize_text(row.get("raw_date")),
            "category": normalize_text(row.get("raw_category")),
            "description": normalize_text(row.get("raw_description")),
            "amount": normalize_text(row.get("raw_amount")),
        }
    )


def normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = re.sub(r"\s+", " ", value.strip())
    return normalized or None


def normalize_match_text(value: str | None) -> str:
    return normalize_text(value).lower() if normalize_text(value) else ""


def normalize_rule_match_text(value: str | None) -> str:
    normalized = normalize_match_text(value)
    if not normalized:
        return ""
    return re.sub(r"[^a-z0-9]+", "", normalized)


def format_prefilled_clean_description(value: str | None) -> str | None:
    cleaned = remove_default_description_special_characters(value)
    truncated = truncate_including_cutoff_word(cleaned, 25)
    cleaned = re.sub(r"\s+", " ", truncated).strip()
    if not cleaned:
        return normalize_text(value)
    return re.sub(r"\b[a-z]", lambda match: match.group(0).upper(), cleaned.lower())


def remove_default_description_special_characters(value: str | None) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9'\s]+", " ", normalize_text(value) or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def truncate_including_cutoff_word(value: str | None, max_length: int) -> str:
    text = normalize_text(value) or ""
    if len(text) <= max_length:
        return text
    next_space = text.find(" ", max_length)
    return (text if next_space == -1 else text[:next_space]).strip()


def parse_transaction_date(value: str | None) -> str:
    raw_value = normalize_text(value)
    if raw_value is None:
        raise CliError("raw_date is required.")

    formats = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%b %d, %Y", "%B %d, %Y")
    for date_format in formats:
        try:
            return datetime.strptime(raw_value, date_format).date().isoformat()
        except ValueError:
            pass
    raise CliError(f"raw_date is not a supported date: {raw_value}")


def parse_cli_date(value: str | None, field_name: str) -> str | None:
    if value is None:
        return None
    try:
        return parse_transaction_date(value)
    except CliError as exc:
        raise CliError(str(exc).replace("raw_date", field_name, 1)) from exc


def parse_amount_cents(value: str | None) -> int:
    raw_value = normalize_text(value)
    if raw_value is None:
        raise CliError("raw_amount is required.")
    if raw_value.startswith("debit="):
        parts = dict(part.split("=", 1) for part in raw_value.split("; ") if "=" in part)
        debit = normalize_text(parts.get("debit"))
        credit = normalize_text(parts.get("credit"))
        if debit and credit:
            raise CliError("raw_amount cannot contain both debit and credit values.")
        raw_value = f"-{debit}" if debit and not debit.startswith("-") else debit or credit

    cleaned = raw_value.replace("$", "").replace(",", "").strip()
    negative = cleaned.startswith("(") and cleaned.endswith(")")
    if negative:
        cleaned = cleaned[1:-1]
    try:
        amount = Decimal(cleaned)
    except InvalidOperation as exc:
        raise CliError(f"raw_amount is not a supported amount: {raw_value}") from exc
    if negative:
        amount = -amount
    return int((amount * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def fetch_active_rules(conn: sqlite3.Connection, rule_type: str | None = None) -> list[sqlite3.Row]:
    values: list[Any] = []
    type_filter = ""
    if rule_type is not None:
        type_filter = "AND rule_type = ?"
        values.append(validate_rule_type(rule_type))
    return conn.execute(
        f"""
        SELECT
            id,
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
        FROM transaction_import_rules
        WHERE is_active = 1
            {type_filter}
        ORDER BY {rule_specificity_order_sql()}
        """,
        values,
    ).fetchall()


def fetch_rule_tag_ids_by_rule(conn: sqlite3.Connection) -> dict[int, list[int]]:
    rows = conn.execute(
        """
        SELECT rule_id, tag_id
        FROM transaction_import_rule_tags
        ORDER BY rule_id, tag_id
        """
    ).fetchall()
    tag_ids_by_rule: dict[int, list[int]] = {}
    for row in rows:
        tag_ids_by_rule.setdefault(int(row["rule_id"]), []).append(int(row["tag_id"]))
    return tag_ids_by_rule


def rule_matches(rule: sqlite3.Row, raw_row: sqlite3.Row) -> bool:
    if not rule_amount_matches(rule["match_amount"], raw_row):
        return False
    match_description = normalize_rule_match_text(rule["match_description"])
    match_category = normalize_rule_match_text(rule["match_category"])
    if match_description or match_category:
        if match_description and match_description not in normalize_rule_match_text(raw_row["raw_description"]):
            return False
        if match_category and match_category not in normalize_rule_match_text(raw_row["raw_category"]):
            return False
        return True

    field_value = {
        "category": raw_row["raw_category"],
        "description": raw_row["raw_description"],
    }.get(rule["match_field"])
    haystack = normalize_rule_match_text(field_value)
    needle = normalize_rule_match_text(rule["match_value"])

    return bool(needle) and needle in haystack


def rule_amount_matches(match_amount: str | None, raw_row: sqlite3.Row) -> bool:
    normalized_match_amount = validate_match_amount(match_amount)
    if normalized_match_amount == "any":
        return True
    try:
        amount_cents = parse_amount_cents(raw_row["raw_amount"])
    except CliError:
        return False
    if normalized_match_amount == "positive":
        return amount_cents > 0
    return amount_cents < 0


def apply_import_rule_rows(
    rules: Iterable[sqlite3.Row],
    raw_row: sqlite3.Row,
    rule_tag_ids_by_rule: dict[int, list[int]],
) -> dict[str, Any]:
    result: dict[str, Any] = {"category_id": None, "clean_description": None, "transaction_type": None, "tag_ids": []}
    for rule in rules:
        if not rule_matches(rule, raw_row):
            continue
        if rule["set_category_id"] is not None:
            result["category_id"] = int(rule["set_category_id"])
        if rule["set_clean_description"] is not None:
            result["clean_description"] = rule["set_clean_description"]
        if rule["set_transaction_type"] is not None:
            result["transaction_type"] = rule["set_transaction_type"]
        tag_ids = rule_tag_ids_by_rule.get(int(rule["id"]))
        if not tag_ids and rule["add_tag_id"] is not None:
            tag_ids = [int(rule["add_tag_id"])]
        for tag_id in tag_ids or []:
            if tag_id not in result["tag_ids"]:
                result["tag_ids"].append(tag_id)
        break
    return result


def apply_import_rules(conn: sqlite3.Connection, raw_row: sqlite3.Row, rule_type: str = "auto-import") -> dict[str, Any]:
    return apply_import_rule_rows(
        fetch_active_rules(conn, rule_type),
        raw_row,
        fetch_rule_tag_ids_by_rule(conn),
    )


def has_matching_rule(conn: sqlite3.Connection, raw_row: sqlite3.Row, rule_type: str) -> bool:
    return any(rule_matches(rule, raw_row) for rule in fetch_active_rules(conn, rule_type))


def fetch_rule_tag_ids(conn: sqlite3.Connection, rule_id: int, fallback_tag_id: int | None = None) -> list[int]:
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
    return [int(fallback_tag_id)] if fallback_tag_id is not None else []


def raw_row_is_importable(conn: sqlite3.Connection, raw_row: sqlite3.Row) -> bool:
    rule_result = apply_import_rules(conn, raw_row, "auto-import")
    return (
        rule_result["category_id"] is not None
        and rule_result["transaction_type"] is not None
        and normalize_text(rule_result["clean_description"]) is not None
    )


def raw_row_importability_status(conn: sqlite3.Connection, raw_row: sqlite3.Row) -> str:
    if has_matching_rule(conn, raw_row, "auto-import"):
        return "auto-importable" if raw_row_is_importable(conn, raw_row) else "manual"
    if has_matching_rule(conn, raw_row, "template"):
        return "pre-fill"
    return "manual"


def import_rule_result_for_raw_row(conn: sqlite3.Connection, raw_row: sqlite3.Row) -> dict[str, Any]:
    rule_type = "template" if raw_row["import_status"] == "pre-fill" else "auto-import"
    return apply_import_rules(conn, raw_row, rule_type)


def import_rule_result_for_status(
    conn: sqlite3.Connection,
    raw_row: sqlite3.Row,
    import_status: str,
) -> dict[str, Any]:
    rule_type = "template" if import_status == "pre-fill" else "auto-import"
    result = apply_import_rules(conn, raw_row, rule_type)
    if import_status == "pre-fill" and normalize_text(result["clean_description"]) is None:
        result["clean_description"] = normalize_text(raw_row["default_clean_description"])
    return result


def sync_raw_row_importability_status(conn: sqlite3.Connection) -> None:
    auto_import_rules = fetch_active_rules(conn, "auto-import")
    template_rules = fetch_active_rules(conn, "template")
    rows = conn.execute(
        """
        SELECT id, raw_category, raw_description, default_clean_description, raw_amount, import_status
        FROM raw_imported_rows
        WHERE import_status IN ('auto-importable', 'manual', 'pre-fill', 'importable', 'notImportable', 'template')
        ORDER BY id
        """
    ).fetchall()
    for row in rows:
        matching_auto_rule = next((rule for rule in auto_import_rules if rule_matches(rule, row)), None)
        if matching_auto_rule is not None:
            is_importable = (
                matching_auto_rule["set_category_id"] is not None
                and matching_auto_rule["set_transaction_type"] is not None
                and normalize_text(matching_auto_rule["set_clean_description"]) is not None
            )
            next_status = "auto-importable" if is_importable else "manual"
        elif any(rule_matches(rule, row) for rule in template_rules):
            next_status = "pre-fill"
        else:
            next_status = "manual"
        conn.execute(
            """
            UPDATE raw_imported_rows
            SET import_status = ?,
                updated_at = datetime('now')
            WHERE id = ? AND import_status != ?
            """,
            (next_status, row["id"], next_status),
        )


def make_transaction_hash(
    account_id: int,
    posted_date: str,
    amount_cents: int,
    description: str | None,
) -> str:
    return normalized_hash(
        {
            "account_id": account_id,
            "posted_date": posted_date,
            "amount_cents": amount_cents,
            "description": normalize_match_text(description),
        }
    )


def log_event(
    conn: sqlite3.Connection,
    level: str,
    source: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO logs (level, source, message, details_json)
        VALUES (?, ?, ?, ?)
        """,
        (level, source, message, json.dumps(details, sort_keys=True) if details else None),
    )


def fetch_raw_rows_for_import(conn: sqlite3.Connection, row_ids: list[int]) -> list[sqlite3.Row]:
    placeholders = ", ".join("?" for _ in row_ids)
    return conn.execute(
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
            rr.raw_row_hash
        FROM raw_imported_rows rr
        JOIN imported_source src ON src.id = rr.imported_source_id
        WHERE rr.id IN ({placeholders})
        ORDER BY rr.id
        """,
        row_ids,
    ).fetchall()


def import_raw_rows(
    conn: sqlite3.Connection,
    row_ids: Iterable[int],
    raw_row_notes: dict[int, str] | None = None,
    raw_row_overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_ids = sorted({int(row_id) for row_id in row_ids})
    if not normalized_ids:
        raise CliError("At least one raw row id is required.")
    normalized_notes = {
        int(row_id): note
        for row_id, note in (raw_row_notes or {}).items()
        if normalize_text(note) is not None
    }
    overrides = normalize_raw_row_import_overrides(conn, raw_row_overrides or {})

    raw_rows = fetch_raw_rows_for_import(conn, normalized_ids)
    found_ids = {int(row["id"]) for row in raw_rows}
    missing_ids = [row_id for row_id in normalized_ids if row_id not in found_ids]
    if missing_ids:
        raise CliError(f"Raw row not found: {', '.join(str(row_id) for row_id in missing_ids)}")

    current_status_by_row_id = {
        int(row["id"]): raw_row_importability_status(conn, row)
        for row in raw_rows
    }
    for raw_row in raw_rows:
        current_status = current_status_by_row_id[int(raw_row["id"])]
        if current_status != raw_row["import_status"]:
            conn.execute(
                """
                UPDATE raw_imported_rows
                SET import_status = ?,
                    updated_at = datetime('now')
                WHERE id = ?
                """,
                (current_status, raw_row["id"]),
            )
    unavailable_rows = [
        f"{row['id']} ({current_status_by_row_id[int(row['id'])]})"
        for row in raw_rows
        if current_status_by_row_id[int(row["id"])] not in IMPORTABLE_RAW_ROW_STATUSES
    ]
    if unavailable_rows:
        raise CliError(f"Only auto-importable or pre-fill raw rows can be imported: {', '.join(unavailable_rows)}")
    import_statuses = {current_status_by_row_id[int(row["id"])] for row in raw_rows}
    if len(import_statuses) > 1:
        raise CliError("Batch import cannot mix auto-importable and pre-fill raw rows.")

    uncategorized_rows = []
    untyped_rows = []
    undescribed_rows = []
    for raw_row in raw_rows:
        rule_result = import_rule_result_for_status(conn, raw_row, current_status_by_row_id[int(raw_row["id"])])
        rule_result = apply_raw_row_import_overrides(rule_result, overrides)
        if rule_result["category_id"] is None:
            uncategorized_rows.append(str(raw_row["id"]))
        if rule_result["transaction_type"] is None:
            untyped_rows.append(str(raw_row["id"]))
        if normalize_text(rule_result["clean_description"]) is None:
            undescribed_rows.append(str(raw_row["id"]))
        if rule_result["category_id"] is not None and rule_result["transaction_type"] is not None:
            require_category_allowed_for_transaction_type(conn, int(rule_result["category_id"]), rule_result["transaction_type"])
    if uncategorized_rows:
        raise CliError(f"Raw rows require a matched category before import: {', '.join(uncategorized_rows)}")
    if untyped_rows:
        raise CliError(f"Raw rows require a matched type before import: {', '.join(untyped_rows)}")
    if undescribed_rows:
        raise CliError(f"Raw rows require a matched description before import: {', '.join(undescribed_rows)}")

    results = []
    counts = {"imported": 0, "duplicate": 0, "error": 0}
    for raw_row in raw_rows:
        try:
            posted_date = parse_transaction_date(raw_row["raw_date"])
            amount_cents = parse_amount_cents(raw_row["raw_amount"])
            description = normalize_text(raw_row["raw_description"])
            if description is None:
                raise CliError("raw_description is required.")

            rule_result = import_rule_result_for_status(conn, raw_row, current_status_by_row_id[int(raw_row["id"])])
            rule_result = apply_raw_row_import_overrides(rule_result, overrides)
            require_category_allowed_for_transaction_type(conn, int(rule_result["category_id"]), rule_result["transaction_type"])
            clean_description = normalize_text(rule_result["clean_description"]) or description
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
                    (raw_row["id"],),
                )
                log_event(
                    conn,
                    "warning",
                    "raw_import",
                    "Raw row matched an existing transaction.",
                    {"raw_row_id": raw_row["id"], "transaction_id": duplicate["id"]},
                )
                counts["duplicate"] += 1
                results.append({"raw_row_id": raw_row["id"], "status": "duplicate", "transaction_id": duplicate["id"]})
                continue

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
                    rule_result["category_id"],
                    posted_date,
                    posted_date,
                    rule_result["transaction_type"],
                    clean_description,
                    amount_cents,
                    raw_row["id"],
                    transaction_hash,
                ),
            )
            transaction_id = int(cursor.lastrowid)
            note = normalize_text(normalized_notes.get(int(raw_row["id"])))
            if note is not None:
                conn.execute(
                    """
                    INSERT INTO transaction_notes (transaction_id, note)
                    VALUES (?, ?)
                    """,
                    (transaction_id, note),
                )
            for tag_id in rule_result["tag_ids"]:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
                    VALUES (?, ?)
                    """,
                    (transaction_id, tag_id),
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
                (transaction_id, raw_row["id"]),
            )
            log_event(
                conn,
                "info",
                "raw_import",
                "Raw row imported into a transaction.",
                {"raw_row_id": raw_row["id"], "transaction_id": transaction_id},
            )
            counts["imported"] += 1
            results.append({"raw_row_id": raw_row["id"], "status": "imported", "transaction_id": transaction_id})
        except Exception as exc:
            error = str(exc)
            conn.execute(
                """
                UPDATE raw_imported_rows
                SET import_status = 'error',
                    import_error = ?,
                    updated_at = datetime('now')
                WHERE id = ?
                """,
                (error, raw_row["id"]),
            )
            log_event(
                conn,
                "error",
                "raw_import",
                "Raw row import failed.",
                {"raw_row_id": raw_row["id"], "error": error},
            )
            counts["error"] += 1
            results.append({"raw_row_id": raw_row["id"], "status": "error", "error": error})

    return {"requested_raw_row_ids": normalized_ids, "counts": counts, "results": results}


def normalize_raw_row_import_overrides(
    conn: sqlite3.Connection,
    raw_overrides: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(raw_overrides, dict):
        raise CliError("raw_row_overrides must be an object.")

    overrides: dict[str, Any] = {}
    if "transaction_type" in raw_overrides:
        transaction_type = validate_transaction_type(raw_overrides.get("transaction_type"), allow_empty=True)
        if transaction_type is not None:
            overrides["transaction_type"] = transaction_type

    if "category_id" in raw_overrides:
        raw_category_id = raw_overrides.get("category_id")
        if raw_category_id not in (None, ""):
            try:
                category_id = int(raw_category_id)
            except (TypeError, ValueError) as exc:
                raise CliError("category_id override must be an integer.") from exc
            if category_id < 1:
                raise CliError("category_id override must be greater than 0.")
            require_category(conn, category_id)
            overrides["category_id"] = category_id

    if "clean_description" in raw_overrides:
        clean_description = normalize_text(raw_overrides.get("clean_description"))
        if clean_description is not None:
            overrides["clean_description"] = clean_description

    if "tag_ids" in raw_overrides:
        raw_tag_ids = raw_overrides.get("tag_ids")
        if not isinstance(raw_tag_ids, list):
            raise CliError("tag_ids override must be a list.")
        try:
            tag_ids = sorted({int(tag_id) for tag_id in raw_tag_ids if tag_id not in (None, "")})
        except (TypeError, ValueError) as exc:
            raise CliError("tag_ids override values must be integers.") from exc
        if any(tag_id < 1 for tag_id in tag_ids):
            raise CliError("tag_ids override values must be greater than 0.")
        for tag_id in tag_ids:
            fetch_tag_by_id(conn, tag_id)
        overrides["tag_ids"] = tag_ids

    return overrides


def apply_raw_row_import_overrides(rule_result: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    if not overrides:
        return rule_result
    merged = {
        "category_id": rule_result["category_id"],
        "clean_description": rule_result["clean_description"],
        "transaction_type": rule_result["transaction_type"],
        "tag_ids": list(rule_result["tag_ids"]),
    }
    for key, value in overrides.items():
        merged[key] = list(value) if key == "tag_ids" else value
    return merged


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
    start_date = parse_cli_date(args.start_date, "start_date")
    end_date = parse_cli_date(args.end_date, "end_date")
    if start_date and end_date and start_date > end_date:
        raise CliError("--start-date must be on or before --end-date.")

    filters: list[str] = []
    values: list[Any] = []
    if start_date:
        filters.append("t.posted_date >= ?")
        values.append(start_date)
    if end_date:
        filters.append("t.posted_date <= ?")
        values.append(end_date)
    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""

    with connect(args.db, readonly=True) as conn:
        rows = conn.execute(
            f"""
            SELECT
                t.id,
                t.posted_date,
                a.name AS account,
                t.transaction_type,
                t.clean_description,
                t.amount_cents,
                printf('%.2f', t.amount_cents / 100.0) AS amount,
                c.name AS category
            FROM transactions t
            JOIN accounts a ON a.id = t.account_id
            LEFT JOIN categories c ON c.id = t.category_id
            {where_clause}
            ORDER BY t.posted_date DESC, t.id DESC
            LIMIT ?
            """,
            (*values, args.limit),
        ).fetchall()
    print_json({
        "limit": args.limit,
        "start_date": start_date,
        "end_date": end_date,
        "transactions": rows_to_dicts(rows),
    })


def command_accounts(args: argparse.Namespace) -> None:
    with connect(args.db, readonly=True) as conn:
        rows = conn.execute(
            """
            SELECT
                a.id,
                a.name,
                i.name AS institution,
                a.account_type,
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
                t.transaction_type,
                a.name AS account,
                t.clean_description,
                t.amount_cents,
                printf('%.2f', t.amount_cents / 100.0) AS amount,
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
        sync_raw_row_importability_status(conn)
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
    external_account_id = optional_nonempty(args.external_account_id, "external_account_id")

    with connect(args.db) as conn:
        institution_id = get_or_create_institution(conn, institution)
        try:
            cursor = conn.execute(
                """
                INSERT INTO accounts (institution_id, name, account_type, external_account_id)
                VALUES (?, ?, ?, ?)
                """,
                (institution_id, name, account_type, external_account_id),
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


def command_update_account(args: argparse.Namespace) -> None:
    updates: list[str] = []
    values: list[Any] = []

    with connect(args.db) as conn:
        fetch_account(conn, args.id)
        if args.name is not None:
            updates.append("name = ?")
            values.append(nonempty(args.name, "name"))
        if args.institution is not None:
            updates.append("institution_id = ?")
            values.append(get_or_create_institution(conn, optional_nonempty(args.institution, "institution")))
        if args.account_type is not None:
            updates.append("account_type = ?")
            values.append(optional_nonempty(args.account_type, "account_type"))
        if args.external_account_id is not None:
            updates.append("external_account_id = ?")
            values.append(optional_nonempty(args.external_account_id, "external_account_id"))
        if not updates:
            raise CliError("No changes requested.")

        updates.append("updated_at = datetime('now')")
        values.append(args.id)
        try:
            conn.execute(
                f"""
                UPDATE accounts
                SET {', '.join(updates)}
                WHERE id = ?
                """,
                values,
            )
        except sqlite3.IntegrityError as exc:
            raise CliError(f"Could not update account: {exc}") from exc
        account = fetch_account(conn, args.id)

    print_json({"account": dict(account)})


def command_delete_account(args: argparse.Namespace) -> None:
    with connect(args.db) as conn:
        account = fetch_account(conn, args.id)
        require_account_unused(conn, args.id)
        conn.execute("DELETE FROM accounts WHERE id = ?", (args.id,))

    print_json({"status": "deleted", "account": dict(account)})


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


def command_rename_tag(args: argparse.Namespace) -> None:
    name = nonempty(args.name, "name")
    with connect(args.db) as conn:
        fetch_tag_by_id(conn, args.id)
        try:
            conn.execute("UPDATE tags SET name = ? WHERE id = ?", (name, args.id))
        except sqlite3.IntegrityError as exc:
            raise CliError(f"Could not rename tag: {exc}") from exc
        tag = fetch_tag_by_id(conn, args.id)

    print_json({"tag": dict(tag)})


def command_delete_tag(args: argparse.Namespace) -> None:
    with connect(args.db) as conn:
        tag = fetch_tag_by_id(conn, args.id)
        require_tag_unused(conn, args.id)
        conn.execute("DELETE FROM tags WHERE id = ?", (args.id,))

    print_json({"status": "deleted", "tag": dict(tag)})


def command_add_category(args: argparse.Namespace) -> None:
    name = nonempty(args.name, "name")
    with connect(args.db) as conn:
        try:
            cursor = conn.execute("INSERT INTO categories (name) VALUES (?)", (name,))
        except sqlite3.IntegrityError as exc:
            raise CliError(f"Could not add category: {exc}") from exc
        category = fetch_category_by_id(conn, int(cursor.lastrowid))

    print_json({"category": dict(category)})


def command_rename_category(args: argparse.Namespace) -> None:
    name = nonempty(args.name, "name")
    with connect(args.db) as conn:
        fetch_category_by_id(conn, args.id)
        try:
            conn.execute("UPDATE categories SET name = ? WHERE id = ?", (name, args.id))
        except sqlite3.IntegrityError as exc:
            raise CliError(f"Could not rename category: {exc}") from exc
        category = fetch_category_by_id(conn, args.id)

    print_json({"category": dict(category)})


def command_delete_category(args: argparse.Namespace) -> None:
    with connect(args.db) as conn:
        category = fetch_category_by_id(conn, args.id)
        require_category_unused(conn, args.id)
        conn.execute("DELETE FROM categories WHERE id = ?", (args.id,))

    print_json({"status": "deleted", "category": dict(category)})


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
    rule_type = validate_rule_type(args.rule_type)
    match_amount = validate_match_amount(args.match_amount)
    match_description, match_category, match_field, match_type, match_value = parse_rule_match_values(
        match_description=args.match_description,
        match_category=args.match_category,
        match_field=args.match_field,
        match_value=args.match_value,
        match_type=args.match_type,
    )
    set_clean_description = optional_nonempty(args.set_clean_description, "set_clean_description")
    set_transaction_type = validate_transaction_type(args.set_type, "set_type")
    is_active = 0 if args.inactive else 1

    validate_rule_payload(rule_type, args.set_category_id, set_clean_description, set_transaction_type, args.add_tag_id)

    with connect(args.db) as conn:
        duplicate = fetch_duplicate_transaction_rule(conn, rule_type, match_description, match_category, match_amount)
        if duplicate is not None:
            raise CliError(f"Duplicate rule matches existing rule {duplicate['id']}: {duplicate['name']}")
        if args.set_category_id is not None:
            require_category(conn, args.set_category_id)
        if args.add_tag_id is not None:
            require_tag_id(conn, args.add_tag_id)

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
                add_tag_id,
                is_active
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                rule_type,
                match_field,
                "contains",
                match_value,
                match_description,
                match_category,
                match_amount,
                args.set_category_id,
                set_clean_description,
                set_transaction_type,
                args.add_tag_id,
                is_active,
            ),
        )
        rule = fetch_transaction_rule(conn, int(cursor.lastrowid))
        sync_raw_row_importability_status(conn)

    print_json({"transaction_rule": dict(rule)})


def command_import_raw_rows(args: argparse.Namespace) -> None:
    with connect(args.db) as conn:
        payload = import_raw_rows(conn, args.raw_row_ids)
    print_json(payload)


def command_update_transaction_rule(args: argparse.Namespace) -> None:
    updates: list[str] = []
    values: list[Any] = []

    with connect(args.db) as conn:
        current = fetch_transaction_rule(conn, args.id)

        next_rule_type = current["rule_type"]
        next_set_category_id = current["set_category_id"]
        next_set_clean_description = current["set_clean_description"]
        next_set_transaction_type = current["set_transaction_type"]
        next_add_tag_id = current["add_tag_id"]
        next_match_description = current["match_description"]
        next_match_category = current["match_category"]
        next_match_amount = current["match_amount"]

        if args.name is not None:
            updates.append("name = ?")
            values.append(nonempty(args.name, "name"))
        if args.rule_type is not None:
            next_rule_type = validate_rule_type(args.rule_type)
            updates.append("rule_type = ?")
            values.append(next_rule_type)
        has_new_match_args = (
            args.match_description is not None
            or args.clear_match_description
            or args.match_category is not None
            or args.clear_match_category
        )
        has_legacy_match_args = args.match_field is not None or args.match_value is not None or args.match_type is not None
        if has_new_match_args:
            if args.clear_match_description:
                next_match_description = None
            elif args.match_description is not None:
                next_match_description = nonempty(args.match_description, "match_description")
            if args.clear_match_category:
                next_match_category = None
            elif args.match_category is not None:
                next_match_category = nonempty(args.match_category, "match_category")
            (
                next_match_description,
                next_match_category,
                next_match_field,
                next_match_type,
                next_match_value,
            ) = parse_rule_match_values(
                match_description=next_match_description,
                match_category=next_match_category,
                match_type=args.match_type,
            )
            updates.append("match_description = ?")
            values.append(next_match_description)
            updates.append("match_category = ?")
            values.append(next_match_category)
            updates.append("match_field = ?")
            values.append(next_match_field)
            updates.append("match_type = ?")
            values.append(next_match_type)
            updates.append("match_value = ?")
            values.append(next_match_value)
        elif has_legacy_match_args:
            (
                next_match_description,
                next_match_category,
                next_match_field,
                next_match_type,
                next_match_value,
            ) = parse_rule_match_values(
                match_field=args.match_field if args.match_field is not None else current["match_field"],
                match_value=args.match_value if args.match_value is not None else current["match_value"],
                match_type=args.match_type,
            )
            updates.append("match_description = ?")
            values.append(next_match_description)
            updates.append("match_category = ?")
            values.append(next_match_category)
            updates.append("match_field = ?")
            values.append(next_match_field)
            updates.append("match_type = ?")
            values.append(next_match_type)
            updates.append("match_value = ?")
            values.append(next_match_value)

        if args.match_amount is not None:
            next_match_amount = validate_match_amount(args.match_amount)
            updates.append("match_amount = ?")
            values.append(next_match_amount)

        if args.clear_category:
            next_set_category_id = None
            updates.append("set_category_id = ?")
            values.append(None)
        elif args.set_category_id is not None:
            require_category(conn, args.set_category_id)
            next_set_category_id = args.set_category_id
            updates.append("set_category_id = ?")
            values.append(args.set_category_id)

        if args.clear_clean_description:
            next_set_clean_description = None
            updates.append("set_clean_description = ?")
            values.append(None)
        elif args.set_clean_description is not None:
            next_set_clean_description = nonempty(args.set_clean_description, "set_clean_description")
            updates.append("set_clean_description = ?")
            values.append(next_set_clean_description)

        if args.clear_type:
            next_set_transaction_type = None
            updates.append("set_transaction_type = ?")
            values.append(None)
        elif args.set_type is not None:
            next_set_transaction_type = validate_transaction_type(args.set_type, "set_type")
            updates.append("set_transaction_type = ?")
            values.append(next_set_transaction_type)

        if args.clear_tag:
            next_add_tag_id = None
            updates.append("add_tag_id = ?")
            values.append(None)
        elif args.add_tag_id is not None:
            require_tag_id(conn, args.add_tag_id)
            next_add_tag_id = args.add_tag_id
            updates.append("add_tag_id = ?")
            values.append(args.add_tag_id)

        if args.active:
            updates.append("is_active = ?")
            values.append(1)
        elif args.inactive:
            updates.append("is_active = ?")
            values.append(0)

        if not updates:
            raise CliError("No changes requested.")

        validate_rule_payload(next_rule_type, next_set_category_id, next_set_clean_description, next_set_transaction_type, next_add_tag_id)
        duplicate = fetch_duplicate_transaction_rule(
            conn,
            next_rule_type,
            next_match_description,
            next_match_category,
            next_match_amount,
            exclude_rule_id=args.id,
        )
        if duplicate is not None:
            raise CliError(f"Duplicate rule matches existing rule {duplicate['id']}: {duplicate['name']}")

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
        sync_raw_row_importability_status(conn)

    print_json({"transaction_rule": dict(rule)})


def command_delete_transaction_rule(args: argparse.Namespace) -> None:
    with connect(args.db) as conn:
        rule = fetch_transaction_rule(conn, args.id)
        conn.execute("DELETE FROM transaction_import_rules WHERE id = ?", (args.id,))
        sync_raw_row_importability_status(conn)

    print_json({"status": "deleted", "transaction_rule": dict(rule)})


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
            "  python scripts/db_cli.py import-raw-rows 1 2 3\n"
            "  python scripts/db_cli.py add-tag --name reimbursable\n"
            "  python scripts/db_cli.py add-note --transaction-id 1 --note \"Reviewed\"\n"
            "  python scripts/db_cli.py add-transaction-rule --name Coffee --match-field description --match-type contains --match-value Starbucks --set-clean-description Starbucks"
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
    recent_parser.add_argument("--start-date")
    recent_parser.add_argument("--end-date")
    recent_parser.set_defaults(func=command_recent)

    accounts_parser = subparsers.add_parser("accounts", help="List accounts as JSON.")
    accounts_parser.set_defaults(func=command_accounts)

    transaction_parser = subparsers.add_parser("transaction", help="Show one transaction with tags and notes as JSON.")
    transaction_parser.add_argument("id", type=positive_int)
    transaction_parser.set_defaults(func=command_transaction)

    import_csv_parser = subparsers.add_parser(
        "import-csv",
        help="Upload CSV rows into imported_source and raw_imported_rows.",
    )
    import_csv_parser.add_argument("csv_path", type=Path)
    import_csv_parser.add_argument("--account-id", type=positive_int, required=True)
    import_csv_parser.add_argument("--source-type", default="csv")
    import_csv_parser.set_defaults(func=command_import_csv)

    import_raw_rows_parser = subparsers.add_parser(
        "import-raw-rows",
        help="Import selected raw_imported_rows into clean transactions.",
    )
    import_raw_rows_parser.add_argument("raw_row_ids", nargs="+", type=positive_int)
    import_raw_rows_parser.set_defaults(func=command_import_raw_rows)

    add_account_parser = subparsers.add_parser("add-account", help="Create an account and print the account as JSON.")
    add_account_parser.add_argument("--name", required=True)
    add_account_parser.add_argument("--institution")
    add_account_parser.add_argument("--account-type")
    add_account_parser.add_argument("--external-account-id")
    add_account_parser.set_defaults(func=command_add_account)

    rename_account_parser = subparsers.add_parser("rename-account", help="Rename an account and print it as JSON.")
    rename_account_parser.add_argument("id", type=positive_int)
    rename_account_parser.add_argument("--name", required=True)
    rename_account_parser.set_defaults(func=command_rename_account)

    update_account_parser = subparsers.add_parser("update-account", help="Update an account and print it as JSON.")
    update_account_parser.add_argument("id", type=positive_int)
    update_account_parser.add_argument("--name")
    update_account_parser.add_argument("--institution")
    update_account_parser.add_argument("--account-type")
    update_account_parser.add_argument("--external-account-id")
    update_account_parser.set_defaults(func=command_update_account)

    delete_account_parser = subparsers.add_parser("delete-account", help="Delete an unused account.")
    delete_account_parser.add_argument("id", type=positive_int)
    delete_account_parser.set_defaults(func=command_delete_account)

    add_note_parser = subparsers.add_parser("add-note", help="Create a note to a transaction and print the note as JSON.")
    add_note_parser.add_argument("--transaction-id", type=positive_int, required=True)
    add_note_parser.add_argument("--note", required=True)
    add_note_parser.set_defaults(func=command_add_note)

    add_tag_parser = subparsers.add_parser("add-tag", help="Create a tag and print it as JSON.")
    add_tag_parser.add_argument("--name", required=True)
    add_tag_parser.set_defaults(func=command_add_tag)

    rename_tag_parser = subparsers.add_parser("rename-tag", help="Rename a tag and print it as JSON.")
    rename_tag_parser.add_argument("id", type=positive_int)
    rename_tag_parser.add_argument("--name", required=True)
    rename_tag_parser.set_defaults(func=command_rename_tag)

    delete_tag_parser = subparsers.add_parser("delete-tag", help="Delete an unused tag.")
    delete_tag_parser.add_argument("id", type=positive_int)
    delete_tag_parser.set_defaults(func=command_delete_tag)

    add_category_parser = subparsers.add_parser("add-category", help="Create a category and print it as JSON.")
    add_category_parser.add_argument("--name", required=True)
    add_category_parser.set_defaults(func=command_add_category)

    rename_category_parser = subparsers.add_parser("rename-category", help="Rename a category and print it as JSON.")
    rename_category_parser.add_argument("id", type=positive_int)
    rename_category_parser.add_argument("--name", required=True)
    rename_category_parser.set_defaults(func=command_rename_category)

    delete_category_parser = subparsers.add_parser("delete-category", help="Delete an unused category.")
    delete_category_parser.add_argument("id", type=positive_int)
    delete_category_parser.set_defaults(func=command_delete_category)

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
        help="Create a transaction import rule and print it as JSON.",
    )
    add_rule_parser.add_argument("--name", required=True)
    add_rule_parser.add_argument("--rule-type", choices=sorted(RULE_TYPES), default="auto-import")
    add_rule_parser.add_argument("--match-description")
    add_rule_parser.add_argument("--match-category")
    add_rule_parser.add_argument("--match-amount", choices=sorted(MATCH_AMOUNTS), default="any")
    add_rule_parser.add_argument("--match-field", choices=sorted(MATCH_FIELDS))
    add_rule_parser.add_argument("--match-type", choices=sorted(MATCH_TYPES))
    add_rule_parser.add_argument("--match-value")
    add_rule_parser.add_argument("--set-category-id", type=positive_int)
    add_rule_parser.add_argument("--set-clean-description")
    add_rule_parser.add_argument("--set-type", choices=sorted(TRANSACTION_TYPES))
    add_rule_parser.add_argument("--add-tag-id", type=positive_int)
    add_rule_parser.add_argument("--inactive", action="store_true")
    add_rule_parser.set_defaults(func=command_add_transaction_rule)

    update_rule_parser = subparsers.add_parser(
        "update-transaction-rule",
        help="Update a transaction import rule and print it as JSON.",
    )
    update_rule_parser.add_argument("id", type=positive_int)
    update_rule_parser.add_argument("--name")
    update_rule_parser.add_argument("--rule-type", choices=sorted(RULE_TYPES))
    update_rule_parser.add_argument("--match-description")
    update_rule_parser.add_argument("--clear-match-description", action="store_true")
    update_rule_parser.add_argument("--match-category")
    update_rule_parser.add_argument("--clear-match-category", action="store_true")
    update_rule_parser.add_argument("--match-amount", choices=sorted(MATCH_AMOUNTS))
    update_rule_parser.add_argument("--match-field", choices=sorted(MATCH_FIELDS))
    update_rule_parser.add_argument("--match-type", choices=sorted(MATCH_TYPES))
    update_rule_parser.add_argument("--match-value")
    category_group = update_rule_parser.add_mutually_exclusive_group()
    category_group.add_argument("--set-category-id", type=positive_int)
    category_group.add_argument("--clear-category", action="store_true")
    description_group = update_rule_parser.add_mutually_exclusive_group()
    description_group.add_argument("--set-clean-description")
    description_group.add_argument("--clear-clean-description", action="store_true")
    type_group = update_rule_parser.add_mutually_exclusive_group()
    type_group.add_argument("--set-type", choices=sorted(TRANSACTION_TYPES))
    type_group.add_argument("--clear-type", action="store_true")
    tag_group = update_rule_parser.add_mutually_exclusive_group()
    tag_group.add_argument("--add-tag-id", type=positive_int)
    tag_group.add_argument("--clear-tag", action="store_true")
    active_group = update_rule_parser.add_mutually_exclusive_group()
    active_group.add_argument("--active", action="store_true")
    active_group.add_argument("--inactive", action="store_true")
    update_rule_parser.set_defaults(func=command_update_transaction_rule)

    delete_rule_parser = subparsers.add_parser("delete-transaction-rule", help="Delete a transaction import rule.")
    delete_rule_parser.add_argument("id", type=positive_int)
    delete_rule_parser.set_defaults(func=command_delete_transaction_rule)

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
