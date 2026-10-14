// Sends price-drop alerts through Resend's Emails API.
import { formatPrice } from "./render";

export interface AlertConfig {
  // Resend API key with "Sending access".
  RESEND_API_KEY?: string;
  // Sender address. onboarding@resend.dev works without a domain, if Resend allows it for your account.
  RESEND_FROM?: string;
  // Address that receives the alerts.
  NOTIFY_TO?: string;
}

export interface PriceAlert {
  name: string | null;
  url: string;
  price: number;
  currency: string;
  target: number;
}

const RESEND_URL = "https://api.resend.com/emails";

export async function sendPriceAlert(
  config: AlertConfig,
  alert: PriceAlert,
): Promise<void> {
  const apiKey = config.RESEND_API_KEY;
  const from = config.RESEND_FROM;
  const to = config.NOTIFY_TO;
  if (!apiKey || !from || !to) {
    throw new Error(
      "Email is not configured: set RESEND_API_KEY, RESEND_FROM and NOTIFY_TO",
    );
  }

  const name = alert.name ?? alert.url;
  const current = formatPrice(alert.price, alert.currency);
  const target = formatPrice(alert.target, alert.currency);

  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Price drop: ${name} is now ${current}`,
      text: `${name}\n\nCurrent price: ${current}\nYour target: ${target}\n\n${alert.url}\n`,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Resend returned HTTP ${response.status}: ${detail.slice(0, 200)}`,
    );
  }
}
