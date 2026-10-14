import { fetchPrice } from "./extract";
import {
  escapeHtml,
  formatPrice,
  renderPage,
  type HistoryView,
  type ProductView,
} from "./render";

export interface Env {
  DB: D1Database;
  // Password for the Basic-auth prompt. Set with `wrangler secret put ADMIN_TOKEN`.
  ADMIN_TOKEN: string;
}

type CheckResult =
  | { ok: true; name: string | null; price: number; currency: string }
  | { ok: false; error: string };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!isAuthorized(request, env)) {
      return new Response("Login required", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="price-tracker"' },
      });
    }

    const url = new URL(request.url);
    const removeMatch = url.pathname.match(/^\/products\/(\d+)\/delete$/);

    if (request.method === "GET" && url.pathname === "/") {
      return showPage(env, url.searchParams.get("notice"));
    }
    if (request.method === "POST" && url.pathname === "/products") {
      return addProduct(request, env);
    }
    if (request.method === "POST" && removeMatch) {
      return removeProduct(Number(removeMatch[1]), env);
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await checkAllProducts(env);
  },
} satisfies ExportedHandler<Env>;

async function showPage(env: Env, notice: string | null): Promise<Response> {
  const [products, history] = await Promise.all([
    env.DB.prepare(
      "SELECT * FROM products ORDER BY id DESC",
    ).all<ProductView>(),
    env.DB.prepare(
      "SELECT product_id, price, currency, checked_at FROM price_history ORDER BY checked_at ASC, id ASC",
    ).all<HistoryView>(),
  ]);

  return new Response(renderPage(notice, products.results, history.results), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function addProduct(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const raw = String(form.get("url") ?? "").trim();

  let link: URL;
  try {
    link = new URL(raw);
  } catch {
    return redirectWithNotice("That is not a valid link.");
  }
  if (link.protocol !== "http:" && link.protocol !== "https:") {
    return redirectWithNotice("Only http and https links can be tracked.");
  }

  const inserted = await env.DB.prepare(
    "INSERT INTO products (url) VALUES (?) ON CONFLICT (url) DO NOTHING RETURNING id",
  )
    .bind(link.href)
    .first<{ id: number }>();
  if (!inserted) {
    return redirectWithNotice("That link is already tracked.");
  }

  const product: ProductView = {
    id: inserted.id,
    url: link.href,
    name: null,
    currency: null,
    last_price: null,
    last_checked_at: null,
    last_error: null,
  };
  const result = await checkProduct(env, product);
  if (!result.ok) {
    return redirectWithNotice(
      `Saved, but the first check failed: ${result.error}. It will be retried every hour.`,
    );
  }
  return redirectWithNotice(
    `Now tracking ${result.name ?? link.href}: ${formatPrice(result.price, result.currency)}`,
  );
}

async function removeProduct(id: number, env: Env): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM price_history WHERE product_id = ?").bind(id),
    env.DB.prepare("DELETE FROM products WHERE id = ?").bind(id),
  ]);
  return redirectWithNotice("Removed.");
}

async function checkAllProducts(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM products ORDER BY id",
  ).all<ProductView>();
  await Promise.allSettled(
    results.map((product) => checkProduct(env, product)),
  );
}

// Fetches the price and saves it. A history row is written only when the price or currency changes.
async function checkProduct(
  env: Env,
  product: ProductView,
): Promise<CheckResult> {
  const now = new Date().toISOString();

  try {
    const { name, price, currency } = await fetchPrice(product.url);
    const changed =
      product.last_price !== price || product.currency !== currency;

    const statements = [
      env.DB.prepare(
        "UPDATE products SET name = COALESCE(?, name), currency = ?, last_price = ?, last_checked_at = ?, last_error = NULL WHERE id = ?",
      ).bind(name, currency, price, now, product.id),
    ];
    if (changed) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO price_history (product_id, price, currency, checked_at) VALUES (?, ?, ?, ?)",
        ).bind(product.id, price, currency, now),
      );
    }
    await env.DB.batch(statements);

    console.log(JSON.stringify({ id: product.id, price, currency, changed }));
    return { ok: true, name, price, currency };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await env.DB.prepare(
      "UPDATE products SET last_checked_at = ?, last_error = ? WHERE id = ?",
    )
      .bind(now, error, product.id)
      .run();

    console.log(JSON.stringify({ id: product.id, error }));
    return { ok: false, error };
  }
}

function redirectWithNotice(notice: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: `/?notice=${encodeURIComponent(notice)}` },
  });
}

// Fails closed: if ADMIN_TOKEN is not set, nobody gets in.
function isAuthorized(request: Request, env: Env): boolean {
  if (!env.ADMIN_TOKEN) return false;

  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;

  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;

  return constantTimeEqual(decoded.slice(separator + 1), env.ADMIN_TOKEN);
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}
