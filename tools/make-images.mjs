// Renders the site logo PNG from its SVG mark with Playwright. (The default share image is an official Rockstar picture:
// no generated art.)
// Usage: node tools/make-images.mjs   -> assets/logo-512.png
import { chromium } from "./pw.mjs";
import path from "node:path";
import { ROOT } from "../src/content.mjs";

const mark = (size, color = "#3ee0bf") => `<svg width="${size}" height="${size}" viewBox="0 0 32 32"><path d="M16 2 28 9v14l-12 7L4 23V9z" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 8.5 21.5 22h-3l-1.2-3.2h-2.6L13.5 22h-3zm0 5.2-.9 2.7h1.8z" fill="${color}"/></svg>`;
const logo = `<html><body style="margin:0;width:512px;height:512px;background:#0b0e13;display:grid;place-items:center">${mark(380)}</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 512, height: 512 });
await page.setContent(logo);
await page.screenshot({ path: path.join(ROOT, "assets/logo-512.png") });
await browser.close();
console.log("wrote assets/logo-512.png");
