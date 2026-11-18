// Builds the whole site into dist/. Usage: node src/build.mjs   (PREVIEW=1 writes explicit index.html links
// so the output also works from a file server that has no directory indexes.)
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
// Image lookup: an official Rockstar image (assets/official/art, from data/official-art.json via tools/import-official.mjs,
// or the official region/character pictures) wins over the original artwork in assets/art.
const ART = (name) => (fs.existsSync(path.join(ROOT, `assets/official/art/${name}.jpg`)) ? `/assets/official/art/${name}.jpg` : null)
  || (name.startsWith("region-") && OFFICIAL("regions", name.slice(7))) || (name.startsWith("char-") && OFFICIAL("characters", name.slice(5)))
  || (fs.existsSync(path.join(ROOT, `assets/art/${name}.jpg`)) ? `/assets/art/${name}.jpg` : null);
const IS_OFFICIAL = (p) => !!p && p.startsWith("/assets/official/");
const fmtDateTime = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
const modOf = (a) => a.updatedAt || a.updated;
const fmtMod = (a) => (a.updatedAt ? fmtDateTime(a.updatedAt) : fmtDate(a.updated));
const LIVEFEED = (() => { try { return readJSON("data/live.json").entries.slice().sort((x, y) => String(y.time).localeCompare(String(x.time))); } catch { return []; } })();
const LIVE_URL = "/news/gta-6-launch-live/";
const THEORIES_URL = "/theories/";
const THEORIES = (() => { try { return readJSON("data/theories.json"); } catch { return { updated: "", items: [] }; } })();
// When the site last changed, shown on the home page ("Last updated ..."). It moves on its own whenever the site is
// updated: the newest commit that changed content/, data/ or assets/ (not the daily rebuild nudge or the official-page
// watcher's snapshot, which change nothing a reader sees), or the newest date in the content itself, whichever is later.
// SITE_UPDATED=<ISO date> overrides it (for tests).
const SITE_UPDATED = (() => {
  if (process.env.SITE_UPDATED) return process.env.SITE_UPDATED;
  let lastCommit = null;
  try {
    lastCommit = execFileSync("git", ["log", "-1", "--format=%cI", "--", "content", "data", "assets",
      ":(exclude)data/watch-state.json", ":(exclude)data/daily-build.txt"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch { /* not a git checkout: fall back to the dates in the content */ }
  const stamp = (d) => (String(d).length > 10 ? Date.parse(d) : Date.parse(d + "T12:00:00Z"));
  const dates = [lastCommit, LIVEFEED[0]?.time, THEORIES.updated, ...LIVE.map((a) => a.updatedAt || a.updated)]
    .filter((d) => d && !Number.isNaN(stamp(d)) && stamp(d) <= NOW.getTime() + 60_000);
  return dates.sort((a, b) => stamp(b) - stamp(a))[0] || null;
})();
const THEORY_STATUS = {
  open: ["Open", "Unproven either way."],
  likely: ["Looking likely", "The evidence is stacking up, but Rockstar hasn't confirmed it."],
  "long-shot": ["Long shot", "Fun to think about, but the evidence is thin."],
  confirmed: ["Confirmed", "Rockstar or the game has proven it true."],
  debunked: ["Debunked", "Rockstar or the game has proven it false."],
};
const THEORY_TREND = { rising: "Trending", steady: "", cooling: "Cooling off" };
const fmtLiveTime = (t) => (String(t).length > 10 ? fmtDateTime(t) : fmtDate(t));
const OFFICIAL = (kind, slug) => (fs.existsSync(path.join(ROOT, `assets/official/${kind}/${slug}.jpg`)) ? `/assets/official/${kind}/${slug}.jpg` : null);
// Cache-busting: /assets/* is cached for a week, so CSS and JS are linked with a fingerprint of their contents.
// Any change gets a new URL that browsers and Cloudflare must fetch; unchanged files stay cached.
const ver = (p) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, p))).digest("hex").slice(0, 10);
const ASSET_V = { css: ver("assets/styles.css"), js: ver("assets/site.js") };
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

// Typographer's quotes: straight " and ' in visible text become curly quotes and apostrophes. Tags, attributes,
// <script>, <style>, <code>, <pre> and form fields are left untouched, so links, JSON-LD and code are unaffected.
function smartQuotes(html) {
  let skip = 0, prev = " ";
  return html.split(/(<[^>]+>)/).map((part) => {
    if (part.startsWith("<")) {
      const m = part.match(/^<(\/?)(script|style|code|pre|textarea|title)\b/i);
      if (m) skip += m[1] ? -1 : 1;
      if (/^<\/?(p|li|h[1-6]|td|th|div|section|figcaption|summary|br|dt|dd|blockquote)\b/i.test(part)) prev = " ";
      return part;
    }
    if (skip > 0 || !part) return part;
    const out = part.replace(/&quot;|&#39;|"|'/g, (q, i, str) => {
      const before = i === 0 ? prev : decode(str.slice(Math.max(0, i - 6), i)).slice(-1) || prev;
      const open = /[\s(\[{\u2014\u2013\/-]/.test(before) || before === "";
      return q === '"' || q === "&quot;" ? (open ? "\u201c" : "\u201d") : (open ? "\u2018" : "\u2019");
    });
    prev = decode(part).slice(-1);
    return out;
  }).join("");
}

function write(urlPath, html) {
  const file = urlPath.endsWith("/") ? path.join(DIST, urlPath, "index.html") : path.join(DIST, urlPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, file.endsWith(".html") ? smartQuotes(html) : html);
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
  ["Live", LIVE_URL], ["Theories", THEORIES_URL], ["Guides", "/guides/"], ["Characters", "/characters/"], ["Locations", "/locations/"], ["Missions", "/missions/"],
  ["Vehicles", "/vehicles/"], ["Gameplay", "/gameplay/"], ["News", "/news/"], ["FAQ", "/faq/"],
];
const LOGO = `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M16 2 28 9v14l-12 7L4 23V9z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 8.5 21.5 22h-3l-1.2-3.2h-2.6L13.5 22h-3zm0 5.2-.9 2.7h1.8z" fill="currentColor"/></svg>`;

function layout({ url, title, description, body, jsonld = [], ogType = "website", noindex = false, image, imageAlt, bodyClass = "", published, modified, pageTitle }) {
  const href = linker(url);
  const canonical = abs(url);
  const fullTitle = pageTitle || `${title} | ${cfg.name}`;
  const ogImage = abs(image || "/assets/og-default.jpg");
  const ga = cfg.analytics.ga4MeasurementId;
  const gtm = /^GTM-[A-Z0-9]+$/.test(cfg.analytics.gtmContainerId || "") ? cfg.analytics.gtmContainerId : "";
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
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(imageAlt || title)}">
<meta property="og:locale" content="${cfg.locale}">
${published ? `<meta property="article:published_time" content="${published}">\n<meta property="article:modified_time" content="${modified}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ogImage}">
<meta name="theme-color" content="#12061f">
${cfg.searchConsole.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(cfg.searchConsole.googleSiteVerification)}">` : ""}
<link rel="icon" href="${href("/assets/favicon.svg")}" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.name)}" href="${href("/feed.xml")}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700;800&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700;800&display=swap" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700;800&display=swap"></noscript>
<link rel="stylesheet" href="${href("/assets/styles.css")}?v=${ASSET_V.css}">
${url === "/" && ART("home-hero") ? `<link rel="preload" as="image" href="${href(ART("home-hero"))}" fetchpriority="high">` : ""}
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
${gtm ? `<!-- Google Tag Manager -->
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');</script>` : ""}
${ga ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(ga)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(ga)}');</script>` : ""}
${ads ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(cfg.ads.adsenseClient)}" crossorigin="anonymous"></script>` : ""}
</head>
<body class="${bodyClass}">
${gtm ? `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${gtm}" height="0" width="0" style="display:none;visibility:hidden" title="Google Tag Manager"></iframe></noscript>` : ""}
<a class="skip" href="#main">Skip to content</a>
<div class="progress" aria-hidden="true"><span></span></div>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="${href("/")}" aria-label="${esc(cfg.name)} home">${LOGO}<span class="brand-name">${esc(cfg.name)}</span><span class="brand-tag">Unofficial GTA VI guide</span></a>
    <button class="nav-toggle" aria-expanded="false" aria-controls="site-nav"><span class="sr">Menu</span><span class="bars" aria-hidden="true"></span></button>
    <nav id="site-nav" class="site-nav" aria-label="Main"><ul>${nav}</ul></nav>
    <form class="header-search" role="search" action="${href("/search/")}" method="get">
      <label class="sr" for="hq">Search the guide</label>
      <input id="hq" name="q" type="search" placeholder="Search" autocomplete="off">
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
      <p class="disclaimer"><strong>Unofficial fan resource.</strong> ${esc(cfg.name)} is an independent guide and is not affiliated with, endorsed by, or sponsored by Rockstar Games or Take-Two Interactive. Grand Theft Auto, GTA VI and related names are trademarks of their respective owners. Artwork is original unless credited; official images are © Rockstar Games and used for editorial coverage.</p>
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
<script src="${href("/assets/site.js")}?v=${ASSET_V.js}" defer></script>
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
  const img = ART(`${a.slug}-card`);
  return `<article class="card">${img ? `<img class="card-img" src="${href(img)}" alt="" width="800" height="450" loading="lazy" decoding="async">` : ""}<div class="card-body"><p class="card-meta"><a class="card-cat" href="${href("/" + a.category + "/")}">${esc(catBy[a.category].name)}</a> ${badge(a.confidence)}</p>
<h3><a href="${href(a.url)}">${esc(a.title)}</a></h3><p>${esc(a.description)}</p><p class="card-date">Updated <time datetime="${a.updated}">${fmtDate(a.updated)}</time></p></div></article>`;
}

// Fan-theory card: status, the theory, evidence for/against, the community vote (filled in by site.js from /api/votes)
// and where fans are discussing it. compact = homepage strip.
const theoryImg = (t) => (t.image ? ART(`${t.image}-card`) || ART(t.image) : null);
const theoryMeta = (t) => {
  const [statusLabel, statusNote] = THEORY_STATUS[t.status] || THEORY_STATUS.open;
  return `<p class="theory-meta">${badge("theory")} <span class="t-status t-${t.status}" title="${esc(statusNote)}">${statusLabel}</span>${THEORY_TREND[t.trend] ? ` <span class="t-trend t-${t.trend}">${THEORY_TREND[t.trend]}</span>` : ""}${t.spoiler ? ' <span class="t-spoiler">Story spoilers</span>' : ""}</p>`;
};
const theoryVote = (t) => {
  const settled = t.status === "confirmed" || t.status === "debunked";
  return `<div class="vote" data-theory="${esc(t.id)}"${settled ? ' data-settled="true"' : ""}>${settled ? "" : `<p class="vote-q">What do you think?</p><div class="vote-btns"><button type="button" class="vote-btn vote-yes" data-choice="yes" aria-pressed="false">Believe it</button><button type="button" class="vote-btn vote-no" data-choice="no" aria-pressed="false">Doubt it</button></div>`}<div class="vote-bar" hidden><span></span></div><p class="vote-result" role="status" aria-live="polite">${settled ? "Voting is closed." : "No votes yet. Be the first to call it."}</p></div>`;
};
const theoryFigure = (t, fromUrl, cls) => {
  const img = theoryImg(t);
  return img ? `<figure class="${cls}"><img src="${linker(fromUrl)(img)}" alt="${esc(t.imageAlt || "")}" width="800" height="450" loading="lazy" decoding="async">${IS_OFFICIAL(img) ? `<figcaption class="credit">Image: Rockstar Games</figcaption>` : ""}</figure>` : "";
};

// Full theory card for /theories/: picture, status, the theory, evidence for/against, the community vote
// (filled in by site.js from /api/votes) and where fans are discussing it.
function theoryCard(t, fromUrl) {
  const list = (items) => `<ul>${items.map((x) => `<li>${new Marked().parseInline(esc(x))}</li>`).join("")}</ul>`;
  return `<article class="theory theory-${t.status}" id="${esc(t.id)}">
${theoryFigure(t, fromUrl, "theory-img")}
<div class="theory-body">
${theoryMeta(t)}
<h2 class="theory-title">${esc(t.title)}</h2>
<p class="theory-sum">${esc(t.summary)}</p>
<div class="theory-evidence"><div class="ev ev-for"><p class="ev-h">What fans point to</p>${list(t.for)}</div><div class="ev ev-against"><p class="ev-h">The case against</p>${list(t.against)}</div></div>
${theoryVote(t)}
<p class="theory-src">Where fans are talking about it: ${t.sources.map((s) => `<a href="${esc(s.url)}" rel="noopener" class="ext">${esc(s.publisher)}</a>`).join(", ")} · Updated <time datetime="${esc(t.updated)}">${fmtDate(t.updated)}</time></p>
</div>
</article>`;
}

// Image-led theory "break" mixed into the homepage and into articles as you scroll: picture, the theory, a quick
// vote and a link to the evidence on /theories/.
function theoryFeature(t, fromUrl, H = "h3") {
  const href = linker(fromUrl);
  return `<aside class="theory-feature theory-${t.status}" aria-label="Fan theory: ${esc(t.title)}">
${theoryFigure(t, fromUrl, "tf-img")}
<div class="tf-body">
<p class="tf-kicker">Fan theory break</p>
${theoryMeta(t)}
<${H} class="theory-title"><a href="${href(THEORIES_URL)}#${esc(t.id)}">${esc(t.title)}</a></${H}>
<p class="theory-sum">${esc(t.summary)}</p>
${theoryVote(t)}
<p class="tf-more"><a href="${href(THEORIES_URL)}#${esc(t.id)}">See the evidence for and against →</a></p>
</div>
</aside>`;
}
// Which theory to show inside an article: one tied to that article, else the hottest one.
const THEORY_OPEN = THEORIES.items.filter((t) => t.status !== "debunked");
const theoryFor = (slug) => THEORY_OPEN.find((t) => (t.related || []).includes(slug)) || THEORY_OPEN[0];

// ---------- shortcodes: {{name}} or {{name:arg|label}} on their own line in Markdown ----------
const REGIONS = [["vice-city", "Vice City", "Glamour, hustle and greed: Ocean Beach, Little Cuba, VC Port."], ["leonida-keys", "Leonida Keys", "A tropical archipelago next to beautiful, dangerous waters."], ["grassrivers", "Grassrivers", "A primordial expanse of mangroves, gators and worse."], ["port-gellhorn", "Port Gellhorn", "A faded vacation town with cheap motels and a new economy."], ["ambrosia", "Ambrosia", "Sugar-refinery industry town run by a biker gang."], ["mount-kalaga", "Mount Kalaga", "Hunting, fishing and off-road trails by the northern border."]];
const PEOPLE = [["jason-duval", "Jason Duval", "Ex-Army, works for Keys drug runners"], ["lucia-caminos", "Lucia Caminos", "Fresh out of Leonida Penitentiary"], ["cal-hampton", "Cal Hampton", "Jason's paranoid friend"], ["boobie-ike", "Boobie Ike", "Vice City legend and businessman"], ["dre-quan-priest", "Dre'Quan Priest", "Only Raw Records"], ["real-dimez", "Real Dimez", "Rap duo Bae-Luxe and Roxy"], ["raul-bautista", "Raul Bautista", "Seasoned bank robber"], ["brian-heder", "Brian Heder", "Old-school Keys smuggler"]];
function countdownHtml(compact = false) {
  return `<div class="countdown" data-launch="${cfg.launchDate}"><span class="cd-label">GTA VI unlocks in</span><div class="cd-units" aria-live="off"><div class="cd-unit"><b data-u="d">--</b><small>days</small></div><div class="cd-unit"><b data-u="h">--</b><small>hrs</small></div><div class="cd-unit"><b data-u="m">--</b><small>min</small></div>${compact ? "" : `<div class="cd-unit"><b data-u="s">--</b><small>sec</small></div>`}</div><span class="cd-note">Until midnight on Nov 19, your local time (reported unlock time).</span></div>`;
}
// Who made a YouTube video: Rockstar's own trailers ({{video}}) or our own gameplay ({{ourvideo}}), never mixed up.
const VIDEO_CREDITS = {
  rockstar: { aria: "official Rockstar Games video on YouTube", text: "Official Rockstar Games video on YouTube." },
  ours: { aria: "Neon Atlas gameplay video on YouTube", text: "Our own gameplay, recorded by Neon Atlas. GTA VI is a Rockstar Games title; this is an unofficial fan video." },
};
function video(id, label, fromUrl, credit = "rockstar") {
  const who = VIDEO_CREDITS[credit];
  const href = linker(fromUrl);
  const fallback = ART("gta-6-trailers-card") || ART("home-hero");
  // A real link to the video: plays inline on the site (site.js), and opens YouTube wherever embedding is blocked.
  return `<div class="yt" data-id="${esc(id)}"><a class="yt-play" href="https://www.youtube.com/watch?v=${esc(id)}" target="_blank" rel="noopener" aria-label="Play ${esc(label)}, ${who.aria}"><img src="https://i.ytimg.com/vi/${esc(id)}/maxresdefault.jpg" data-alt-src="https://i.ytimg.com/vi/${esc(id)}/hqdefault.jpg" data-fallback="${fallback ? href(fallback) : ""}" alt="" loading="lazy" width="1280" height="720"><span class="yt-btn" aria-hidden="true"></span><span class="yt-title">${esc(label)}</span></a><p class="yt-credit">${who.text} <a href="https://www.youtube.com/watch?v=${esc(id)}" rel="noopener" target="_blank" class="ext">Open on YouTube</a></p></div>`;
}
// Videos Rockstar hosts only in its own player (no YouTube upload we could verify): the poster links to Rockstar's page.
function rockstarVideo(url, label, img, fromUrl) {
  const href = linker(fromUrl);
  return `<div class="yt yt-rockstar"><a class="yt-play" href="${esc(url)}" target="_blank" rel="noopener" aria-label="Play ${esc(label)}, official Rockstar Games video (opens Rockstar's site)"><img src="${href(img)}" alt="" loading="lazy" width="1280" height="720"><span class="yt-btn" aria-hidden="true"></span><span class="yt-title">${esc(label)}</span></a><p class="yt-credit">Official Rockstar Games video. Plays on Rockstar's site. <a href="${esc(url)}" rel="noopener" target="_blank" class="ext">Watch on rockstargames.com</a></p></div>`;
}
const LAUNCH_TRAILER = ["https://www.rockstargames.com/VI/launch-trailer", "Launch Trailer", "/assets/official/art/video-launch-trailer.jpg"];
function shortcodes(html, fromUrl) {
  const href = linker(fromUrl);
  return html.replace(/<p>\{\{([a-z-]+)(?::([^}|]*))?(?:\|([^}]*))?\}\}<\/p>/g, (m, name, arg, label) => {
    switch (name) {
      case "video": return video(arg, label || "Watch the trailer", fromUrl);
      case "ourvideo": return video(arg, label || "Watch our gameplay", fromUrl, "ours");
      case "launchtrailer": return rockstarVideo(...LAUNCH_TRAILER, fromUrl);
      case "videos": return `<div class="video-row">${rockstarVideo(...LAUNCH_TRAILER, fromUrl)}${[["QdBZY2fkU-0", "Trailer 1"], ["VQRLujxTm3c", "Trailer 2"], ["tJbzMqJGH4k", "An Extended Look"]].map(([i, l]) => video(i, l, fromUrl)).join("")}</div>`;
      case "countdown": return countdownHtml();
      case "regions": return `<div class="gallery">${REGIONS.map(([s, n, d]) => { const off = OFFICIAL("regions", s); return `<figure><img src="${href(off || ART("region-" + s))}" alt="${off ? `${n} in GTA VI` : `Original illustration of ${n}`}" width="960" height="540" loading="lazy"><figcaption><strong>${n}</strong>${esc(d)}${off ? `<span class="credit">Image: Rockstar Games</span>` : ""}</figcaption></figure>`; }).join("")}</div>`;
      case "characters": return `<div class="gallery people">${PEOPLE.map(([s, n, d]) => { const off = OFFICIAL("characters", s); return `<a href="${liveBy["gta-6-characters"] ? href(liveBy["gta-6-characters"].url) : ""}#${slugify(n)}"><figure><img src="${href(off || ART("char-" + s))}" alt="${off ? `${esc(n)} in GTA VI` : `Original poster-style card for ${esc(n)}`}" width="600" height="750" loading="lazy"><figcaption><strong>${esc(n)}</strong>${esc(d)}${off ? `<span class="credit">Image: Rockstar Games</span>` : ""}</figcaption></figure></a>`; }).join("")}</div>`;
      case "storage": return `<div class="widget" data-widget="storage"><p class="widget-h">Will GTA 6 fit on your console?</p><p>Check your free space (PS5: Settings → Storage; Xbox: Settings → System → Storage devices) and enter it below.</p><div class="row"><div><label for="w-free">Free space (GB)</label><input id="w-free" type="number" min="0" max="8000" inputmode="numeric" placeholder="e.g. 180"></div><div><label for="w-console">Console</label><select id="w-console"><option value="ps5">PS5 / PS5 Pro</option><option value="xsx">Xbox Series X</option><option value="xss">Xbox Series S</option></select></div><div style="flex:0 0 auto"><button type="button" data-act="check">Check</button></div></div><div class="widget-out" role="status" aria-live="polite"></div></div>`;
      case "unlock": return `<div class="widget" data-widget="unlock" data-launch="${cfg.launchDate}"><p class="widget-h">When does it unlock where you live?</p><p>Pick your time zone. We show both reported scenarios, because Rockstar's exact per-region times aren't on a page we could verify.</p><div class="row"><div><label for="w-tz">Your time zone</label><select id="w-tz"></select></div></div><div class="widget-out" role="status" aria-live="polite"></div></div>`;
      case "edition": return `<div class="widget" data-widget="edition"><p class="widget-h">Standard or Ultimate? Answer 3 questions</p><div class="quiz-box"></div><div class="widget-out" role="status" aria-live="polite"></div></div>`;
      case "quiz": return `<div class="widget" data-widget="quiz" data-imgs="${esc(JSON.stringify(Object.fromEntries(PEOPLE.map(([s]) => [s, href(OFFICIAL("characters", s) || ART("char-" + s))]))))}"><p class="widget-h">Which GTA 6 character are you?</p><p>Six quick questions. Results are based on Rockstar's official character profiles. Just for fun.</p><div class="quiz-box"></div><div class="widget-out" role="status" aria-live="polite"></div></div>`;
      default: warnings.push(`unknown shortcode {{${name}}} in ${fromUrl}`); return m;
    }
  });
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
  let bodyHtml = shortcodes(html, a.url);
  const tf = THEORY_OPEN.length ? theoryFeature(theoryFor(a.slug), a.url) : "";
  if (tf) { let n = 0; const before = bodyHtml; bodyHtml = bodyHtml.replace(/<h2 /g, (m) => (++n === 3 ? tf + "\n" + m : m)); if (bodyHtml === before) bodyHtml += "\n" + tf; }
  const slot = adSlot("inArticle");
  if (slot) { let n = 0; bodyHtml = bodyHtml.replace(/<\/p>\n/g, (m) => (++n === 3 ? m + slot : m)); }
  const sources = a.sources.map((s) => `<li><span class="src-type src-${esc(s.type || "reported")}">${esc(SOURCE_TYPES[s.type] || "Reported")}</span> <a href="${esc(s.url)}" rel="noopener" class="ext">${esc(s.title)}</a>${s.publisher ? ` <span class="muted">(${esc(s.publisher)})</span>` : ""}${s.accessed ? ` <span class="muted">accessed ${fmtDate(s.accessed)}</span>` : ""}</li>`).join("");
  const faqs = a.faqs.length ? `<section class="article-faq" aria-labelledby="faq-h"><h2 id="faq-h">Quick answers</h2>${a.faqs.map((f) => `<details><summary>${esc(f.q)}</summary><div>${new Marked().parseInline(f.a)}</div></details>`).join("")}</section>` : "";
  for (const f of a.faqs) faqAll.push({ ...f, article: a });
  const needsUpdate = a.status === "needs-updating" ? `<p class="callout callout-warning" role="note"><strong>Being updated.</strong> Some details on this page may be out of date; we're re-checking it now.</p>` : "";
  const log = a.updateLog.length ? `<details class="update-log"><summary>Update history</summary><ul>${a.updateLog.map((u) => `<li><time datetime="${u.date}">${fmtDate(u.date)}</time>: ${esc(u.note)}</li>`).join("")}</ul></details>` : "";
  const hero = ART(a.slug);
  if (!hero) warnings.push(`${a.file}: no artwork yet. Run: node tools/make-art.mjs ${a.slug}`);
  const next = relatedAll[0];
  const popular = LIVE.filter((x) => x.featured && x.slug !== a.slug && x !== next).slice(0, 5);
  const sidebar = `<aside class="sidebar" aria-label="More from Neon Atlas">
<div class="side-box"><p class="side-h grad">Popular right now</p><div class="grid cards compact">${popular.map((p) => card(p, a.url)).join("")}</div></div>
${adSlot("sidebar")}
<div class="side-box"><p class="side-h">Launch countdown</p>${countdownHtml(true)}</div>
</aside>`;
  const body = `<div class="wrap">
${crumbs(a.url, items)}
<div class="article-layout">
<article class="article" data-slug="${a.slug}" data-category="${a.category}">
<header class="article-head">
  <p class="eyebrow"><a href="${href("/" + cat.slug + "/")}">${esc(cat.name)}</a> ${badge(a.confidence)}</p>
  <h1>${esc(a.title)}</h1>
  <p class="dek">${esc(a.description)}</p>
  <p class="byline">By ${esc(a.author)} · Updated <time datetime="${modOf(a)}">${fmtMod(a)}</time> · Facts last verified <time datetime="${a.lastVerified}">${fmtDate(a.lastVerified)}</time> · ${mins} min read</p>
</header>
${a.answer ? `<section class="quick-answer" aria-labelledby="qa-${a.slug}"><p class="qa-label" id="qa-${a.slug}">Quick answer <span>Updated ${fmtMod(a)}</span></p><p class="qa-text">${new Marked().parseInline(a.answer)}</p></section>` : ""}
${hero ? `<figure class="article-hero"><img src="${href(hero)}" alt="${IS_OFFICIAL(hero) ? `Official GTA VI image for ${esc(a.title)}` : `Original Vice City-style illustration for ${esc(a.title)}`}" width="1600" height="900" fetchpriority="high" decoding="async"><figcaption>${IS_OFFICIAL(hero) ? "Image: Rockstar Games (official GTA VI media)." : "Original illustration by Neon Atlas. Not official Rockstar artwork."}</figcaption></figure>` : ""}
${needsUpdate}
${tocHtml}
<div class="prose">
${bodyHtml}
</div>
${faqs}
<section class="sources" aria-labelledby="src-h"><h2 id="src-h">Sources</h2>
<p class="muted small">Official = Rockstar Games or the platform holder. Reported = another outlet's reporting we could not check against an official page; it's labeled wherever it's used.</p>
<ol>${sources}</ol>${log}
<p class="small">Spotted an error? <a href="${href("/contact/")}">Send a correction</a>; we fix verified errors quickly and note them in the update history.</p></section>
${adSlot("articleEnd")}
${next ? `<aside class="up-next" aria-label="Up next">${ART(`${next.slug}-card`) ? `<img src="${href(ART(`${next.slug}-card`))}" alt="" width="800" height="450" loading="lazy">` : ""}<div><p class="label">Up next</p><a href="${href(next.url)}">${esc(next.title)}</a><p>${esc(next.description)}</p></div></aside>` : ""}
</article>
${sidebar}
</div>
${relatedAll.length > 1 ? `<aside class="related" aria-labelledby="rel-h"><h2 id="rel-h" class="section-h">Keep reading</h2><div class="grid cards">${relatedAll.slice(1).concat(LIVE.filter((x) => x.featured && x.slug !== a.slug && !relatedAll.includes(x))).slice(0, 6).map((r) => card(r, a.url)).join("")}</div></aside>` : ""}
</div>`;
  const ld = [
    {
      "@context": "https://schema.org", "@type": "Article", headline: a.title, description: a.description,
      datePublished: a.publishDate, dateModified: modOf(a), author: { "@type": "Organization", name: cfg.name, url: abs("/about/") },
      publisher: { "@type": "Organization", name: cfg.name, logo: { "@type": "ImageObject", url: abs("/assets/logo-512.png") } },
      mainEntityOfPage: abs(a.url), image: [abs(ART(a.slug) || a.image || "/assets/og-default.jpg"), ...(ART(`${a.slug}-share`) ? [abs(ART(`${a.slug}-share`))] : [])], isAccessibleForFree: true,
      articleSection: cat.name, wordCount: words, inLanguage: cfg.language,
      about: { "@type": "VideoGame", name: "Grand Theft Auto VI" },
    },
    crumbLD(items),
    ...(a.faqs.length ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: a.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: decode(new Marked().parseInline(f.a).replace(/<[^>]+>/g, "")) } })) }] : []),
  ];
  write(a.url, layout({ url: a.url, title: a.seoTitle, description: a.description, body, jsonld: ld, ogType: "article", image: ART(`${a.slug}-share`) || a.image, imageAlt: a.title, bodyClass: "page-article", published: a.publishDate, modified: modOf(a) }));
  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  searchIndex.push({ t: a.title, d: a.answer ? a.answer.replace(/[*_`]/g, "") : a.description, u: a.url, c: cat.name, k: a.confidence, h: toc.map((t) => t.text).join(" · "), b: plain.slice(0, 1800), q: a.faqs.map((f) => f.q).join(" ") });
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
  write(url, layout({ url, title: `GTA 6 ${c.name}`, description: c.description, body, jsonld: [crumbLD(items), ...(list.length ? [{ "@context": "https://schema.org", "@type": "CollectionPage", name: `GTA 6 ${c.name}`, url: abs(url), description: c.description, mainEntity: { "@type": "ItemList", itemListElement: list.map((a, i) => ({ "@type": "ListItem", position: i + 1, url: abs(a.url), name: a.title })) } }] : [])], noindex: list.length === 0 }));
}

// ---------- home ----------
{
  const url = "/";
  const href = linker(url);
  const featured = LIVE.filter((a) => a.featured).slice(0, 6);
  const latest = LIVE.slice(0, 6);
  const catCounts = CATS.map((c) => ({ ...c, n: LIVE.filter((a) => a.category === c.slug).length }));
  const catArt = { guides: "gta-6-pre-load-guide-card", characters: "char-lucia-caminos", locations: "region-leonida-keys", missions: "region-grassrivers", vehicles: "gta-6-vehicles-named-so-far-card", gameplay: "region-port-gellhorn", news: "gta-6-launch-week-everything-confirmed-card" };
  // fan theories mixed in between sections as you scroll (hottest first, debunked ones stay on /theories/)
  const tBreak = (i) => (THEORY_OPEN[i] ? theoryFeature(THEORY_OPEN[i], url) : "");
  const trailers = liveBy["gta-6-trailers"], quiz = liveBy["gta-6-character-quiz"], map = liveBy["gta-6-map-leonida-regions"], chars = liveBy["gta-6-characters"];
  const body = `<section class="hero">${ART("home-hero") ? `<img class="hero-art" src="${href(ART("home-hero"))}" alt="" width="2000" height="900" fetchpriority="high">${IS_OFFICIAL(ART("home-hero")) ? `<span class="hero-credit">Image: Rockstar Games</span>` : ""}` : ""}<div class="wrap hero-inner"><div class="hero-copy">
  <p class="hero-tags"><span class="eyebrow">Unofficial GTA 6 guide · Sourced &amp; verified</span><a class="fresh-pill" href="#fresh-h"><span class="live-dot" aria-hidden="true"></span> Updated daily</a></p>
  <h1>Every GTA 6 answer, <span class="grad">checked</span> before you read it.</h1>
  <p class="dek">Unlock times, pre-load size, editions, characters and the map of Leonida. Every claim is labeled <strong>confirmed</strong>, <strong>reported</strong> or <strong>unconfirmed</strong>. Walkthroughs arrive as we play.</p>
  <form class="hero-search" role="search" action="${href("/search/")}" method="get"><label class="sr" for="q-hero">Search</label><input id="q-hero" name="q" type="search" placeholder="Try “pre-load size”, “Ultimate Edition”, “Lucia”"><button type="submit">Search</button></form>
  ${countdownHtml()}
</div></div></section>
<div class="wrap">
${LIVEFEED.length ? `<section class="live-strip" aria-labelledby="ls-h"><p class="live-strip-h" id="ls-h"><span class="live-dot" aria-hidden="true"></span> Live launch updates</p><ol>${LIVEFEED.slice(0, 3).map((e) => `<li><time datetime="${e.time}">${fmtLiveTime(e.time)}</time> ${new Marked().parseInline(e.text)}</li>`).join("")}</ol><a class="btn btn-ghost" href="${href(LIVE_URL)}">All live updates →</a></section>` : ""}
<section class="fresh" aria-labelledby="fresh-h">
  <div class="fresh-head"><p class="fresh-kicker"><span class="live-dot" aria-hidden="true"></span> Always current</p><h2 id="fresh-h">Updated daily</h2><p>GTA VI news moves fast in launch week. Neon Atlas is updated every day, so the unlock times, pre-load details, patches and server status you read here are the latest we've verified.</p></div>
  <ol class="fresh-steps">
    <li><b>Every day<span class="sr">:</span></b> <span>We check Rockstar's official GTA VI pages, Newswire and support site for anything new or changed.</span></li>
    <li><b>Verified first<span class="sr">:</span></b> <span>New details are checked and labeled <strong>confirmed</strong>, <strong>reported</strong> or <strong>unconfirmed</strong> before they go live.</span></li>
    <li><b>Timestamped<span class="sr">:</span></b> <span>Every page shows when it was last updated and last verified, so you always know how fresh it is.</span></li>
  </ol>
  ${SITE_UPDATED ? `<p class="fresh-last">Last updated: <time datetime="${SITE_UPDATED}">${fmtLiveTime(SITE_UPDATED)}</time>${LIVEFEED.length ? ` · <a href="${href(LIVE_URL)}">Follow the live updates →</a>` : ""}</p>` : ""}
</section>
<section aria-labelledby="start-h"><h2 id="start-h" class="section-h">Start here</h2><div class="grid cards">${featured.map((a) => card(a, url)).join("")}</div></section>
${tBreak(0)}
${trailers ? `<section aria-labelledby="tr-h"><h2 id="tr-h" class="section-h">Watch the official trailers</h2><p class="section-sub">All four of Rockstar's GTA VI videos in one place, newest first, with what each one confirmed.</p>${shortcodes("<p>{{videos}}</p>", url)}<p><a class="btn btn-ghost" href="${href(trailers.url)}">Every trailer, explained →</a></p></section>` : ""}
${tBreak(1)}
${map ? `<section aria-labelledby="map-h"><h2 id="map-h" class="section-h">Explore Leonida</h2><p class="section-sub">The six regions Rockstar has officially named.</p>${shortcodes("<p>{{regions}}</p>", url)}<p><a class="btn btn-ghost" href="${href(map.url)}">The full map guide →</a></p></section>` : ""}
${tBreak(2)}
${quiz ? `<section class="band" aria-labelledby="quiz-h">${ART("gta-6-character-quiz-card") ? `<img src="${href(ART("gta-6-character-quiz-card"))}" alt="" width="800" height="450" loading="lazy">` : ""}<div class="band-copy"><h2 id="quiz-h">Which GTA 6 character are you?</h2><p>Six questions, eight official characters. Find out if you're a Jason, a Lucia or a Boobie Ike.</p><a class="btn" href="${href(quiz.url)}">Take the quiz</a></div></section>` : ""}
${chars ? `<section aria-labelledby="ch-h"><h2 id="ch-h" class="section-h">Meet the cast</h2>${shortcodes("<p>{{characters}}</p>", chars.url).replaceAll('href="#', `href="${href(chars.url)}#`)}</section>` : ""}
${tBreak(3)}
<section aria-labelledby="cat-h"><h2 id="cat-h" class="section-h">Browse the guide</h2><div class="grid cats">${catCounts.map((c) => `<a class="cat-tile" href="${href("/" + c.slug + "/")}">${ART(catArt[c.slug]) ? `<img src="${href(ART(catArt[c.slug]))}" alt="" loading="lazy" width="800" height="450">` : ""}<span class="cat-name">${esc(c.name)}</span><span class="cat-n">${c.n ? `${c.n} ${c.n === 1 ? "page" : "pages"}` : "Coming after launch"}</span></a>`).join("")}</div></section>
${tBreak(4)}
<section aria-labelledby="latest-h"><h2 id="latest-h" class="section-h">Recently updated</h2><div class="grid cards">${latest.map((a) => card(a, url)).join("")}</div></section>
<section class="legend" aria-labelledby="legend-h"><h2 id="legend-h" class="section-h">How to read our labels</h2><ul class="legend-list">${Object.entries(CONFIDENCE).map(([k, v]) => `<li>${badge(k)} <span>${esc(v.note)}</span></li>`).join("")}</ul><p class="small"><a href="${href("/editorial-standards/")}">Read our editorial standards</a></p></section>
</div>`;
  const ld = [
    { "@context": "https://schema.org", "@type": "WebSite", "@id": abs("/#website"), name: cfg.name, alternateName: "Neon Atlas GTA 6 Guide", url: abs("/"), description: `${cfg.tagline}. Unofficial and independent. Updated daily.`, inLanguage: cfg.language, publisher: { "@id": abs("/#org") } },
    { "@context": "https://schema.org", "@type": "Organization", "@id": abs("/#org"), name: cfg.name, url: abs("/"), logo: abs("/assets/logo-512.png") },
    { "@context": "https://schema.org", "@type": "CollectionPage", name: "GTA 6 Guide", url: abs("/"), dateModified: modOf(LIVE[0] || { updated: NOW.toISOString().slice(0, 10) }), about: { "@type": "VideoGame", name: "Grand Theft Auto VI", alternateName: "GTA 6" }, isPartOf: { "@id": abs("/#website") }, mainEntity: { "@type": "ItemList", itemListElement: featured.map((a, i) => ({ "@type": "ListItem", position: i + 1, url: abs(a.url), name: a.title })) } },
  ];
  write(url, layout({ url, title: "GTA 6 Guide: Release Time, Map, Characters & Live Updates", pageTitle: `GTA 6 Guide: Release Time, Map, Characters & Live Updates | ${cfg.name}`, description: "Independent GTA 6 guide, updated daily: unlock time, pre-load size, editions, characters and the Leonida map, with every claim sourced and labeled.", body, jsonld: ld, bodyClass: "page-home" }));
}

// ---------- launch live updates ----------
if (LIVEFEED.length) {
  const url = LIVE_URL;
  const href = linker(url);
  const items = [["Home", "/"], ["News & Updates", "/news/"], ["Launch live updates", url]];
  const entry = (e) => `<li class="live-entry" id="u-${String(e.time).replace(/[^0-9]/g, "")}"><time datetime="${e.time}">${fmtLiveTime(e.time)}</time>${e.confidence ? ` ${badge(e.confidence)}` : ""}<p>${new Marked().parseInline(e.text)}</p>${e.link ? `<p class="small"><a href="${href(e.link.startsWith("article:") ? (liveBy[e.link.slice(8)]?.url || "/") : e.link)}">${esc(e.linkText || "Full answer →")}</a></p>` : ""}</li>`;
  const body = `<div class="wrap narrow">${crumbs(url, items)}<header class="page-head"><p class="eyebrow"><span class="live-dot" aria-hidden="true"></span> Live · newest first</p><h1>GTA 6 launch: live updates</h1><p class="dek">Every confirmed GTA VI launch development as it happens: unlock times, patches, server status and new answers. Each entry is timestamped (US Eastern) and labeled.</p></header>
${countdownHtml()}
<ol class="live-list">${LIVEFEED.map(entry).join("")}</ol></div>`;
  const ld = [{ "@context": "https://schema.org", "@type": "LiveBlogPosting", headline: "GTA 6 launch: live updates", description: "Timestamped, sourced GTA VI launch updates.", url: abs(url), coverageStartTime: "2026-11-15T00:00:00-05:00", coverageEndTime: "2026-12-01T00:00:00-05:00", dateModified: String(LIVEFEED[0].time).length > 10 ? new Date(LIVEFEED[0].time).toISOString() : LIVEFEED[0].time, publisher: { "@type": "Organization", name: cfg.name, logo: { "@type": "ImageObject", url: abs("/assets/logo-512.png") } }, about: { "@type": "VideoGame", name: "Grand Theft Auto VI" }, liveBlogUpdate: LIVEFEED.slice(0, 30).map((e) => ({ "@type": "BlogPosting", headline: e.text.replace(/[*_`]/g, "").slice(0, 110), articleBody: e.text.replace(/[*_`]/g, ""), datePublished: String(e.time).length > 10 ? new Date(e.time).toISOString() : e.time })) }, crumbLD(items)];
  write(url, layout({ url, title: "GTA 6 Launch Live Updates", description: "Live, timestamped GTA VI launch updates: unlock times, pre-load, patches, server status and every new verified answer, newest first.", body, jsonld: ld, image: ART("gta-6-launch-week-everything-confirmed-share"), bodyClass: "page-live" }));
  searchIndex.push({ t: "GTA 6 launch: live updates", d: LIVEFEED[0].text.replace(/[*_`]/g, ""), u: url, c: "Live", k: "mixed", h: "", b: LIVEFEED.map((e) => e.text).join(" ").slice(0, 1800), q: "" });
}

// ---------- fan theories ----------
if (THEORIES.items.length) {
  const url = THEORIES_URL;
  const href = linker(url);
  const items = [["Home", "/"], ["Fan theories", url]];
  const counts = Object.fromEntries(Object.keys(THEORY_STATUS).map((k) => [k, THEORIES.items.filter((t) => t.status === k).length]));
  const body = `<div class="wrap narrow">${crumbs(url, items)}<header class="page-head"><p class="eyebrow">${badge("theory")} Updated <time datetime="${THEORIES.updated}">${fmtDate(THEORIES.updated)}</time></p><h1>GTA 6 fan theories</h1>
<p class="dek">The biggest GTA VI theories the community is debating right now, from Lucia's loyalty to returning characters. Each one shows what fans point to, the case against, and where fans are discussing it. Then you decide.</p></header>
<aside class="callout callout-note theory-note"><p class="callout-label">Theories, not facts</p><p>Everything on this page is fan speculation, refreshed nightly from what people are discussing. The case against each theory uses Rockstar's official information. For confirmed facts, see our <a href="${href("/news/gta-6-launch-week-everything-confirmed/")}">launch-week fact sheet</a>. We don't cover leaks.</p></aside>
<ul class="t-key">${Object.entries(THEORY_STATUS).map(([k, [l, n]]) => `<li><span class="t-status t-${k}">${l}</span> ${esc(n)}${counts[k] ? ` <span class="muted">(${counts[k]})</span>` : ""}</li>`).join("")}</ul>
<div class="theory-list">${THEORIES.items.map((t) => theoryCard(t, url)).join("")}</div>
<p class="small muted">Votes are anonymous: we store a random ID in a cookie so you can change your vote, and nothing else. Percentages appear once a theory has 10 votes.</p></div>`;
  const ld = [crumbLD(items), { "@context": "https://schema.org", "@type": "CollectionPage", name: "GTA 6 fan theories", url: abs(url), dateModified: THEORIES.updated, about: { "@type": "VideoGame", name: "Grand Theft Auto VI" }, mainEntity: { "@type": "ItemList", itemListElement: THEORIES.items.map((t, i) => ({ "@type": "ListItem", position: i + 1, url: abs(url) + "#" + t.id, name: t.title })) } }];
  write(url, layout({ url, title: "GTA 6 Fan Theories: The Biggest Ideas, Fact-Checked", description: "The biggest GTA 6 fan theories right now, from Lucia betraying Jason to returning characters, with the evidence for and against each. Updated nightly. Vote on each one.", body, jsonld: ld, bodyClass: "page-theories" }));
  fs.mkdirSync(path.join(DIST, "theories"), { recursive: true });
  fs.writeFileSync(path.join(DIST, "theories/ids.json"), JSON.stringify(THEORIES.items.map((t) => t.id)));
  for (const t of THEORIES.items) searchIndex.push({ t: `Fan theory: ${t.title}`, d: t.summary, u: `${url}#${t.id}`, c: "Fan theory", k: "theory", h: "", b: [...t.for, ...t.against].join(" "), q: "" });
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
  const faqLD = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: CATS.flatMap((c) => groups[c.slug] || []).map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: decode(new Marked().parseInline(f.a).replace(/<[^>]+>/g, "")) + ` Full answer: ${abs(f.article.url)}` } })) };
  write(url, layout({ url, title: "GTA 6 FAQ: Quick, Sourced Answers", description: "Quick answers to the most-asked GTA VI questions (release time, pre-load, editions, PC, physical copies), each linked to a sourced guide.", body, jsonld: [crumbLD(items), faqLD] }));
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
    ...LIVE.map((a) => ({ u: a.url, m: modOf(a), img: ART(a.slug), t: a.title })),
    ...(LIVEFEED.length ? [{ u: LIVE_URL, m: String(LIVEFEED[0].time).length > 10 ? new Date(LIVEFEED[0].time).toISOString() : LIVEFEED[0].time }] : []),
    ...(THEORIES.items.length ? [{ u: THEORIES_URL, m: THEORIES.updated }] : []),
    ...PAGES.filter((p) => !p.noindex).map((p) => ({ u: p.url, m: p.updated })),
  ];
  fs.writeFileSync(path.join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${indexable.map((x) => `  <url><loc>${abs(x.u)}</loc>${x.m ? `<lastmod>${x.m}</lastmod>` : ""}${x.img ? `<image:image><image:loc>${abs(x.img)}</image:loc></image:image>` : ""}</url>`).join("\n")}\n</urlset>\n`);
  // Search engines and AI answer engines are explicitly welcome: being cited by them is the goal.
  const bots = ["Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "GPTBot", "PerplexityBot", "Perplexity-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "Google-Extended", "Applebot", "Applebot-Extended", "DuckDuckBot"];
  fs.writeFileSync(path.join(DIST, "robots.txt"), `${bots.map((b) => `User-agent: ${b}`).join("\n")}\nAllow: /\nDisallow: /search/\nDisallow: /admin/\n\nUser-agent: *\nAllow: /\nDisallow: /search/\nDisallow: /admin/\n\nSitemap: ${abs("/sitemap.xml")}\n`);
  // llms.txt: a plain-text map of the site's answers for AI assistants (emerging convention)
  const byCat = CATS.map((c) => [c, LIVE.filter((a) => a.category === c.slug)]).filter(([, l]) => l.length);
  const strip = (t) => t.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  fs.writeFileSync(path.join(DIST, "llms.txt"), `# ${cfg.name}\n\n> ${cfg.tagline}. Independent and unofficial (not affiliated with Rockstar Games or Take-Two). Every page labels each claim as confirmed (official Rockstar source), reported (other outlets) or unconfirmed, lists its sources, and shows when it was last updated and verified.\n\nGTA VI release: ${fmtDate(cfg.launchDate)} on PlayStation 5 and Xbox Series X|S.\n${LIVEFEED.length ? `\nLatest live update (${fmtLiveTime(LIVEFEED[0].time)}): ${strip(LIVEFEED[0].text)}\n- [Launch live updates](${abs(LIVE_URL)})\n` : ""}\n${byCat.map(([c, l]) => `## ${c.name}\n\n${l.map((a) => `- [${a.title}](${abs(a.url)}): ${strip(a.answer || a.description)} (updated ${fmtMod(a)}; ${CONFIDENCE[a.confidence].label.toLowerCase()})`).join("\n")}`).join("\n\n")}${THEORIES.items.length ? `\n\n## Fan theories (speculation, not facts)\n\n${THEORIES.items.map((t) => `- [${t.title}](${abs(THEORIES_URL)}#${t.id}): ${t.summary} Status: ${THEORY_STATUS[t.status][0].toLowerCase()}.`).join("\n")}` : ""}\n\n## Full text\n\n- [llms-full.txt](${abs("/llms-full.txt")}): every article's answer and body in plain text\n`);
  fs.writeFileSync(path.join(DIST, "llms-full.txt"), LIVE.map((a) => `# ${a.title}\nURL: ${abs(a.url)}\nUpdated: ${fmtMod(a)} · Facts verified: ${fmtDate(a.lastVerified)} · Confidence: ${CONFIDENCE[a.confidence].label}\n\nQuick answer: ${strip(a.answer || a.description)}\n\n${strip(a.body.replace(/^\{\{.*\}\}$/gm, "").replace(/<!--[\s\S]*?-->/g, "")).trim()}\n\nSources:\n${a.sources.map((x) => `- ${x.title}: ${x.url}`).join("\n")}`).join("\n\n---\n\n") + "\n");
  if (cfg.indexNowKey) fs.writeFileSync(path.join(DIST, `${cfg.indexNowKey}.txt`), cfg.indexNowKey);
  const feedItems = LIVE.slice(0, 30).map((a) => `<item><title>${esc(a.title)}</title><link>${abs(a.url)}</link><guid>${abs(a.url)}</guid><pubDate>${new Date(a.updatedAt || a.updated + "T12:00:00Z").toUTCString()}</pubDate><description>${esc(a.description)}</description></item>`).join("");
  fs.writeFileSync(path.join(DIST, "feed.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${esc(cfg.name)}</title><link>${abs("/")}</link><atom:link href="${abs("/feed.xml")}" rel="self" type="application/rss+xml"/><lastBuildDate>${NOW.toUTCString()}</lastBuildDate><description>${esc(cfg.tagline)}</description><language>${cfg.language}</language>${feedItems}</channel></rss>\n`);
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
