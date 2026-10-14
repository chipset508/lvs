# Price Tracker

Checks product links every four hours on a Cloudflare Worker (Free plan), keeps a price history in D1, and emails you when a price drops below your target.

- `/` lists tracked products with their current price, target, picture and last check. Add a link with the form, open a product to see it, or remove it. The first price check also saves a target 15% below that price.
- `/products/:id` is the detail page: the price timeline (each change against the previous price), the target price, and the alert status.
- The cron trigger (`0 */4 * * *`, UTC: 00, 04, 08, 12, 16 and 20 hours) fetches each link and writes a history row only when the price or currency changes.
- Alerts: when the price is below the target, one email goes to the default address (`NOTIFY_TO`). Another email is sent only after the price goes back above the target and drops below it again. Changing the target starts a new cycle and checks the price right away. Per-product alert addresses are hidden (`PER_PRODUCT_ALERT_EMAIL` in `src/render.ts`) until a domain is verified in Resend.
- The whole site is behind a Basic-auth password (`ADMIN_TOKEN`).

## Local development

```sh
npm install
echo 'ADMIN_TOKEN=devtoken' > .dev.vars   # gitignored
npm run db:migrate:local
npm run dev                               # http://localhost:8787 (user: anything, password: devtoken)
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+*+*+*+*"   # run the scheduled check now
```

Without the email settings below, the target still works, but alert emails are skipped and retried on the next check.

## Email alerts with Resend

1. Create a Resend account and an API key with **Sending access**.
2. Set the three secrets. `RESEND_FROM` is the sender address. `NOTIFY_TO` is the default address that receives alerts.

```sh
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM   # e.g. onboarding@resend.dev
npx wrangler secret put NOTIFY_TO
```

For local testing, the same values can go in `.dev.vars`. Resend's free plan allows 3,000 emails a month and 100 a day.

Without a verified domain, Resend only delivers to the email address on your Resend account. Other alert addresses get an HTTP 403, which the detail page shows. Verify a domain in Resend to send to any address.

## Deploy to Cloudflare Free

```sh
npx wrangler login
npx wrangler d1 create price-tracker      # copy the database_id into wrangler.jsonc
npm run db:migrate:remote                 # applies every migration in migrations/
npx wrangler secret put ADMIN_TOKEN       # the password you will use to open the page
npm run deploy
```

Run `npm run db:migrate:remote` on an existing deployment too, because `0002_targets_and_alerts.sql` adds the target and alert columns, `0003_alert_email.sql` adds the per-product alert email, and `0004_product_image.sql` adds the picture URL.

## Things to know

- Price parsing reads schema.org JSON-LD, Next.js page data, or product meta tags. Decathlon Vietnam is tested. Other shops may need their own rules in `src/extract.ts`.
- Some shops block requests from Cloudflare's network. If a product shows an error, the detail page's error line says why.
- An email failure is not a product error. The alert is retried on the next check.
- Times are shown in `Asia/Ho_Chi_Minh` (see `src/render.ts`).
