# Transaction History

A local SQLite-backed skeleton for storing transaction history, import audit data, notes, categories, and tags.

## Files

- `db/schema.sql` defines the SQLite schema and indexes.
- `scripts/init_db.py` creates `data/transactions.sqlite` from the schema.
- `scripts/db_cli.py` provides read-only inspection commands plus database initialization.
- `data/transactions.sqlite` is generated locally and ignored by Git.

## Initialize

```powershell
python scripts/init_db.py
```

Or through the CLI:

```powershell
python scripts/db_cli.py init
```

## CLI

Read commands print JSON so other tools and agents can consume the output without parsing tables.

```powershell
python scripts/db_cli.py tables
python scripts/db_cli.py describe transactions
python scripts/db_cli.py query-readonly "SELECT name FROM sqlite_master WHERE type = 'table'"
python scripts/db_cli.py recent --limit 20
python scripts/db_cli.py accounts
python scripts/db_cli.py transaction 1
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
    "imported_source_files",
    "raw_imported_rows",
    "tags",
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

The CLI intentionally does not include destructive commands. Schema changes should be made in `db/schema.sql`, then applied by regenerating or reinitializing the local database with `python scripts/db_cli.py init`.
