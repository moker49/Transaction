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
    color TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    posted_date TEXT NOT NULL,
    transaction_date TEXT,
    transaction_type TEXT NOT NULL,
    clean_description TEXT,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'posted',
    external_transaction_id TEXT,
    raw_imported_row_id INTEGER REFERENCES raw_imported_rows(id) ON DELETE SET NULL,
    transaction_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (transaction_type IN ('income', 'bill', 'splurge')),
    CHECK (status IN ('pending', 'posted', 'void')),
    UNIQUE (account_id, external_transaction_id),
    UNIQUE (account_id, transaction_hash)
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
    set_clean_description TEXT,
    set_transaction_type TEXT,
    add_tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (match_field IN ('category', 'description')),
    CHECK (match_type IN ('contains', 'equals', 'starts_with', 'regex')),
    CHECK (set_transaction_type IS NULL OR set_transaction_type IN ('income', 'bill', 'splurge')),
    CHECK (is_active IN (0, 1)),
    CHECK (set_category_id IS NOT NULL OR set_clean_description IS NOT NULL OR set_transaction_type IS NOT NULL OR add_tag_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS transaction_tags (
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE IF NOT EXISTS transaction_import_rule_tags (
    rule_id INTEGER NOT NULL REFERENCES transaction_import_rules(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (rule_id, tag_id)
);

CREATE TABLE IF NOT EXISTS transaction_notes (
    id INTEGER PRIMARY KEY,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS imported_source (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
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
    imported_source_id INTEGER NOT NULL REFERENCES imported_source(id) ON DELETE CASCADE,
    raw_date TEXT,
    raw_category TEXT,
    raw_description TEXT,
    raw_amount TEXT,
    parsed_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    import_status TEXT NOT NULL DEFAULT 'new',
    import_error TEXT,
    raw_row_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (import_status IN ('new', 'ready', 'imported', 'duplicate', 'error')),
    CHECK (
        raw_date IS NOT NULL
        OR raw_category IS NOT NULL
        OR raw_description IS NOT NULL
        OR raw_amount IS NOT NULL
    )
);

CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (level IN ('info', 'warning', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_institution_id ON accounts(institution_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions(account_id, posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions(category_id, posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_posted_date ON transactions(posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_clean_description ON transactions(clean_description);
CREATE INDEX IF NOT EXISTS idx_transactions_hash ON transactions(account_id, transaction_hash);
CREATE INDEX IF NOT EXISTS idx_transaction_import_rules_active_priority ON transaction_import_rules(is_active, priority, id);
CREATE INDEX IF NOT EXISTS idx_transaction_import_rules_match ON transaction_import_rules(match_field, match_type);
CREATE INDEX IF NOT EXISTS idx_transaction_import_rules_set_category_id ON transaction_import_rules(set_category_id);
CREATE INDEX IF NOT EXISTS idx_transaction_import_rules_add_tag_id ON transaction_import_rules(add_tag_id);
CREATE INDEX IF NOT EXISTS idx_transaction_import_rule_tags_tag_id ON transaction_import_rule_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_transaction_tags_tag_id ON transaction_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_transaction_notes_transaction_id ON transaction_notes(transaction_id);
CREATE INDEX IF NOT EXISTS idx_imported_source_account_id ON imported_source(account_id);
CREATE INDEX IF NOT EXISTS idx_raw_imported_rows_imported_source_id ON raw_imported_rows(imported_source_id);
CREATE INDEX IF NOT EXISTS idx_raw_imported_rows_status ON raw_imported_rows(import_status);
CREATE INDEX IF NOT EXISTS idx_raw_imported_rows_raw_date ON raw_imported_rows(raw_date);
CREATE INDEX IF NOT EXISTS idx_raw_imported_rows_parsed_transaction_id ON raw_imported_rows(parsed_transaction_id);
CREATE INDEX IF NOT EXISTS idx_raw_imported_rows_hash ON raw_imported_rows(imported_source_id, raw_row_hash);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC);
