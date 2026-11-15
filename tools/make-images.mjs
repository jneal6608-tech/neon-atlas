// Renders the site's original raster artwork (social share image, logo PNG) from HTML/SVG with Playwright.
// Usage: node tools/make-images.mjs   -> assets/og-default.png (1200x630), assets/logo-512.png
import { chromium } from "./pw.mjs";
import path from "node:path";
import { ROOT, config } from "../src/content.mjs";

const cfg = config();
const mark = (size, color = "#3ee0bf") => `<svg width="${size}" height="${size}" viewBox="0 0 32 32"><path d="M16 2 28 9v14l-12 7L4 23V9z" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 8.5 21.5 22h-3l-1.2-3.2h-2.6L13.5 22h-3zm0 5.2-.9 2.7h1.8z" fill="${color}"/></svg>`;
const og = `<html><body style="margin:0;width:1200px;height:630px;background:#0b0e13;font-family:'Space Grotesk',sans-serif;color:#e9edf2;overflow:hidden;position:relative">
<div style="position:absolute;inset:0;background:radial-gradient(800px 420px at 90% 0%,rgba(62,224,191,.22),transparent 60%),radial-gradient(600px 360px at 0% 100%,rgba(243,183,79,.14),transparent 60%)"></div>
<div style="position:absolute;inset:0;opacity:.28;background-image:linear-gradient(#263142 1px,transparent 1px),linear-gradient(90deg,#263142 1px,transparent 1px);background-size:60px 60px"></div>
<div style="position:absolute;left:80px;top:80px;display:flex;align-items:center;gap:22px">${mark(84)}<span style="font-size:52px;font-weight:700">${cfg.name}</span></div>
<div style="position:absolute;left:80px;top:240px;font-size:66px;font-weight:700;line-height:1.08;max-width:980px">The independent <span style="color:#3ee0bf">GTA VI</span> guide</div>
<div style="position:absolute;left:80px;bottom:80px;display:flex;gap:14px;font:600 24px Inter,sans-serif">
<span style="padding:10px 16px;border:2px solid #3ee0bf;color:#3ee0bf;border-radius:10px">CONFIRMED</span>
<span style="padding:10px 16px;border:2px solid #f3b74f;color:#f3b74f;border-radius:10px">REPORTED</span>
<span style="padding:10px 16px;border:2px solid #6b7a8e;color:#c4ccd6;border-radius:10px">UNCONFIRMED</span>
<span style="margin-left:18px;align-self:center;color:#a3afbd">Unofficial fan resource</span></div></body></html>`;
const logo = `<html><body style="margin:0;width:512px;height:512px;background:#0b0e13;display:grid;place-items:center">${mark(380)}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<link href="https://fonts.googleapis.com/css2?family=Inter:wght@600&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">` + og, { waitUntil: "networkidle" }).catch(() => page.setContent(og));
await page.setViewportSize({ width: 1200, height: 630 });
await page.screenshot({ path: path.join(ROOT, "assets/og-default.png") });
await page.setViewportSize({ width: 512, height: 512 });
await page.setContent(logo);
await page.screenshot({ path: path.join(ROOT, "assets/logo-512.png") });
await browser.close();
console.log("wrote assets/og-default.png and assets/logo-512.png");
