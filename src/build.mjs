// Builds the whole site into dist/. Usage: node src/build.mjs   (PREVIEW=1 writes explicit index.html links
// so the output also works from a file server that has no directory indexes.)
import fs from "node:fs";
import path from "node:path";
import { Marked } from "marked";
import {
  ROOT, config, categories, loadArticles, loadPages, isLive, isScheduled, readJSON,
  CONFIDENCE, SOURCE_TYPES, wordCount, slugify,
} from "./content.mjs";

const PREVIEW = process.env.PREVIEW === "1";
const NOW = process.env.BUILD_DATE ? new Date(process.env.BUILD_DATE) : new Date();
const DIST = path.join(ROOT, "dist");
const cfg = config();
const CATS = categories();
const catBy = Object.fromEntries(CATS.map((c) => [c.slug, c]));
const ALL = loadArticles();
const LIVE = ALL.filter((a) => isLive(a, NOW)).sort((a, b) => b.updated.localeCompare(a.updated));
const liveBy = Object.fromEntries(LIVE.map((a) => [a.slug, a]));
const PAGES = loadPages();
const warnings = [];

// ---------- helpers ----------
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const abs = (p) => cfg.url.replace(/\/$/, "") + p;
const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

// Links: root-relative in production; relative with explicit index.html in preview builds.
function linker(fromUrl) {
  return (to) => {
    if (/^(https?:|mailto:|#)/.test(to)) return to;
    if (!PREVIEW) return to;
    const [p, hash = ""] = to.split("#");
    const fromDir = fromUrl.endsWith("/") ? fromUrl : path.posix.dirname(fromUrl) + "/";
    let rel = path.posix.relative(fromDir, p.endsWith("/") ? p + "index.html" : p);
    if (!rel) rel = "index.html";
    return rel + (hash ? "#" + hash : "");
  };
}

function write(urlPath, html) {
  const file = urlPath.endsWith("/") ? path.join(DIST, urlPath, "index.html") : path.join(DIST, urlPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

// ---------- markdown ----------
// Supports: internal links as [text](article:slug), callouts as "> [!CONFIRMED] ..." (CONFIRMED, REPORTED,
// UNCONFIRMED, PREDICTED, NOTE, TIP, WARNING), and gives every h2/h3 an id for the table of contents.
function renderMarkdown(md, fromUrl, ctxName) {
  const href = linker(fromUrl);
  const toc = [];
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        if (depth === 1) warnings.push(`${ctxName}: uses an h1 in the body (the title is the only h1)`);
        const plain = decode(text.replace(/<[^>]+>/g, ""));
        const id = slugify(plain);
        if (depth === 2 || depth === 3) toc.push({ depth, id, text: plain });
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      link({ href: h, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        if (h.startsWith("article:")) {
          const target = liveBy[h.slice(8)];
          if (!target) {
            const exists = ALL.find((a) => a.slug === h.slice(8));
            if (!exists) warnings.push(`${ctxName}: link to unknown article "${h.slice(8)}"`);
            return text; // target not published yet: plain text, no broken link
          }
          return `<a href="${esc(href(target.url))}">${text}</a>`;
        }
        if (h.startsWith("/")) return `<a href="${esc(href(h))}">${text}</a>`;
        const ext = /^https?:/.test(h);
        return `<a href="${esc(h)}"${title ? ` title="${esc(title)}"` : ""}${ext ? ' rel="noopener" class="ext"' : ""}>${text}</a>`;
      },
      image({ href: src, text }) {
        if (!text) warnings.push(`${ctxName}: image without alt text (${src})`);
        return `<img src="${esc(src)}" alt="${esc(text)}" loading="lazy" decoding="async">`;
      },
    },
  });
  let html = marked.parse(md).replace(/<table>/g, '<div class="table-wrap" tabindex="0" role="region" aria-label="Table (scrolls sideways on small screens)"><table>').replace(/<\/table>/g, "</table></div>");
  html = html.replace(/<blockquote>\s*<p>\[!(CONFIRMED|REPORTED|UNCONFIRMED|PREDICTED|NOTE|TIP|WARNING)\]\s*/g, (_, t) => {
    const k = t.toLowerCase();
    const label = { confirmed: "Confirmed", reported: "Reported, not confirmed by Rockstar", unconfirmed: "Unconfirmed", predicted: "Prediction", note: "Note", tip: "Tip", warning: "Heads up" }[k];
    return `<blockquote class="callout callout-${k}"><p class="callout-label">${label}</p><p>`;
  });
  return { html, toc };
}
// ---------- layout ----------
const NAV = [
  ["Guides", "/guides/"], ["Characters", "/characters/"], ["Locations", "/locations/"], ["Missions", "/missions/"],
  ["Vehicles", "/vehicles/"], ["Gameplay", "/gameplay/"], ["News", "/news/"], ["FAQ", "/faq/"],
];
const LOGO = `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M16 2 28 9v14l-12 7L4 23V9z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 8.5 21.5 22h-3l-1.2-3.2h-2.6L13.5 22h-3zm0 5.2-.9 2.7h1.8z" fill="currentColor"/></svg>`;

function layout({ url, title, description, body, jsonld = [], ogType = "website", noindex = false, image, bodyClass = "", published, modified }) {
  const href = linker(url);
  const canonical = abs(url);
  const fullTitle = url === "/" ? `${cfg.name}: ${cfg.tagline} (Unofficial)` : `${title} | ${cfg.name}`;
  const ogImage = abs(image || "/assets/og-default.png");
  const ga = cfg.analytics.ga4MeasurementId;
  const ads = cfg.ads.enabled && cfg.ads.adsenseClient;
  const nav = NAV.map(([n, u]) => `<li><a href="${href(u)}"${url.startsWith(u) ? ' aria-current="page"' : ""}>${n}</a></li>`).join("");
  return `<!doctype html>
<html lang="${cfg.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
${noindex ? '<meta name="robots" content="noindex, follow">' : '<meta name="robots" content="index, follow, max-image-preview:large">'}
<meta property="og:site_name" content="${esc(cfg.name)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImage}">
<meta property="og:locale" content="${cfg.locale}">
${published ? `<meta property="article:published_time" content="${published}">\n<meta property="article:modified_time" content="${modified}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0b0e13">
${cfg.searchConsole.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(cfg.searchConsole.googleSiteVerification)}">` : ""}
<link rel="icon" href="${href("/assets/favicon.svg")}" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.name)}" href="${href("/feed.xml")}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap">
<link rel="stylesheet" href="${href("/assets/styles.css")}">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
${ga ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(ga)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(ga)}');</script>` : ""}
${ads ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(cfg.ads.adsenseClient)}" crossorigin="anonymous"></script>` : ""}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="${href("/")}" aria-label="${esc(cfg.name)} home">${LOGO}<span class="brand-name">${esc(cfg.name)}</span><span class="brand-tag">Unofficial GTA VI guide</span></a>
    <button class="nav-toggle" aria-expanded="false" aria-controls="site-nav"><span class="sr">Menu</span><span class="bars" aria-hidden="true"></span></button>
    <nav id="site-nav" class="site-nav" aria-label="Main"><ul>${nav}</ul></nav>
    <form class="header-search" role="search" action="${href("/search/")}" method="get">
      <label class="sr" for="hq">Search the guide</label>
      <input id="hq" name="q" type="search" placeholder="Search the guide" autocomplete="off">
    </form>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <p class="brand footer-brand">${LOGO}<span class="brand-name">${esc(cfg.name)}</span></p>
      <p class="disclaimer"><strong>Unofficial fan resource.</strong> ${esc(cfg.name)} is an independent guide and is not affiliated with, endorsed by, or sponsored by Rockstar Games or Take-Two Interactive. Grand Theft Auto, GTA VI and related names are trademarks of their respective owners. All artwork on this site is original.</p>
    </div>
    <nav aria-label="Sections"><p class="foot-h">Sections</p><ul>${NAV.map(([n, u]) => `<li><a href="${href(u)}">${n}</a></li>`).join("")}</ul></nav>
    <nav aria-label="About"><p class="foot-h">About</p><ul>
      <li><a href="${href("/about/")}">About us</a></li><li><a href="${href("/editorial-standards/")}">Editorial standards</a></li>
      <li><a href="${href("/contact/")}">Contact &amp; corrections</a></li><li><a href="${href("/privacy/")}">Privacy policy</a></li>
      <li><a href="${href("/affiliate-disclosure/")}">Affiliate disclosure</a></li><li><a href="${href("/feed.xml")}">RSS feed</a></li>
    </ul></nav>
  </div>
  <div class="wrap foot-base"><p>&copy; ${NOW.getUTCFullYear()} ${esc(cfg.name)}. Facts are checked against official sources; see each page for its sources and last-verified date.</p></div>
</footer>
<script src="${href("/assets/site.js")}" defer></script>
</body>
</html>
`;
}

const badge = (conf) => `<span class="badge badge-${conf}" title="${esc(CONFIDENCE[conf].note)}">${CONFIDENCE[conf].label}</span>`;
const crumbs = (url, items) => {
  const href = linker(url);
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map(([n, u], i) => i === items.length - 1 ? `<li><span aria-current="page">${esc(n)}</span></li>` : `<li><a href="${href(u)}">${esc(n)}</a></li>`).join("")}</ol></nav>`;
};
const crumbLD = (items) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: abs(u) })) });
const adSlot = (name) => cfg.ads.enabled && cfg.ads.adsenseClient && cfg.ads.slots[name]
  ? `<aside class="ad-slot" aria-label="Advertisement"><p class="ad-label">Advertisement</p><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(cfg.ads.adsenseClient)}" data-ad-slot="${esc(cfg.ads.slots[name])}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></aside>`
  : "";

function card(a, fromUrl) {
  const href = linker(fromUrl);
  return `<article class="card"><p class="card-meta"><a class="card-cat" href="${href("/" + a.category + "/")}">${esc(catBy[a.category].name)}</a> ${badge(a.confidence)}</p>
<h3><a href="${href(a.url)}">${esc(a.title)}</a></h3><p>${esc(a.description)}</p><p class="card-date">Updated <time datetime="${a.updated}">${fmtDate(a.updated)}</time></p></article>`;
}

// ---------- article pages ----------
const searchIndex = [];
const faqAll = [];

for (const a of LIVE) {
  const { html, toc } = renderMarkdown(a.body, a.url, a.file);
  const href = linker(a.url);
  const words = wordCount(a.body);
  const mins = Math.max(1, Math.round(words / 230));
  const cat = catBy[a.category];
  const items = [["Home", "/"], [cat.name, `/${cat.slug}/`], [a.title, a.url]];
  const related = a.related.map((s) => liveBy[s]).filter(Boolean);
  for (const s of a.related) if (!ALL.find((x) => x.slug === s)) warnings.push(`${a.file}: related slug "${s}" does not exist`);
  const more = related.length < 3 ? LIVE.filter((x) => x.slug !== a.slug && !a.related.includes(x.slug) && x.category === a.category).slice(0, 3 - related.length) : [];
  const relatedAll = [...related, ...more];
  const tocHtml = toc.filter((t) => t.depth === 2).length >= 3
    ? `<nav class="toc" aria-label="On this page"><p class="toc-h">On this page</p><ol>${toc.filter((t) => t.depth === 2).map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join("")}</ol></nav>` : "";
  // put the first ad (if enabled) after the second paragraph-level block, never above the answer
  let bodyHtml = html;
  const slot = adSlot("inArticle");
  if (slot) { let n = 0; bodyHtml = bodyHtml.replace(/<\/p>\n/g, (m) => (++n === 3 ? m + slot : m)); }
  const sources = a.sources.map((s) => `<li><span class="src-type src-${esc(s.type || "reported")}">${esc(SOURCE_TYPES[s.type] || "Reported")}</span> <a href="${esc(s.url)}" rel="noopener" class="ext">${esc(s.title)}</a>${s.publisher ? ` <span class="muted">(${esc(s.publisher)})</span>` : ""}${s.accessed ? ` <span class="muted">accessed ${fmtDate(s.accessed)}</span>` : ""}</li>`).join("");
  const faqs = a.faqs.length ? `<section class="article-faq" aria-labelledby="faq-h"><h2 id="faq-h">Quick answers</h2>${a.faqs.map((f) => `<details><summary>${esc(f.q)}</summary><div>${new Marked().parseInline(f.a)}</div></details>`).join("")}</section>` : "";
  for (const f of a.faqs) faqAll.push({ ...f, article: a });
  const needsUpdate = a.status === "needs-updating" ? `<p class="callout callout-warning" role="note"><strong>Being updated.</strong> Some details on this page may be out of date; we're re-checking it now.</p>` : "";
  const log = a.updateLog.length ? `<details class="update-log"><summary>Update history</summary><ul>${a.updateLog.map((u) => `<li><time datetime="${u.date}">${fmtDate(u.date)}</time>: ${esc(u.note)}</li>`).join("")}</ul></details>` : "";
  const body = `<div class="wrap article-wrap">
${crumbs(a.url, items)}
<article class="article" data-slug="${a.slug}" data-category="${a.category}">
<header class="article-head">
  <p class="eyebrow"><a href="${href("/" + cat.slug + "/")}">${esc(cat.name)}</a> ${badge(a.confidence)}</p>
  <h1>${esc(a.title)}</h1>
  <p class="dek">${esc(a.description)}</p>
  <p class="byline">By ${esc(a.author)} · Updated <time datetime="${a.updated}">${fmtDate(a.updated)}</time> · Facts last verified <time datetime="${a.lastVerified}">${fmtDate(a.lastVerified)}</time> · ${mins} min read</p>
</header>
${needsUpdate}
${tocHtml}
<div class="prose">
${bodyHtml}
</div>
${faqs}
<section class="sources" aria-labelledby="src-h"><h2 id="src-h">Sources</h2>
<p class="muted small">Official = Rockstar Games or the platform holder. Reported = another outlet's reporting we could not check against an official page; it's labelled wherever it's used.</p>
<ol>${sources}</ol>${log}
<p class="small">Spotted an error? <a href="${href("/contact/")}">Send a correction</a>; we fix verified errors quickly and note them in the update history.</p></section>
${adSlot("articleEnd")}
</article>
${relatedAll.length ? `<aside class="related" aria-labelledby="rel-h"><h2 id="rel-h">Keep reading</h2><div class="grid cards">${relatedAll.map((r) => card(r, a.url)).join("")}</div></aside>` : ""}
</div>`;
  const ld = [
    {
      "@context": "https://schema.org", "@type": "Article", headline: a.title, description: a.description,
      datePublished: a.publishDate, dateModified: a.updated, author: { "@type": "Organization", name: cfg.name, url: abs("/about/") },
      publisher: { "@type": "Organization", name: cfg.name, logo: { "@type": "ImageObject", url: abs("/assets/logo-512.png") } },
      mainEntityOfPage: abs(a.url), image: abs(a.image || "/assets/og-default.png"), isAccessibleForFree: true,
      about: { "@type": "VideoGame", name: "Grand Theft Auto VI" },
    },
    crumbLD(items),
  ];
  write(a.url, layout({ url: a.url, title: a.seoTitle, description: a.description, body, jsonld: ld, ogType: "article", image: a.image, bodyClass: "page-article", published: a.publishDate, modified: a.updated }));
  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  searchIndex.push({ t: a.title, d: a.description, u: a.url, c: cat.name, k: a.confidence, h: toc.map((t) => t.text).join(" · "), b: plain.slice(0, 1800), q: a.faqs.map((f) => f.q).join(" ") });
}

// ---------- category pages ----------
for (const c of CATS) {
  const url = `/${c.slug}/`;
  const list = LIVE.filter((a) => a.category === c.slug);
  const items = [["Home", "/"], [c.name, url]];
  const upcoming = c.upcoming.length ? `<section class="upcoming" aria-labelledby="up-h"><h2 id="up-h">Planned coverage</h2><p class="muted">These pages will go up once we can verify them in the game or from official sources. We don't publish guesses.</p><ul>${c.upcoming.map((u) => `<li>${esc(u)}</li>`).join("")}</ul></section>` : "";
  const body = `<div class="wrap">${crumbs(url, items)}<header class="page-head"><h1>${esc(c.name)}</h1><p class="dek">${esc(c.description)}</p></header>
${list.length ? `<h2 class="section-h">All ${esc(c.name.toLowerCase())} pages</h2><div class="grid cards">${list.map((a) => card(a, url)).join("")}</div>` : `<p class="empty">Nothing published here yet. GTA VI launches ${fmtDate(cfg.launchDate)}; pages in this section need in-game verification first.</p>`}
${upcoming}</div>`;
  // empty category pages are kept out of the index until they have real content
  write(url, layout({ url, title: `GTA 6 ${c.name}`, description: c.description, body, jsonld: [crumbLD(items)], noindex: list.length === 0 }));
}

// ---------- home ----------
{
  const url = "/";
  const href = linker(url);
  const featured = LIVE.filter((a) => a.featured).slice(0, 6);
  const latest = LIVE.slice(0, 6);
  const catCounts = CATS.map((c) => ({ ...c, n: LIVE.filter((a) => a.category === c.slug).length }));
  const body = `<section class="hero"><div class="wrap hero-inner">
  <p class="eyebrow">Independent &amp; unofficial · Sourced and verified</p>
  <h1>Straight answers for <span class="hl">GTA VI</span>, checked against official sources.</h1>
  <p class="dek">Release times, pre-loading, editions, characters and the map, with every claim labelled <strong>confirmed</strong>, <strong>reported</strong> or <strong>unconfirmed</strong>. Walkthroughs follow once we've played them.</p>
  <form class="hero-search" role="search" action="${href("/search/")}" method="get"><label class="sr" for="q-hero">Search</label><input id="q-hero" name="q" type="search" placeholder="Try “pre-load”, “Ultimate Edition”, “Lucia”"><button type="submit">Search</button></form>
  <div class="countdown" data-launch="${cfg.launchDate}" aria-live="polite"><span class="cd-label">Launch</span> <strong class="cd-date">${fmtDate(cfg.launchDate)}</strong> <span class="cd-left"></span></div>
</div></section>
<div class="wrap">
<section aria-labelledby="start-h"><h2 id="start-h" class="section-h">Start here</h2><div class="grid cards">${featured.map((a) => card(a, url)).join("")}</div></section>
<section class="legend" aria-labelledby="legend-h"><h2 id="legend-h" class="section-h">How to read our labels</h2><ul class="legend-list">${Object.entries(CONFIDENCE).map(([k, v]) => `<li>${badge(k)} <span>${esc(v.note)}</span></li>`).join("")}</ul><p class="small"><a href="${href("/editorial-standards/")}">Read our editorial standards</a></p></section>
<section aria-labelledby="cat-h"><h2 id="cat-h" class="section-h">Browse the guide</h2><div class="grid cats">${catCounts.map((c) => `<a class="cat-tile" href="${href("/" + c.slug + "/")}"><span class="cat-name">${esc(c.name)}</span><span class="cat-n">${c.n ? `${c.n} ${c.n === 1 ? "page" : "pages"}` : "After launch"}</span></a>`).join("")}</div></section>
<section aria-labelledby="latest-h"><h2 id="latest-h" class="section-h">Recently updated</h2><div class="grid cards">${latest.map((a) => card(a, url)).join("")}</div></section>
</div>`;
  const ld = [
    { "@context": "https://schema.org", "@type": "WebSite", name: cfg.name, url: abs("/"), description: `${cfg.tagline}. Unofficial and independent.`, inLanguage: cfg.language },
    { "@context": "https://schema.org", "@type": "Organization", name: cfg.name, url: abs("/"), logo: abs("/assets/logo-512.png") },
  ];
  write(url, layout({ url, title: `${cfg.name}: ${cfg.tagline}`, description: "Independent GTA VI guide: release time, pre-load size, editions, characters and map, with every claim labelled confirmed or unconfirmed and linked to its source.", body, jsonld: ld, bodyClass: "page-home" }));
}

// ---------- FAQ ----------
{
  const url = "/faq/";
  const href = linker(url);
  const extra = readJSON("data/faq.json").items; // site-level FAQs managed in the CMS
  const groups = {};
  for (const f of [...extra.map((e) => ({ ...e, article: liveBy[e.article] })), ...faqAll]) {
    if (!f.article) continue;
    (groups[f.article.category] ||= []).push(f);
  }
  const items = [["Home", "/"], ["FAQ", url]];
  const body = `<div class="wrap narrow">${crumbs(url, items)}<header class="page-head"><h1>GTA VI FAQ</h1><p class="dek">Short, sourced answers to the questions people ask most. Each links to the full guide with sources.</p></header>
${CATS.filter((c) => groups[c.slug]).map((c) => `<section aria-labelledby="fq-${c.slug}"><h2 id="fq-${c.slug}">${esc(c.name)}</h2>${groups[c.slug].map((f) => `<details><summary>${esc(f.q)}</summary><div>${new Marked().parseInline(f.a)} <a href="${href(f.article.url)}">Full answer &amp; sources →</a></div></details>`).join("")}</section>`).join("")}</div>`;
  write(url, layout({ url, title: "GTA 6 FAQ: Quick, Sourced Answers", description: "Quick answers to the most-asked GTA VI questions (release time, pre-load, editions, PC, physical copies), each linked to a sourced guide.", body, jsonld: [crumbLD(items)] }));
  for (const f of faqAll) searchIndex.push({ t: f.q, d: f.a.replace(/[*_`\[\]]/g, "").replace(/\(article:[^)]+\)/g, ""), u: f.article.url, c: "FAQ", k: f.article.confidence, h: "", b: "", q: "" });
}

// ---------- search ----------
{
  const url = "/search/";
  const items = [["Home", "/"], ["Search", url]];
  const body = `<div class="wrap narrow">${crumbs(url, items)}<header class="page-head"><h1>Search</h1></header>
<form class="search-page-form" role="search" action="" method="get"><label for="sq">Search the guide</label><div class="row"><input id="sq" name="q" type="search" autocomplete="off" placeholder="e.g. pre-load size"><button type="submit">Search</button></div></form>
<p id="search-status" class="muted" role="status" aria-live="polite"></p><ol id="search-results" class="search-results"></ol>
<noscript><p>Search needs JavaScript. Browse the <a href="${linker(url)("/guides/")}">guides</a> instead.</p></noscript></div>`;
  write(url, layout({ url, title: "Search", description: "Search the Neon Atlas GTA VI guide.", body, noindex: true, bodyClass: "page-search" }));
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, "search-index.json"), JSON.stringify(searchIndex));
}

// ---------- static pages ----------
for (const p of PAGES) {
  const { html } = renderMarkdown(p.body.replaceAll("{{contactEmail}}", cfg.contactEmail).replaceAll("{{siteName}}", cfg.name), p.url, p.slug);
  const items = [["Home", "/"], [p.title, p.url]];
  const form = p.slug === "contact" ? contactForm() : "";
  const body = `<div class="wrap narrow">${crumbs(p.url, items)}<header class="page-head"><h1>${esc(p.title)}</h1>${p.updated ? `<p class="byline">Last updated <time datetime="${p.updated}">${fmtDate(p.updated)}</time></p>` : ""}</header><div class="prose">${html}</div>${form}</div>`;
  write(p.url, layout({ url: p.url, title: p.title, description: p.description, body, jsonld: [crumbLD(items)], noindex: p.noindex }));
}
function contactForm() {
  return `<form class="contact-form" id="contact-form" data-endpoint="${esc(cfg.formEndpoint)}" data-email="${esc(cfg.contactEmail)}" method="post" ${cfg.formEndpoint ? `action="${esc(cfg.formEndpoint)}"` : ""} novalidate>
<div class="field"><label for="cf-name">Name <span class="muted">(optional)</span></label><input id="cf-name" name="name" autocomplete="name"></div>
<div class="field"><label for="cf-email">Email <span class="muted">(only if you'd like a reply)</span></label><input id="cf-email" name="email" type="email" autocomplete="email"></div>
<div class="field"><label for="cf-topic">Topic</label><select id="cf-topic" name="topic"><option>Correction</option><option>Question about GTA VI</option><option>Tip or discovery</option><option>Business or partnership</option><option>Other</option></select></div>
<div class="field"><label for="cf-page">Page this is about <span class="muted">(optional)</span></label><input id="cf-page" name="page" type="url" placeholder="https://"></div>
<div class="field"><label for="cf-msg">Message</label><textarea id="cf-msg" name="message" rows="6" required minlength="10"></textarea></div>
<p class="hp" aria-hidden="true"><label>Leave empty <input name="website" tabindex="-1" autocomplete="off"></label></p>
<button type="submit">Send</button><p class="form-status" role="status" aria-live="polite"></p></form>`;
}

// ---------- 404 ----------
write("/404.html", layout({ url: "/404.html", title: "Page not found", description: "This page doesn't exist or hasn't been published yet. Search the Neon Atlas GTA VI guide or start from the homepage.", noindex: true,
  body: `<div class="wrap narrow"><header class="page-head"><h1>Page not found</h1><p class="dek">That page doesn't exist, or it hasn't been published yet.</p></header><p><a href="${linker("/404.html")("/")}">Go to the homepage</a> or <a href="${linker("/404.html")("/search/")}">search the guide</a>.</p></div>` }));

// ---------- sitemap, robots, feed, headers ----------
{
  const indexable = [
    { u: "/", m: LIVE[0]?.updated },
    ...CATS.filter((c) => LIVE.some((a) => a.category === c.slug)).map((c) => ({ u: `/${c.slug}/`, m: LIVE.filter((a) => a.category === c.slug)[0].updated })),
    { u: "/faq/", m: LIVE[0]?.updated },
    ...LIVE.map((a) => ({ u: a.url, m: a.updated })),
    ...PAGES.filter((p) => !p.noindex).map((p) => ({ u: p.url, m: p.updated })),
  ];
  fs.writeFileSync(path.join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map((x) => `  <url><loc>${abs(x.u)}</loc>${x.m ? `<lastmod>${x.m}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`);
  fs.writeFileSync(path.join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /search/\nDisallow: /admin/\n\nSitemap: ${abs("/sitemap.xml")}\n`);
  const feedItems = LIVE.slice(0, 30).map((a) => `<item><title>${esc(a.title)}</title><link>${abs(a.url)}</link><guid>${abs(a.url)}</guid><pubDate>${new Date(a.updated + "T12:00:00Z").toUTCString()}</pubDate><description>${esc(a.description)}</description></item>`).join("");
  fs.writeFileSync(path.join(DIST, "feed.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(cfg.name)}</title><link>${abs("/")}</link><description>${esc(cfg.tagline)}</description><language>${cfg.language}</language>${feedItems}</channel></rss>\n`);
  // Cloudflare Pages headers: security + caching
  fs.writeFileSync(path.join(DIST, "_headers"), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
/assets/*
  Cache-Control: public, max-age=604800
/admin/*
  X-Robots-Tag: noindex
`);
  if (cfg.ads.enabled && cfg.ads.adsenseClient) fs.writeFileSync(path.join(DIST, "ads.txt"), `google.com, ${cfg.ads.adsenseClient.replace("ca-", "")}, DIRECT, f08c47fec0942fa0\n`);
}

// ---------- assets + admin ----------
fs.cpSync(path.join(ROOT, "assets"), path.join(DIST, "assets"), { recursive: true });
fs.cpSync(path.join(ROOT, "admin"), path.join(DIST, "admin"), { recursive: true });

// ---------- summary ----------
const scheduled = ALL.filter((a) => isScheduled(a, NOW));
const hidden = ALL.filter((a) => !isLive(a, NOW) && !isScheduled(a, NOW));
console.log(`Built ${LIVE.length} live articles, ${CATS.length} sections, ${PAGES.length} pages -> dist/${PREVIEW ? " (preview links)" : ""}`);
if (scheduled.length) console.log(`Scheduled: ${scheduled.map((a) => `${a.slug} (${a.publishDate})`).join(", ")}`);
if (hidden.length) console.log(`Not public (in the editorial pipeline): ${hidden.map((a) => `${a.slug} [${a.status}]`).join(", ")}`);
if (warnings.length) { console.log("\nWARNINGS:"); for (const w of warnings) console.log(" - " + w); if (process.env.STRICT === "1") process.exit(1); }
