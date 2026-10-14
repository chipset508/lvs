# Price Tracker

Checks product links every hour on a Cloudflare Worker (Free plan) and keeps a price history in D1.

- `/` lists tracked products with their current price and history. Add a link with the form, remove one with its Remove button. The whole page is behind a Basic-auth password (`ADMIN_TOKEN`).
- The cron trigger (`0 * * * *`, UTC) fetches each link and writes a history row only when the price or currency changes.

## Local development

```sh
npm install
echo 'ADMIN_TOKEN=devtoken' > .dev.vars   # gitignored
npm run db:migrate:local
npm run dev                               # http://localhost:8787 (user: anything, password: devtoken)
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+*+*+*+*"   # run the hourly check now
```

## Deploy to Cloudflare Free

```sh
npx wrangler login
npx wrangler d1 create price-tracker      # copy the database_id into wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put ADMIN_TOKEN       # the password you will use to open the page
npm run deploy
```

## Things to know

- Price parsing reads schema.org JSON-LD, Next.js page data, or product meta tags. Decathlon Vietnam is tested. Other shops may need their own rules in `src/extract.ts`.
- Some shops block requests from Cloudflare's network. If a product shows an error, the page's "Last error" text says why.
- Times are shown in `Asia/Ho_Chi_Minh` (see `src/render.ts`).
