# AuraFinance: setup & publishing guide

## What's where

| Path | What it is |
|---|---|
| `src/` | The web app (React + TypeScript + Tailwind) |
| `src/styles/colors.css` | **Every color in the app**: light and dark, and the color palettes. Change a value there to recolor the whole site |
| `src/styles/motion.css` | Animation timings. The speed setting in Settings › Appearance scales all of them |
| `src/lib/valuation.ts` | How assets, growth, goals and Zakat are calculated |
| `supabase/migrations/` | Database tables, security rules and money functions |
| `supabase/functions/` | Server functions: `market-refresh` (prices), `check-ticker`, `estimate-costs` (fills in a purchase's price from the market price on its date) and `price-on-date` (gold and exchange rates on a past day, e.g. the Nisab value when a Hawl started) |
| `supabase/seed.sql` | Local test data and test accounts (never runs on the live project) |
| `supabase/tests/`, `src/**/*.test.ts` | Database and logic tests |
| `e2e/` | Browser tests on phone, tablet and desktop sizes |

## Local development

Requirements: Node 22+, Docker Desktop (running).

```bash
npm install
npm run db:start     # local Supabase: applies migrations + seed data
npm run dev          # http://localhost:5173/personal-finance-dashboard/
npx supabase functions serve   # optional: live-reloads the server functions while you edit them
```

Test accounts for the local database are listed at the top of `supabase/seed.sql`. The demo account has data from the previous AuraFinance you can import from **Settings › Data**.

Development always talks to the **local** database (`.env.development`), never to your real data.

```bash
npm test             # logic + database tests (no Docker needed)
npm run test:e2e     # browser tests on phone/tablet/desktop (no Docker needed)
npm run typecheck && npm run lint
```

## Publishing

Do these in order. Steps 1–7 don't affect the site that's live now; it keeps working until step 8.

### 1. Close the two security issues in the live site (do this first)

```bash
npx supabase login
npx supabase functions delete aura-ai --project-ref lrjbqxyanqpakxuuvrfp
```

Then create a new GoldAPI.io key and revoke the old one, since the old one is in the git history.

### 2. Back up

Supabase dashboard → **Database → Backups**, or export the `dashboards` table to CSV.

### 3. Add the tables

```bash
npx supabase link --project-ref lrjbqxyanqpakxuuvrfp
npx supabase db push
```

This only **adds** tables and functions. The `dashboards` table with your current data isn't changed.

### 4. API keys for prices (server-side secrets)

```bash
npx supabase secrets set TWELVE_DATA_API_KEY=your-twelve-data-key GOLDAPI_IO_KEY=your-new-goldapi-key
```

### 5. Deploy the server functions

```bash
npx supabase functions deploy market-refresh
npx supabase functions deploy check-ticker
npx supabase functions deploy estimate-costs
npx supabase functions deploy price-on-date
```

### 6. Let the scheduler call the price function

In the Supabase **SQL editor**, run this with your project's service role key (Settings → API):

```sql
select vault.create_secret('https://lrjbqxyanqpakxuuvrfp.supabase.co', 'aurafinance_project_url');
select vault.create_secret('<service-role-key>', 'aurafinance_service_role_key');
```

Automations and the daily Zakat check need no setup. The app also catches them up every time it's opened.

### 7. Sign-in links

Supabase → **Authentication → URL Configuration**:
- Site URL: `https://qasem-ezzaldeen.github.io/personal-finance-dashboard/`
- Redirect URLs: add `https://qasem-ezzaldeen.github.io/personal-finance-dashboard/**`

### 8. Publish the site

```bash
git tag previous-site master
git push origin previous-site
git checkout master && git merge rebuild && git push
```

GitHub → repo **Settings → Pages → Source: GitHub Actions**. The workflow tests, builds and deploys.

To roll back at any time: set Pages back to "Deploy from a branch" on the `previous-site` tag.

### 9. Import your data

Sign in → **Settings › Data → Import from the previous AuraFinance**. Compare the preview with your current numbers, then import.

Afterwards, open **Assets** and set the real purchase date on each gold/stock "Opening balance". Its growth is then tracked from that day's market price, or from the price you enter.

### 10. Afterwards (optional)

Once your data is imported and everything looks right:
- drop the `dashboards` table in Supabase
- delete the import feature: `src/features/import/`, its card in `src/features/settings/DataTab.tsx`, `supabase/migrations/20261003000004_import_previous_version.sql` and `supabase/tests/import.test.ts`

## Shipping changes that touch the database

Pushing to `master` publishes the web app automatically, but database changes in `supabase/migrations/` are applied by hand. When a change adds a migration, apply it **before** the new app goes live, so the app never calls a table or function that doesn't exist yet:

```bash
npx supabase db push
```

Then merge to `master`. `npm test` runs every migration against an in-memory database first, so a migration that fails there will fail on Supabase too.
