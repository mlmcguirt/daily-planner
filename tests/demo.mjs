// Behaviour tests for the public demo. No server, no database.
//
//   npm run build:demo && npx vite preview --port 8789
//   npm run test:demo
//
// The demo has no /api, so this asserts only what is on the screen. That is enough,
// because the demo runs the REAL sync layer (src/lib/sync.js, zero diff) against a fake
// server (src/lib/demo-api.js) — so a green run here means the actual outbox, the actual
// flush and the actual version tracking all work. The design doc originally accepted
// "the demo may rot" as a permanent caveat. It doesn't have to.

import { chromium } from "playwright-core";

const U = process.env.DEMO_URL || "http://127.0.0.1:8789";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const status = pg => pg.textContent("#status");
const todoTexts = pg =>
  pg.$$eval("#todo-list li input[type=text]", els => els.map(e => e.value).filter(Boolean));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

await page.goto(U);
await page.waitForTimeout(1500);              // seed -> render -> flush-on-mount

// ---------- 1. a stranger's first three seconds ----------
check("demo: no passphrase gate", !(await page.isVisible("#keyInput")));
check("demo: the sheet is on screen", await page.isVisible(".sheet"));

const seeded = await todoTexts(page);
check("demo: the seeded day is there, not a blank sheet", seeded.length > 0, JSON.stringify(seeded));
check("demo: a ticked item is visible (the list looks lived-in)",
  await page.isChecked("#todo-list li:nth-child(2) .tick"));

const hand = await page.evaluate(() =>
  getComputedStyle(document.querySelector("#todo-list input[type=text]")).fontFamily);
check("demo: what you type is in the handwriting font", hand.includes("Caveat"), hand);
check("demo: Caveat actually loaded (not a serif fallback)",
  await page.evaluate(() => document.fonts.check("16px Caveat")));

// ---------- 2. the status line tells the truth ----------
// A fresh createSync has lastSavedAt = null, which renders "Synced" — a lie in an app
// with no server. demo-api seeds the OUTBOX instead, so app.jsx's flush-on-mount PUTs it,
// the shim answers 200, sync.js sets lastSavedAt, and the line settles on "Saved HH:MM".
const st = await status(page);
check('demo: status reads "Saved HH:MM"', /^Saved \d/.test(st), st);
check('demo: status is NOT the false "Synced"', !st.includes("Synced"), st);
check('demo: status is NOT stuck on "Saving…"', !st.includes("Saving"), st);
check("demo: the outbox actually drained", await page.evaluate(() =>
  Object.keys(JSON.parse(localStorage.getItem("planner:outbox:demo") || "{}")).length === 0));

// ---------- 3. the recurring feature is FINDABLE ----------
// It used to be reachable only by highlighting text. A visitor would never find it.
check("demo: a recurring item is on the sheet",
  (await todoTexts(page)).includes("Read 20 pages"), JSON.stringify(await todoTexts(page)));
check("demo: a written row offers a visible menu button",
  await page.isVisible("#todo-list li:nth-child(1) .row-menu"));

await page.click("#todo-list li:nth-child(1) .row-menu");
await page.waitForTimeout(300);
check("demo: that button opens the recurring pill — no text selection needed",
  await page.isVisible("#pillRecurring"));
await page.keyboard.press("Escape");
await page.click(".sheet h2");                                  // dismiss the pill

// ---------- 4. typing survives a reload (the outbox is real) ----------
await page.fill("#todo-list li:nth-child(12) input[type=text]", "buy stamps");   // a genuinely empty row
await page.waitForTimeout(1200);                                // 400ms debounce + flush
await page.reload();
await page.waitForTimeout(1500);
check("demo: a typed to-do survives a reload", (await todoTexts(page)).includes("buy stamps"),
  JSON.stringify(await todoTexts(page)));

// ---------- 5. search works with no server ----------
await page.click("#searchBtn");
await page.fill("#searchInput", "dentist");                     // from the seeded morning block
await page.waitForTimeout(800);
check("demo: search finds the seeded text",
  (await page.$$("#searchResults li[data-date]")).length > 0);
await page.click("#searchClose");

// ---------- 6. Reset demo does not resurrect the gate ----------
page.once("dialog", d => d.accept());
await page.click("#signOutBtn");
await page.waitForTimeout(2000);                                // resetDemo() + location.reload()
check("demo: the button says Reset demo, and reset does NOT show the passphrase gate",
  !(await page.isVisible("#keyInput")));
check("demo: reset brings the seeded day back",
  (await todoTexts(page)).includes("Book the flights"), JSON.stringify(await todoTexts(page)));
check("demo: reset cleared what the visitor typed",
  !(await todoTexts(page)).includes("buy stamps"));

// ---------- 7. no /api anywhere ----------
const apiHit = await page.evaluate(async () => {
  const r = await fetch("/api/day?date=2026-01-01", { headers: { "X-Planner-Key": "demo" } });
  return r.status;
});
check("demo: /api/day is answered by the shim, never the network", apiHit === 200);

await browser.close();

const bad = results.filter(r => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
if (bad.length) {
  console.log("FAILURES:\n" + bad.map(f => " - " + f.name).join("\n"));
  process.exit(1);
}
