// Loads Playwright from the project if installed, otherwise from the global install (CJS require honours NODE_PATH).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { throw new Error("Playwright not found. Install it with: npm i -D playwright && npx playwright install chromium"); }
export const { chromium } = pw;
