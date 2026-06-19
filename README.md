# Transaction History

A local SQLite-backed skeleton for storing transaction history, institutions, accounts, import audit data, notes, categories, and tags.

## Files

- `server.py` provides a Flask API and serves the browser app.
- `index.html`, `styles.css`, and `app.js` define the browser UI.
- `db/schema.sql` defines the SQLite schema and indexes.
- `scripts/init_db.py` creates `data/transactions.sqlite` from the schema.
- `scripts/db_cli.py` provides read-only inspection commands plus database initialization.
- `data/transactions.sqlite` is generated locally and ignored by Git.

## App

Run the Flask server, then open the local URL it prints:

```powershell
pip install -r requirements.txt
python server.py
```

The app stores data in `data/transactions.sqlite` through the Flask API and supports accounts, tags, import rules, imported sources, and CSV imports into raw imported rows. It does not create normalized transactions yet.

The main endpoints are:

- `GET /api/state`
- `POST /api/accounts`
- `POST /api/tags`
- `POST /api/rules`
- `POST /api/imports/csv`
- `PATCH /api/raw-rows/<id>`

## Initialize

```powershell
python scripts/init_db.py
```

Or through the CLI:

```powershell
python scripts/db_cli.py init
```

`init` applies `db/schema.sql`. If the generated local database is structurally stale but empty, it is rebuilt from `db/schema.sql`. If it contains data, `init` stops and asks for a real migration instead of overwriting data.

## CLI

Read commands print JSON so other tools and agents can consume the output without parsing tables.

```powershell
python scripts/db_cli.py tables
python scripts/db_cli.py describe transactions
python scripts/db_cli.py query-readonly "SELECT name FROM sqlite_master WHERE type = 'table'"
python scripts/db_cli.py recent --limit 20
python scripts/db_cli.py accounts
python scripts/db_cli.py transaction 1
python scripts/db_cli.py import-csv "C:\path\to\statement.csv" --account-id 1
python scripts/db_cli.py add-account --name Checking --institution "Example Bank"
python scripts/db_cli.py rename-account 1 --name "Primary Checking"
python scripts/db_cli.py add-note --transaction-id 1 --note "Reviewed"
python scripts/db_cli.py add-tag --name reimbursable
python scripts/db_cli.py tag-transaction --transaction-id 1 --tag reimbursable
python scripts/db_cli.py untag-transaction --transaction-id 1 --tag reimbursable
python scripts/db_cli.py add-transaction-rule --name Coffee --match-description Starbucks --set-clean-description Starbucks
python scripts/db_cli.py update-transaction-rule 1 --inactive
```

Use `--db <path>` before the command to point at another SQLite database:

```powershell
python scripts/db_cli.py --db data/transactions.sqlite tables
```

Examples:

```powershell
python scripts/db_cli.py tables
```

```json
{
  "tables": [
    "accounts",
    "categories",
    "imported_source",
    "institutions",
    "raw_imported_rows",
    "tags",
    "transaction_import_rules",
    "transaction_notes",
    "transaction_tags",
    "transactions"
  ]
}
```

```powershell
python scripts/db_cli.py query-readonly "SELECT COUNT(*) AS transaction_count FROM transactions"
```

```json
{
  "row_count": 1,
  "rows": [
    {
      "transaction_count": 0
    }
  ]
}
```

`query-readonly` accepts a single `SELECT`, `WITH`, or `PRAGMA` statement. It rejects statements containing write or schema keywords such as `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, or `CREATE`.

Safe write commands validate inputs and print the changed row as JSON. `tag-transaction` expects the tag to already exist; create it first with `add-tag`.

```powershell
python scripts/db_cli.py add-account --name Checking --institution "Example Bank" --account-type checking
```

```json
{
  "account": {
    "account_type": "checking",
    "created_at": "2026-06-08 15:45:00",
    "external_account_id": null,
    "id": 1,
    "institution": "Example Bank",
    "institution_id": 1,
    "name": "Checking",
    "updated_at": "2026-06-08 15:45:00"
  }
}
```

```powershell
python scripts/db_cli.py add-tag --name reimbursable
python scripts/db_cli.py tag-transaction --transaction-id 1 --tag reimbursable
python scripts/db_cli.py add-note --transaction-id 1 --note "Reviewed"
```

The CLI intentionally does not include broad destructive commands or delete commands. `untag-transaction` is the only removal-style operation and is limited to the explicit transaction/tag association. Schema changes should be made in `db/schema.sql`, then applied by regenerating or reinitializing the local database with `python scripts/db_cli.py init`.

## Import Rules

`transaction_import_rules` stores reusable rules for cleaning and categorizing imported rows. Rules can contain-match description, category, or both, then can set a category, set a clean description, set a transaction type, and/or add tags.

```powershell
python scripts/db_cli.py describe transaction_import_rules
python scripts/db_cli.py query-readonly "SELECT * FROM transaction_import_rules WHERE is_active = 1 ORDER BY id"
```

Create or update rules through the CLI so input validation is repeatable:

```powershell
python scripts/db_cli.py add-transaction-rule --name Coffee --match-description Starbucks --set-clean-description Starbucks
python scripts/db_cli.py update-transaction-rule 1 --match-description Starbucks --match-category Dining --active
python scripts/db_cli.py update-transaction-rule 1 --set-category-id 2 --add-tag-id 3
python scripts/db_cli.py update-transaction-rule 1 --clear-category --clear-tag
```

Each rule must keep at least one action: `--set-category-id`, `--set-clean-description`, `--set-type`, or `--add-tag-id`. `--set-category-id` and `--add-tag-id` must reference existing rows.

## Raw Imported Rows

`raw_imported_rows` stores the actual imported row fields before they are normalized into a transaction:

- `imported_source_id` links the row to `imported_source`.
- `imported_source.account_id` records the account supplied at upload/import time.
- `raw_date`, `raw_category`, `raw_description`, and `raw_amount` preserve the source values as text.
- `parsed_transaction_id` links to the resulting transaction after parsing.
- `import_status` tracks whether the raw row is `auto-importable`, `manual`, `pre-fill`, `imported`, `duplicate`, or `error`. The app's "New" filter combines `auto-importable`, `manual`, and `pre-fill` rows; importability is recomputed from active rules.

At least one raw field must be present. The table intentionally keeps raw values as `TEXT`; parsing into dates, cents, categories, and tags happens later.

CSV imports require an account:

```powershell
python scripts/db_cli.py import-csv "C:\path\to\statement.csv" --account-id 1
```

The importer currently recognizes the observed Capital One credit, Chase checking, and SoFi banking CSV layouts, with a generic fallback for common date, description, category, and amount columns. CSV type columns are ignored. Re-importing the same file hash for the same account is idempotent; importing the same file hash for a different account is rejected.
