PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS institutions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    website TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    institution_id INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    account_type TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    external_account_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (name, institution_id)
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    posted_date TEXT NOT NULL,
    transaction_date TEXT,
    payee TEXT,
    description TEXT,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'posted',
    external_transaction_id TEXT,
    import_source_file_id INTEGER REFERENCES imported_source_files(id) ON DELETE SET NULL,
    raw_imported_row_id INTEGER REFERENCES raw_imported_rows(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (status IN ('pending', 'posted', 'void')),
    UNIQUE (account_id, external_transaction_id)
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transaction_import_rules (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    match_field TEXT NOT NULL,
    match_type TEXT NOT NULL,
    match_value TEXT NOT NULL,
    set_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    set_merchant_clean TEXT,
    add_tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (match_field IN ('merchant_raw', 'description_raw')),
    CHECK (match_type IN ('contains', 'equals', 'starts_with', 'regex')),
    CHECK (is_active IN (0, 1)),
    CHECK (set_category_id IS NOT NULL OR set_merchant_clean IS NOT NULL OR add_tag_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS transaction_tags (
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE IF NOT EXISTS transaction_notes (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS imported_source_files (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    source_type TEXT,
    sha256 TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    row_count INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT,
    UNIQUE (sha256)
);

CREATE TABLE IF NOT EXISTS raw_imported_rows (
    id INTEGER PRIMARY KEY,
    imported_source_file_id INTEGER NOT NULL REFERENCES imported_source_files(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    raw_json TEXT NOT NULL,
    parsed_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (imported_source_file_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_accounts_institution_id ON accounts(institution_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions(account_id, posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions(category_id, posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_posted_date ON transactions(posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_payee ON transactions(payee);
CREATE INDEX IF NOT EXISTS idx_transactions_import_source ON transactions(import_source_file_id);
CREATE INDEX IF NOT EXISTS idx_transaction_import_rules_active_priority ON transaction_import_rules(is_active, priority, id);
CREATE INDEX IF NOT EXISTS idx_transaction_import_rules_match ON transaction_import_rules(match_field, match_type);
CREATE INDEX IF NOT EXISTS idx_transaction_import_rules_set_category_id ON transaction_import_rules(set_category_id);
CREATE INDEX IF NOT EXISTS idx_transaction_import_rules_add_tag_id ON transaction_import_rules(add_tag_id);
CREATE INDEX IF NOT EXISTS idx_transaction_tags_tag_id ON transaction_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_transaction_notes_transaction_id ON transaction_notes(transaction_id);
CREATE INDEX IF NOT EXISTS idx_raw_imported_rows_source_file_id ON raw_imported_rows(imported_source_file_id);
CREATE INDEX IF NOT EXISTS idx_raw_imported_rows_parsed_transaction_id ON raw_imported_rows(parsed_transaction_id);
