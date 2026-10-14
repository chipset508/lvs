ALTER TABLE products ADD COLUMN target_price REAL;

-- Set when the alert email for the current below-target period was sent.
-- Cleared when the price goes back above the target or the target changes.
ALTER TABLE products ADD COLUMN alerted_at TEXT;
