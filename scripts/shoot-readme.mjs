// Takes the two README images, from the DEMO — never from the real planner.
//
// This matters more than it looks. The whole publication plan scrubs *text*: git history,
// CLAUDE.md, git ls-files. A screenshot of the owner's actual planner would publish real
// to-dos in a PNG, which no text scrub and no grep can see. So the images come from the
// seeded fictional day and the real planner is never on screen.
//
//   npm run build:demo && npx vite preview --port 8789 --host 127.0.0.1
//   node scripts/shoot-readme.mjs

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const U = process.env.DEMO_URL || "http://127.0.0.1:8789";
mkdirSync("docs", { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });

// 1. The sheet. Deliberately shot at a laptop size, because the cream band with the
//    buttons in it is the composition — crop to the sheet and you lose the whole point.
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
await page.goto(U);
await page.waitForTimeout(1800);                    // seed -> render -> flush
await page.evaluate(() => document.activeElement?.blur());
await page.screenshot({ path: "docs/sheet.png" });
console.log("→ docs/sheet.png");

// 2. The printed page. `print` media, landscape, one page — the thing the app is designed
//    to become again. Shot at a landscape-A4 ratio (1.414) and cropped to the sheet, so the
//    image is the page rather than a page floating in a screenshot canvas.
const printed = await browser.newPage({ viewport: { width: 1400, height: 990 }, deviceScaleFactor: 2 });
await printed.goto(U);
await printed.waitForTimeout(1800);
await printed.emulateMedia({ media: "print" });
await printed.evaluate(() => document.activeElement?.blur());
await printed.waitForTimeout(300);
await printed.locator(".sheet").screenshot({ path: "docs/printed.png" });
console.log("→ docs/printed.png");

await browser.close();
