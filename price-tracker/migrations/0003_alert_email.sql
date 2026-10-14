-- Address that receives this product's price alerts. NULL means the default address (NOTIFY_TO).
ALTER TABLE products ADD COLUMN notify_email TEXT;
