CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  name TEXT,
  currency TEXT,
  last_price REAL,
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per price change (plus the first successful check), not per hourly check.
CREATE TABLE price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price REAL NOT NULL,
  currency TEXT NOT NULL,
  checked_at TEXT NOT NULL
);

CREATE INDEX price_history_product_idx ON price_history (product_id, checked_at);
