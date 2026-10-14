import { fetchPrice } from "./extract";
import { sendPriceAlert, type AlertConfig } from "./notify";
import {
  formatPrice,
  renderDetail,
  renderList,
  type HistoryView,
  type ProductView,
} from "./render";

export interface Env extends AlertConfig {
  DB: D1Database;
  // Password for the Basic-auth prompt. Set with `wrangler secret put ADMIN_TOKEN`.
  ADMIN_TOKEN: string;
}

type AlertOutcome =
  | { status: "not_needed" }
  | { status: "sent" }
  | { status: "failed"; error: string };

type CheckResult =
  | {
      ok: true;
      name: string | null;
      price: number;
      currency: string;
      alert: AlertOutcome;
    }
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
    const { pathname } = url;

    if (request.method === "GET" && pathname === "/") {
      return showList(env, url.searchParams.get("notice"));
    }
    if (request.method === "POST" && pathname === "/products") {
      return addProduct(request, env);
    }

    const productRoute = pathname.match(
      /^\/products\/(\d+)(\/target|\/delete)?$/,
    );
    if (productRoute) {
      const id = Number(productRoute[1]);
      const action = productRoute[2];
      if (request.method === "GET" && !action) {
        return showDetail(env, id, url.searchParams.get("notice"));
      }
      if (request.method === "POST" && action === "/target") {
        return setTarget(request, env, id);
      }
      if (request.method === "POST" && action === "/delete") {
        return removeProduct(env, id);
      }
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await checkAllProducts(env);
  },
} satisfies ExportedHandler<Env>;

async function showList(env: Env, notice: string | null): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM products ORDER BY id DESC",
  ).all<ProductView>();
  return html(renderList(notice, results));
}

async function showDetail(
  env: Env,
  id: number,
  notice: string | null,
): Promise<Response> {
  const product = await loadProduct(env, id);
  if (!product) {
    return new Response("Not found", { status: 404 });
  }

  const { results: history } = await env.DB.prepare(
    "SELECT price, currency, checked_at FROM price_history WHERE product_id = ? ORDER BY checked_at ASC, id ASC",
  )
    .bind(id)
    .all<HistoryView>();
  return html(renderDetail(notice, product, history));
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
    target_price: null,
    alerted_at: null,
  };
  const result = await checkProduct(env, product);
  if (!result.ok) {
    return redirectWithNotice(
      `Saved, but the first check failed: ${sentence(result.error)} It will be retried every hour.`,
    );
  }
  return redirectWithNotice(
    `Now tracking ${result.name ?? link.href}: ${formatPrice(result.price, result.currency)}`,
  );
}

async function setTarget(
  request: Request,
  env: Env,
  id: number,
): Promise<Response> {
  const product = await loadProduct(env, id);
  if (!product) {
    return new Response("Not found", { status: 404 });
  }

  const form = await request.formData();
  const raw = String(form.get("target") ?? "").trim();
  let target: number | null = null;
  if (raw !== "") {
    target = Number(raw);
    if (!Number.isFinite(target) || target <= 0) {
      return redirectWithNotice(
        "Enter a target price above 0, or leave it empty to clear the target.",
        `/products/${id}`,
      );
    }
  }

  await env.DB.prepare(
    "UPDATE products SET target_price = ?, alerted_at = NULL WHERE id = ?",
  )
    .bind(target, id)
    .run();
  if (target === null) {
    return redirectWithNotice("Target cleared.", `/products/${id}`);
  }

  // A new target starts a fresh alert cycle, so the current price is checked against it right away.
  const result = await checkProduct(env, {
    ...product,
    target_price: target,
    alerted_at: null,
  });
  return redirectWithNotice(targetNotice(result), `/products/${id}`);
}

function targetNotice(result: CheckResult): string {
  if (!result.ok) {
    return `Target saved, but the price check failed: ${sentence(result.error)}`;
  }
  if (result.alert.status === "sent") {
    return "Target saved. The price is already below it, so an alert email was sent.";
  }
  if (result.alert.status === "failed") {
    return `Target saved, but the alert email failed: ${sentence(result.alert.error)} It will be retried on the next check.`;
  }
  return `Target saved. Current price: ${formatPrice(result.price, result.currency)}.`;
}

// Ends a message with exactly one period, whether or not the error text already has one.
function sentence(text: string): string {
  return text.replace(/\.?$/, ".");
}

async function removeProduct(env: Env, id: number): Promise<Response> {
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

// Fetches the price, saves it, and sends an alert if the price is below the target.
// A history row is written only when the price or currency changes.
async function checkProduct(
  env: Env,
  product: ProductView,
): Promise<CheckResult> {
  const now = new Date().toISOString();

  try {
    const { name, price, currency } = await fetchPrice(product.url);
    const changed =
      product.last_price !== price || product.currency !== currency;
    const { alert, alertedAt } = await evaluateAlert(
      env,
      { ...product, name: name ?? product.name },
      price,
      currency,
      now,
    );

    const statements = [
      env.DB.prepare(
        "UPDATE products SET name = COALESCE(?, name), currency = ?, last_price = ?, last_checked_at = ?, last_error = NULL, alerted_at = ? WHERE id = ?",
      ).bind(name, currency, price, now, alertedAt, product.id),
    ];
    if (changed) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO price_history (product_id, price, currency, checked_at) VALUES (?, ?, ?, ?)",
        ).bind(product.id, price, currency, now),
      );
    }
    await env.DB.batch(statements);

    console.log(
      JSON.stringify({
        id: product.id,
        price,
        currency,
        changed,
        alert: alert.status,
      }),
    );
    return { ok: true, name, price, currency, alert };
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

// Emails once when the price drops below the target. The alert re-arms when the price
// goes back above the target. If the email fails, alerted_at stays empty and the next check retries.
async function evaluateAlert(
  env: Env,
  product: ProductView,
  price: number,
  currency: string,
  now: string,
): Promise<{ alert: AlertOutcome; alertedAt: string | null }> {
  if (product.target_price === null || price >= product.target_price) {
    return { alert: { status: "not_needed" }, alertedAt: null };
  }
  if (product.alerted_at) {
    return { alert: { status: "not_needed" }, alertedAt: product.alerted_at };
  }

  try {
    await sendPriceAlert(env, {
      name: product.name,
      url: product.url,
      price,
      currency,
      target: product.target_price,
    });
    return { alert: { status: "sent" }, alertedAt: now };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ id: product.id, alert_error: error }));
    return { alert: { status: "failed", error }, alertedAt: null };
  }
}

async function loadProduct(env: Env, id: number): Promise<ProductView | null> {
  return env.DB.prepare("SELECT * FROM products WHERE id = ?")
    .bind(id)
    .first<ProductView>();
}

function html(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function redirectWithNotice(notice: string, path = "/"): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: `${path}?notice=${encodeURIComponent(notice)}` },
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
