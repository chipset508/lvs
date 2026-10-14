// Reads a product's name and current price from a product page.
// Tries schema.org JSON-LD, then Next.js page data, then product meta tags.
// Regex and JSON.parse only, no DOM library, because the free plan gives each run 10 ms of CPU.

export interface PriceInfo {
  name: string | null;
  price: number;
  currency: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function fetchPrice(url: string): Promise<PriceInfo> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Page returned HTTP ${response.status}`);
  }

  const info = parsePriceFromHtml(await response.text(), url);
  if (!info) {
    throw new Error("No price found on the page");
  }
  return info;
}

export function parsePriceFromHtml(
  html: string,
  url: string,
): PriceInfo | null {
  return fromJsonLd(html) ?? fromNextData(html, url) ?? fromMeta(html);
}

function fromJsonLd(html: string): PriceInfo | null {
  for (const match of html.matchAll(
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    let data: unknown;
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }

    for (const node of walk(data)) {
      if (!isRecord(node) || !isProduct(node["@type"])) continue;
      const offer = firstRecord(node.offers);
      const info =
        offer &&
        toPriceInfo(
          offer.price ?? offer.lowPrice,
          offer.priceCurrency,
          node.name,
        );
      if (info) return info;
    }
  }
  return null;
}

// Decathlon embeds product data here. The product id is the number at the end of the URL,
// so related products on the same page are skipped.
function fromNextData(html: string, url: string): PriceInfo | null {
  const raw = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  )?.[1];
  if (!raw) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const productId = url.match(/-(\d+)\.html$/)?.[1];
  for (const node of walk(data)) {
    if (
      !isRecord(node) ||
      !isRecord(node.price) ||
      typeof node.name !== "string"
    )
      continue;
    const info = toPriceInfo(node.price.value, node.price.currency, node.name);
    if (info && (productId === undefined || String(node.modelId) === productId))
      return info;
  }
  return null;
}

function fromMeta(html: string): PriceInfo | null {
  const amount =
    metaContent(html, "product:price:amount") ??
    metaContent(html, "og:price:amount");
  const currency =
    metaContent(html, "product:price:currency") ??
    metaContent(html, "og:price:currency");
  return toPriceInfo(amount, currency, metaContent(html, "og:title"));
}

function metaContent(html: string, key: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!new RegExp(`(?:property|name)=["']${key}["']`, "i").test(tag))
      continue;
    const match = tag.match(/content="([^"]*)"|content='([^']*)'/i);
    const content = match?.[1] ?? match?.[2];
    if (content) return content;
  }
  return null;
}

function toPriceInfo(
  rawPrice: unknown,
  rawCurrency: unknown,
  rawName: unknown,
): PriceInfo | null {
  const price = typeof rawPrice === "number" ? rawPrice : Number(rawPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (typeof rawCurrency !== "string" || !/^[A-Z]{3}$/.test(rawCurrency))
    return null;

  const name =
    typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;
  return { name, price, currency: rawCurrency };
}

function isProduct(type: unknown): boolean {
  return (
    type === "Product" || (Array.isArray(type) && type.includes("Product"))
  );
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value.find(isRecord) : value;
  return isRecord(candidate) ? candidate : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function* walk(node: unknown): Generator<unknown> {
  yield node;
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child);
  } else if (isRecord(node)) {
    for (const child of Object.values(node)) yield* walk(child);
  }
}
