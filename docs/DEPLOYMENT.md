# Deployment, Search Console, Analytics and the online editor

Everything here is free. Steps marked **(parent/guardian)** involve accounts with age or payment requirements.

## 1. Its own GitHub repository (done)

The site lives in its own repository, `jneal6608-tech/neon-atlas` (moved out of `animation-studio/sites/neon-atlas/` on 2026-11-15 with its full history). Run every command from the repository root.

## 2. Choose a name and domain

`site.config.json` → `url` is `https://neonatlasguide.com`. Canonicals, the sitemap and Open Graph all use this value, so change it only if the domain changes. Also set `contactEmail` to a real inbox you check.

> Avoid "GTA", "Rockstar" or "Grand Theft Auto" in the domain name. It invites trademark complaints and can block AdSense approval.

## 3. Cloudflare (hosting)

The site runs as a free **Cloudflare Worker named `neonatlas`** that serves the built `dist/` folder (settings in `wrangler.jsonc`). It already exists and answers at neonatlasguide.com and neonatlas.jneal6608.workers.dev.

To make every push to `main` go live automatically (one-time, about 5 minutes):

1. Cloudflare dashboard → My Profile → API Tokens → **Create Token** → template **"Edit Cloudflare Workers"** → Continue → Create. Copy the token (it's shown once).
2. Cloudflare dashboard → Workers & Pages: copy your **Account ID** (right-hand sidebar).
3. GitHub → `jneal6608-tech/neon-atlas` → Settings → Secrets and variables → Actions → **New repository secret**: add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Actions tab → "Build and deploy" → **Run workflow** (or push to `main`). It builds, runs the checks and runs `wrangler deploy`. It also runs **daily at 05:17 UTC**, which publishes scheduled articles on their date. Until the two secrets exist, the deploy step is skipped, not failed.

**Or, with no token at all (simplest):** Workers & Pages → `neonatlas` → Settings → Builds → **Connect** → GitHub → `jneal6608-tech/neon-atlas`, branch `main`, build command `npm run build`, deploy command `npx wrangler deploy`. Cloudflare then deploys every change to `main` itself. Leave the two secrets unset: the workflow still checks every push, and once a day it commits the date to `data/daily-build.txt` so Cloudflare rebuilds and scheduled articles go live on their date.

Deploying by hand from a computer instead: `npm run build && npx wrangler deploy` (asks you to log in to Cloudflare the first time).

Custom domain: Workers & Pages → `neonatlas` → Settings → Domains & Routes.

## 4. Google Search Console

1. Go to https://search.google.com/search-console and **Add property → URL prefix** with your exact site URL.
2. Choose **HTML tag** verification. Copy only the `content="..."` value into `site.config.json` → `searchConsole.googleSiteVerification`, push, wait for the deploy, then press **Verify**.
3. Sitemaps → submit `sitemap.xml`.
4. URL Inspection → request indexing for the homepage and the top 5 guides (release time, pre-load, editions, physical copy, PC).
5. Weekly: Performance → Search results → last 7 days → Export → CSV. Unzip, then:

```bash
node tools/editorial.mjs gsc-import Queries.csv Pages.csv --range "Nov 19–25"
```

To automate this later, the Search Console API needs a Google Cloud service account added as a user on the property. That's a credential, so keep it in CI secrets and never in the site.

## 5. Google Analytics 4

1. https://analytics.google.com → create a property and a **Web** data stream for your URL.
2. Copy the **Measurement ID** (`G-XXXXXXX`) into `site.config.json` → `analytics.ga4MeasurementId` and push.
3. The site already sends: `page_view`, `search` (with `search_term`), `article_read` (reader reached the last quarter of an article), `source_click` and `contact_submit`. In GA4 → Admin → Events, mark `article_read` as a **key event**.
4. Admin → Product links → link Search Console to see queries inside GA4.
5. **Consent:** before turning on analytics or ads for visitors in the EEA, UK or Switzerland, add a Google-certified consent management platform (CMP). Google's own *Privacy & messaging* tool inside AdSense is free.

See [ANALYTICS.md](ANALYTICS.md) for the reports to check.

## 6. The editorial dashboard online

Locally, `npm run cms` + `npm run dev` → http://localhost:4321/admin/ works with no setup.

To edit from anywhere at `https://<your-site>/admin/`:

1. Deploy a free GitHub OAuth proxy for Decap, for example the open-source "decap-proxy" Cloudflare Worker (search GitHub for "decap cms cloudflare oauth worker"; check its licence and code before deploying).
2. Create a GitHub OAuth App (Settings → Developer settings → OAuth Apps) with the callback URL the proxy's README gives, and put its client ID/secret into the worker's secrets.
3. In `admin/config.yml` check `backend.repo` is `jneal6608-tech/neon-atlas` (already set) and set `backend.base_url` to the worker URL. Push.
4. Log in at `/admin/` with GitHub. Every save is a commit, and the deploy runs automatically.

## 7. Google AdSense (parent/guardian)

AdSense requires the account holder to be **18 or older**. A parent or guardian must create and own the account with their own details and payment information. Don't work around this. Full checklist: [MONETIZATION.md](MONETIZATION.md).

When approved: set `ads.enabled: true`, `ads.adsenseClient: "ca-pub-…"` and the two slot IDs in `site.config.json`. The build then adds the AdSense script, two well-spaced ad slots per article (never above the answer), and `ads.txt`.

## 8. AI tools (optional)

`node tools/editorial.mjs draft|outline --ai` uses Claude. Put an Anthropic API key in the `ANTHROPIC_API_KEY` environment variable on your own computer. It's never needed by the website and must never be committed or added to `site.config.json`. Using the API costs money per request, so check pricing first. A paid API account may need a parent or guardian.

## What still needs your accounts

| Item | Needs | Where it goes |
| --- | --- | --- |
| Live hosting | Cloudflare account + API token | GitHub Actions secrets |
| Own repository | GitHub repository | step 1 |
| Search Console | Google account, verification tag | `site.config.json` |
| Analytics | GA4 Measurement ID | `site.config.json` |
| Online editor | GitHub OAuth app + free worker | `admin/config.yml` |
| Ads | AdSense account **owned by a parent/guardian** | `site.config.json` |
| AI drafting | Anthropic API key | local environment variable only |
| Contact form backend (optional) | e.g. a free form service endpoint | `site.config.json` → `formEndpoint` (otherwise the form opens the visitor's email app) |
