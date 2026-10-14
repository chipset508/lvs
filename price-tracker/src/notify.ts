// Sends price-drop alerts through SendGrid's v3 Mail Send API.
import { formatPrice } from "./render";

export interface AlertConfig {
  // SendGrid API key with the "Mail Send" permission.
  SENDGRID_API_KEY?: string;
  // Sender address. It must be verified in SendGrid.
  SENDGRID_FROM?: string;
  // Address that receives the alerts.
  NOTIFY_TO?: string;
  // Only for local testing against a mock server.
  SENDGRID_API_URL?: string;
}

export interface PriceAlert {
  name: string | null;
  url: string;
  price: number;
  currency: string;
  target: number;
}

const SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send";

export async function sendPriceAlert(
  config: AlertConfig,
  alert: PriceAlert,
): Promise<void> {
  const apiKey = config.SENDGRID_API_KEY;
  const from = config.SENDGRID_FROM;
  const to = config.NOTIFY_TO;
  if (!apiKey || !from || !to) {
    throw new Error(
      "Email is not configured: set SENDGRID_API_KEY, SENDGRID_FROM and NOTIFY_TO",
    );
  }

  const name = alert.name ?? alert.url;
  const current = formatPrice(alert.price, alert.currency);
  const target = formatPrice(alert.target, alert.currency);

  const response = await fetch(config.SENDGRID_API_URL ?? SENDGRID_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject: `Price drop: ${name} is now ${current}`,
      content: [
        {
          type: "text/plain",
          value: `${name}\n\nCurrent price: ${current}\nYour target: ${target}\n\n${alert.url}\n`,
        },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `SendGrid returned HTTP ${response.status}: ${detail.slice(0, 200)}`,
    );
  }
}
