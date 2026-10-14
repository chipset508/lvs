// HTML for the tracker pages. Everything from the database goes through escapeHtml.

// Times are shown in this timezone; the tracker is for personal use in Vietnam.
const DISPLAY_TIME_ZONE = "Asia/Ho_Chi_Minh";

export interface ProductView {
  id: number;
  url: string;
  name: string | null;
  currency: string | null;
  last_price: number | null;
  last_checked_at: string | null;
  last_error: string | null;
  target_price: number | null;
  alerted_at: string | null;
}

export interface HistoryView {
  price: number;
  currency: string;
  checked_at: string;
}

export function renderList(
  notice: string | null,
  products: ProductView[],
): string {
  const cards =
    products.length === 0
      ? '<p class="muted">Nothing tracked yet.</p>'
      : products.map(renderCard).join("");

  return layout(
    notice,
    `<form class="add" method="post" action="/products">
  <input type="url" name="url" placeholder="Paste a product link" required>
  <button type="submit">Track</button>
</form>
${cards}`,
  );
}

export function renderDetail(
  notice: string | null,
  product: ProductView,
  history: HistoryView[],
): string {
  // History is stored oldest-first. Each event is compared with the one before it,
  // then the list is reversed so the newest event is on top.
  const timeline =
    history.length === 0
      ? '<p class="muted">No price recorded yet.</p>'
      : `<ol class="timeline">${history
          .map((row, index) => renderEvent(row, history[index - 1]))
          .reverse()
          .join("")}</ol>`;

  return layout(
    notice,
    `<p class="back"><a href="/">← All products</a></p>
<h1>${escapeHtml(productTitle(product))}</h1>
<section class="card">
  <div class="price">${priceText(product)}</div>
  <div class="muted">${checkedText(product)}${errorText(product)}</div>
  <p><a href="${escapeHtml(product.url)}" target="_blank" rel="noopener">Open product page ↗</a></p>
</section>
<section class="card">
  <h2>Target price</h2>
  <p>${targetStatusText(product)}</p>
  <form class="target" method="post" action="/products/${product.id}/target">
    <input type="number" name="target" min="1" step="1" inputmode="numeric" placeholder="e.g. 300000" value="${product.target_price ?? ""}">
    <span class="muted">${product.currency ?? ""}</span>
    <button type="submit">Save</button>
  </form>
  <p class="muted">Empty the field and save to clear the target. You get one email each time the price drops below it.</p>
</section>
<section class="card">
  <h2>Price timeline</h2>
  ${timeline}
</section>
<form method="post" action="/products/${product.id}/delete" onsubmit="return confirm('Stop tracking this product?')">
  <button class="danger" type="submit">Remove product</button>
</form>`,
  );
}

function layout(notice: string | null, body: string): string {
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
  .site { font-weight: 700; margin: 8px 0 16px; }
  .site a, .back a { color: inherit; }
  h1 { font-size: 1.4rem; margin: 8px 0 12px; overflow-wrap: anywhere; }
  h2 { font-size: 1.05rem; margin: 0 0 8px; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  .notice { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; }
  .add, .target { display: flex; gap: 8px; align-items: center; margin: 12px 0; }
  .add input, .target input { flex: 1; min-width: 0; padding: 8px; font: inherit; }
  button { font: inherit; padding: 8px 14px; cursor: pointer; }
  .product, .card { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
  .product header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
  .product a { font-weight: 600; color: inherit; overflow-wrap: anywhere; }
  .price { font-size: 1.3rem; font-weight: 700; margin: 2px 0; }
  .error, .up { color: var(--up); }
  .down { color: var(--down); }
  .danger { color: var(--up); background: none; border: 1px solid currentColor; border-radius: 6px; }
  .timeline { list-style: none; margin: 0; padding: 0 0 0 18px; border-left: 2px solid var(--border); }
  .timeline li { position: relative; padding: 4px 0 14px; }
  .timeline li::before { content: ""; position: absolute; left: -24px; top: 8px; width: 10px; height: 10px; border-radius: 50%; background: var(--muted); }
  .timeline .price { font-size: 1.05rem; }
</style>
</head>
<body>
<main>
<p class="site"><a href="/">Price Tracker</a></p>
${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
${body}
</main>
</body>
</html>`;
}

function renderCard(product: ProductView): string {
  const target =
    product.target_price === null
      ? ""
      : `<div class="muted">Target ${money(product.target_price, product.currency)}</div>`;

  return `<section class="product">
  <header>
    <div>
      <a href="/products/${product.id}">${escapeHtml(productTitle(product))}</a>
      <div class="price">${priceText(product)}</div>
      <div class="muted">${checkedText(product)}${errorText(product)}</div>
      ${target}
    </div>
    <form method="post" action="/products/${product.id}/delete" onsubmit="return confirm('Stop tracking this product?')">
      <button class="danger" type="submit">Remove</button>
    </form>
  </header>
</section>
`;
}

function renderEvent(row: HistoryView, previous: HistoryView | undefined): string {
  const change = previous
    ? formatChange(row.price, previous.price, row.currency)
    : '<span class="muted">First price recorded</span>';
  return `<li><div class="muted">${formatDate(row.checked_at)}</div><div class="price">${formatPrice(row.price, row.currency)}</div><div>${change}</div></li>`;
}

function targetStatusText(product: ProductView): string {
  if (product.target_price === null) return "No target set.";

  const target = money(product.target_price, product.currency);
  if (product.last_price === null) {
    return `Target ${target}. Waiting for the first price check.`;
  }
  if (product.last_price >= product.target_price) {
    return `Target ${target}. The price is above it, so you will be emailed when it drops below.`;
  }
  if (product.alerted_at) {
    return `Target ${target}. The price is below it. Alert email sent ${formatDate(product.alerted_at)}.`;
  }
  return `Target ${target}. The price is below it, but the alert email has not been sent yet. It will be retried on the next check.`;
}

function productTitle(product: ProductView): string {
  return product.name ?? product.url;
}

function priceText(product: ProductView): string {
  return product.last_price === null || product.currency === null
    ? "No price yet"
    : formatPrice(product.last_price, product.currency);
}

function checkedText(product: ProductView): string {
  return product.last_checked_at
    ? `Checked ${formatDate(product.last_checked_at)}`
    : "Not checked yet";
}

function errorText(product: ProductView): string {
  return product.last_error
    ? ` · <span class="error">${escapeHtml(product.last_error)}</span>`
    : "";
}

function money(amount: number, currency: string | null): string {
  return currency ? formatPrice(amount, currency) : amount.toLocaleString("en-US");
}

function formatChange(price: number, previous: number, currency: string): string {
  const diff = price - previous;
  if (diff === 0) return "—";
  const percent = Math.abs((diff / previous) * 100).toFixed(1);
  const arrow = diff > 0 ? "▲" : "▼";
  const sign = diff > 0 ? "+" : "−";
  const className = diff > 0 ? "up" : "down";
  return `<span class="${className}">${arrow} ${sign}${formatPrice(Math.abs(diff), currency)} (${sign}${percent}%)</span>`;
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
