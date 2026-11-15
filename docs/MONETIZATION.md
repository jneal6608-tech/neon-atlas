# Monetisation readiness

Monetisation stays secondary to usefulness. Ads are **off** by default (`site.config.json` → `ads.enabled: false`).

## Account ownership: important

Google AdSense requires the account holder to be **at least 18**. Because the site owner is under 18, a **parent or guardian must apply for, own and manage the AdSense account** with their own identity and payment details. Don't use false information or anyone else's account without their involvement. The same applies to affiliate programmes, which generally require an adult account holder.

## AdSense readiness checklist

- [x] Original, useful content with a clear purpose (13 sourced guides today, growing)
- [x] About, Contact, Privacy policy (covers cookies, Google ads and opt-out links), Editorial standards, Affiliate disclosure
- [x] Clear navigation, working search, mobile-friendly, no broken links
- [x] No copied content, no Rockstar artwork, an unofficial disclaimer on every page
- [x] `ads.txt` generated automatically once a publisher ID is set
- [ ] Custom domain (recommended; approval on a `*.pages.dev` subdomain isn't guaranteed)
- [ ] Enough depth: aim for 30+ substantial pages and a few weeks of real traffic before applying
- [ ] Consent management (Google's free CMP in AdSense → Privacy & messaging) for EEA/UK/Swiss visitors
- [ ] Parent/guardian AdSense account created and the site added under Sites
- [ ] Policy check: AdSense doesn't allow ads next to some mature content. GTA guides are generally fine, but avoid gratuitous violent or sexual imagery and explicit detail, and keep the age-rating page factual.

Approval is never guaranteed; Google decides.

## Ad placement plan (built in)

When enabled, the build adds at most **two** responsive slots per article:

1. After the third paragraph, **below** the direct answer, so the answer is never pushed down.
2. After the sources section, at the end of the article.

No ads on the homepage, section pages, search, contact or legal pages at first. No pop-ups, interstitials, sticky ads or auto-playing video. Each slot is labelled "Advertisement". Review Core Web Vitals after enabling ads.

## Affiliate links

Currently none. If added: disclose them at the top of the page, use `rel="sponsored"`, recommend only products you've actually assessed (for example, storage expansion in the pre-load guide), and never write fake reviews. The disclosure page already sets these rules.

## Sponsorships

Only clearly labelled sponsored content that matches the editorial standards; never paid coverage presented as independent.

## Revenue: assumptions, not promises

No projection is given because there's no traffic data yet. When there is, estimate revenue as:

`monthly pageviews ÷ 1000 × page RPM`

Use **your own** RPM from AdSense once ads run. Gaming RPMs vary widely by country, season and ad settings, and a new site's early traffic is unpredictable. Re-estimate monthly from real Search Console and AdSense numbers.
