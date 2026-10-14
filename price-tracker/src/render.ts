// HTML for the tracker page. Everything from the database goes through escapeHtml.

// Price history is shown in this timezone; the tracker is for personal use in Vietnam.
const DISPLAY_TIME_ZONE = "Asia/Ho_Chi_Minh";

export interface ProductView {
  id: number;
  url: string;
  name: string | null;
  currency: string | null;
  last_price: number | null;
  last_checked_at: string | null;
  last_error: string | null;
}

export interface HistoryView {
  product_id: number;
  price: number;
  currency: string;
  checked_at: string;
}

export function renderPage(
  notice: string | null,
  products: ProductView[],
  history: HistoryView[],
): string {
  const historyByProduct = new Map<number, HistoryView[]>();
  for (const row of history) {
    const rows = historyByProduct.get(row.product_id) ?? [];
    rows.push(row);
    historyByProduct.set(row.product_id, rows);
  }

  const body =
    products.length === 0
      ? '<p class="muted">Nothing tracked yet.</p>'
      : products
          .map((product) =>
            renderProduct(product, historyByProduct.get(product.id) ?? []),
          )
          .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Price Tracker</title>
<style>
  :root { color-scheme: light dark; --muted: #6b7280; --border: #d1d5db; --down: #15803d; --up: #b91c1c; }
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 1.5rem; margin: 8px 0; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  .notice { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; }
  .add { display: flex; gap: 8px; margin: 16px 0; }
  .add input { flex: 1; min-width: 0; padding: 8px; font: inherit; }
  button { font: inherit; padding: 8px 14px; cursor: pointer; }
  .product { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
  .product header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
  .product a { font-weight: 600; color: inherit; overflow-wrap: anywhere; }
  .price { font-size: 1.3rem; font-weight: 700; margin: 2px 0; }
  .error, .up { color: var(--up); }
  .down { color: var(--down); }
  .danger { color: var(--up); background: none; border: 1px solid currentColor; border-radius: 6px; }
  details { margin-top: 8px; }
  summary { cursor: pointer; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 0.95rem; }
  th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--border); }
</style>
</head>
<body>
<main>
<h1>Price Tracker</h1>
${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
<form class="add" method="post" action="/products">
  <input type="url" name="url" placeholder="Paste a product link" required>
  <button type="submit">Track</button>
</form>
${body}
</main>
</body>
</html>`;
}

function renderProduct(product: ProductView, history: HistoryView[]): string {
  const title = escapeHtml(product.name ?? product.url);
  const price =
    product.last_price === null || product.currency === null
      ? "No price yet"
      : formatPrice(product.last_price, product.currency);
  const checked = product.last_checked_at
    ? `Checked ${formatDate(product.last_checked_at)}`
    : "Not checked yet";
  const error = product.last_error
    ? ` · <span class="error">${escapeHtml(product.last_error)}</span>`
    : "";

  // History is stored oldest-first, so each row is compared with the one before it.
  const rows = history
    .map((row, index) => {
      const previous = history[index - 1];
      const change = previous
        ? formatChange(row.price, previous.price, row.currency)
        : "—";
      return `<tr><td>${formatDate(row.checked_at)}</td><td>${formatPrice(row.price, row.currency)}</td><td>${change}</td></tr>`;
    })
    .reverse()
    .join("");

  return `<section class="product">
  <header>
    <div>
      <a href="${escapeHtml(product.url)}" target="_blank" rel="noopener">${title}</a>
      <div class="price">${price}</div>
      <div class="muted">${checked}${error}</div>
    </div>
    <form method="post" action="/products/${product.id}/delete" onsubmit="return confirm('Stop tracking this product?')">
      <button class="danger" type="submit">Remove</button>
    </form>
  </header>
  <details>
    <summary>Price history (${history.length} recorded)</summary>
    <table>
      <thead><tr><th>Date</th><th>Price</th><th>Change</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </details>
</section>
`;
}

function formatChange(
  price: number,
  previous: number,
  currency: string,
): string {
  const diff = price - previous;
  if (diff === 0) return "—";
  const percent = Math.abs((diff / previous) * 100).toFixed(1);
  const sign = diff > 0 ? "+" : "−";
  const className = diff > 0 ? "up" : "down";
  return `<span class="${className}">${sign}${formatPrice(Math.abs(diff), currency)} (${sign}${percent}%)</span>`;
}

export function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(iso));
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
