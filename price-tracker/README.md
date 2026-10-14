# Price Tracker

Checks product links every hour on a Cloudflare Worker (Free plan), keeps a price history in D1, and emails you when a price drops below your target.

- `/` lists tracked products with their current price, target and last check. Add a link with the form, open a product to see it, or remove it.
- `/products/:id` is the detail page: the price timeline (each change against the previous price), the target price, and the alert status.
- The cron trigger (`0 * * * *`, UTC) fetches each link and writes a history row only when the price or currency changes.
- Alerts: when the price is below the target, you get one email. Another email is sent only after the price goes back above the target and drops below it again. Changing the target starts a new cycle and checks the price right away.
- The whole site is behind a Basic-auth password (`ADMIN_TOKEN`).

## Local development

```sh
npm install
echo 'ADMIN_TOKEN=devtoken' > .dev.vars   # gitignored
npm run db:migrate:local
npm run dev                               # http://localhost:8787 (user: anything, password: devtoken)
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+*+*+*+*"   # run the hourly check now
```

Without the email settings below, the target still works, but alert emails are skipped and retried on the next check.

## Email alerts with Resend

1. Create a Resend account and an API key with **Sending access**.
2. Set the three secrets. `RESEND_FROM` is the sender address. `NOTIFY_TO` is the address that receives alerts.

```sh
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM   # e.g. onboarding@resend.dev
npx wrangler secret put NOTIFY_TO
```

For local testing, the same values can go in `.dev.vars`. Resend's free plan allows 3,000 emails a month and 100 a day.

## Deploy to Cloudflare Free

```sh
npx wrangler login
npx wrangler d1 create price-tracker      # copy the database_id into wrangler.jsonc
npm run db:migrate:remote                 # applies every migration in migrations/
npx wrangler secret put ADMIN_TOKEN       # the password you will use to open the page
npm run deploy
```

Run `npm run db:migrate:remote` on an existing deployment too, because `0002_targets_and_alerts.sql` adds the target and alert columns.

## Things to know

- Price parsing reads schema.org JSON-LD, Next.js page data, or product meta tags. Decathlon Vietnam is tested. Other shops may need their own rules in `src/extract.ts`.
- Some shops block requests from Cloudflare's network. If a product shows an error, the detail page's error line says why.
- An email failure is not a product error. The alert is retried on the next check.
- Times are shown in `Asia/Ho_Chi_Minh` (see `src/render.ts`).
