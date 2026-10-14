-- Product picture URL, taken from the page's schema.org image or og:image.
ALTER TABLE products ADD COLUMN image_url TEXT;
