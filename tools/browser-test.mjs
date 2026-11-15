#!/usr/bin/env node
// Browser tests against the built site (run `npm run build` first). Uses Playwright + axe-core.
// Checks every page on desktop and phone for: console errors, failed requests, horizontal overflow,
// accessibility violations (WCAG 2 A/AA), plus search, mobile nav, contact form and image loading.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "./pw.mjs";
import { start } from "./serve.mjs";
import { ROOT } from "../src/content.mjs";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const PORT = 4417, BASE = `http://localhost:${PORT}`;
const sm = fs.readFileSync(path.join(ROOT, "dist/sitemap.xml"), "utf8");
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "site.config.json"), "utf8")).url.replace(/\/$/, "");
const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(site, "")).concat(["/search/?q=pre-load", "/404.html"]);
// Requests that need the public internet and are allowed to fail offline (fonts, optional analytics).
const OPTIONAL = /fonts\.(googleapis|gstatic)\.com|googletagmanager|googlesyndication/;

const server = await start(PORT);
const browser = await chromium.launch();
const failures = [];
const fail = (u, m) => failures.push(`${u}: ${m}`);
const timings = [];

for (const vp of [{ name: "desktop", width: 1366, height: 900 }, { name: "phone", width: 390, height: 844, isMobile: true, hasTouch: true }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
  for (const u of urls) {
    const page = await ctx.newPage();
    const errs = [];
    page.on("console", (m) => { if (m.type() === "error" && !OPTIONAL.test(m.text())) errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push("JS error: " + e.message));
    page.on("requestfailed", (r) => { if (!OPTIONAL.test(r.url())) errs.push("request failed: " + r.url()); });
    page.on("response", (r) => { if (r.status() >= 400 && !OPTIONAL.test(r.url()) && !(u === "/404.html")) errs.push(`HTTP ${r.status()}: ${r.url()}`); });
    const t0 = Date.now();
    await page.goto(BASE + u, { waitUntil: "load" });
    if (vp.name === "desktop") timings.push({ u, ms: Date.now() - t0, bytes: await page.evaluate(() => performance.getEntriesByType("resource").reduce((n, e) => n + (e.transferSize || 0), 0) + (performance.getEntriesByType("navigation")[0]?.transferSize || 0)) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) fail(`${vp.name} ${u}`, `horizontal overflow ${overflow}px`);
    const broken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
    for (const b of broken) fail(`${vp.name} ${u}`, `image failed to load ${b}`);
    await page.addScriptTag({ content: axeSource });
    const axe = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0].target.join(" ")}`));
    for (const v of axe) fail(`${vp.name} ${u}`, "a11y " + v);
    for (const e of errs) fail(`${vp.name} ${u}`, e);
    await page.close();
  }
  await ctx.close();
}

// Functional checks
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
await p.goto(BASE + "/");
await p.click(".nav-toggle");
if (!(await p.isVisible("#site-nav a[href='/guides/']"))) fail("mobile nav", "menu did not open");
await p.click("#site-nav a[href='/characters/']");
await p.waitForURL("**/characters/");
await p.goto(BASE + "/");
await p.fill("#q-hero", "ultimate edition");
await p.press("#q-hero", "Enter");
await p.waitForSelector("#search-results li");
const first = await p.textContent("#search-results li h2");
if (!/Ultimate/i.test(first)) fail("search", `top result for "ultimate edition" was "${first}"`);
await p.fill("#sq", "zzzz-nothing");
await p.press("#sq", "Enter");
await p.waitForFunction(() => document.querySelector("#search-status").textContent.includes("No results"));
// search results link to real pages
await p.fill("#sq", "lucia"); await p.press("#sq", "Enter"); await p.waitForSelector("#search-results li a");
const href = await p.getAttribute("#search-results li a", "href");
const r = await p.request.get(BASE + href);
if (r.status() !== 200) fail("search", `result link ${href} returned ${r.status()}`);
// contact form validation + mailto fallback
await p.goto(BASE + "/contact/");
await p.click("#contact-form button[type=submit]");
if (!/at least 10/.test(await p.textContent(".form-status"))) fail("contact form", "empty message not rejected");
await p.fill("#cf-msg", "The pre-load page has a typo in step 2.");
await p.fill("#cf-email", "not-an-email");
await p.click("#contact-form button[type=submit]");
if (!/doesn't look right/.test(await p.textContent(".form-status"))) fail("contact form", "bad email not rejected");
await p.fill("#cf-email", "reader@example.org");
await p.click("#contact-form button[type=submit]");
await p.waitForTimeout(300);
if (!/email app should open/.test(await p.textContent(".form-status"))) fail("contact form", "valid message did not reach the mailto step");
// TOC anchors scroll to existing headings
await p.goto(BASE + "/guides/gta-6-editions-standard-vs-ultimate/");
for (const a of await p.$$eval(".toc a", (as) => as.map((x) => x.getAttribute("href")))) if (!(await p.$(a))) fail("toc", `anchor ${a} has no target`);
await ctx.close();
await browser.close();
server.close();

console.log(`Tested ${urls.length} URLs on desktop and phone (axe-core WCAG 2.1 AA, console, network, overflow, images) + nav, search, contact form, TOC.`);
const slow = timings.sort((a, b) => b.bytes - a.bytes)[0];
console.log(`Largest page transfer (local, uncompressed): ${slow.u} ${(slow.bytes / 1024).toFixed(0)} KB; slowest local load ${Math.max(...timings.map((t) => t.ms))} ms.`);
if (failures.length) { console.log(`\n${failures.length} failure(s):`); for (const f of failures) console.log("  ✗ " + f); process.exit(1); }
console.log("All browser tests passed.");
