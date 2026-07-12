// Migration safety checks — things that only matter because the app was rewritten
// under an already-installed PWA.
//
// 1. Upgrade path: a device that used the vanilla build has a passphrase, a cached
//    day, and possibly a QUEUED OFFLINE EDIT in localStorage. The new build must
//    pick all of that up, not strand it.
// 2. Offline: the hand-written service worker was replaced by Workbox. The shell and
//    the handwriting font must still come from cache with no network...
// 3. ...but /api/ must NEVER be served from cache, or sync silently goes stale.

import { chromium } from "playwright-core";

const U = process.env.PLANNER_URL || "http://127.0.0.1:8788";
// Overridable so a run against a real deployment can clean up after itself.
const PASS = process.env.PLANNER_PASS || "migrate-" + Math.random().toString(36).slice(2, 8);
const H = { "X-Planner-Key": PASS, "Content-Type": "application/json" };
const getDay = d => fetch(`${U}/api/day?date=${d}`, { headers: H }).then(r => r.json());

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });

// ---------------------------------------------------------------- upgrade path
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Seed localStorage exactly as the OLD vanilla build would have left it:
  // signed in, one cached day, and one edit queued offline that never got sent.
  await ctx.addInitScript(({ pass }) => {
    const day = {
      day: 2,
      blocks: { morning: "written on the old build", afternoon: "", evening: "", notes: "" },
      todos: [{ checked: false, text: "old todo" }, ...Array.from({ length: 16 }, () => ({ checked: false, text: "" }))]
    };
    localStorage.setItem("planner:key", pass);
    localStorage.setItem(`planner:${pass}:2026-11-04`, JSON.stringify(day));
    localStorage.setItem(`planner:outbox:${pass}`, JSON.stringify({
      "2026-11-04": { data: day, base: null, force: false, conflict: false, server: null, queued_at: "seeded" }
    }));
  }, { pass: PASS });

  await page.goto(U);
  await page.waitForTimeout(2500);

  check("upgrade: opens straight in, no passphrase re-prompt",
    !(await page.isVisible("#keyInput")));

  const queuedEdit = await getDay("2026-11-04");
  check("upgrade: the offline edit queued by the OLD build syncs to D1",
    queuedEdit.data?.blocks?.morning === "written on the old build",
    JSON.stringify(queuedEdit.data?.blocks?.morning));

  const drained = await page.evaluate(k => JSON.parse(localStorage.getItem(`planner:outbox:${k}`) || "{}"), PASS);
  check("upgrade: outbox drained after flush", Object.keys(drained).length === 0, JSON.stringify(drained));

  // Navigate to the seeded day and confirm the content is on screen.
  await page.fill("#yy", "2026"); await page.fill("#mm", "11"); await page.fill("#dd", "04");
  await page.waitForTimeout(1500);
  check("upgrade: old cached day renders in the new UI",
    (await page.inputValue('textarea[data-key="morning"]')) === "written on the old build");
  const todos = await page.$$eval("#todo-list li input[type=text]", els => els.map(e => e.value).filter(Boolean));
  check("upgrade: old to-do survives", todos.includes("old todo"), JSON.stringify(todos));

  await ctx.close();
}

// ------------------------------------------------------------ offline via Workbox
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(U);
  await page.fill("#keyInput", PASS);
  await page.click("#keySave");
  await page.waitForTimeout(1000);

  // Let the service worker install and precache the shell.
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(2500);

  const swActive = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(reg && (reg.active || reg.installing || reg.waiting));
  });
  check("offline: a service worker is registered", swActive);

  // Now go fully offline and reload — this must come entirely from cache.
  await ctx.setOffline(true);
  let loaded = true;
  try {
    await page.reload({ waitUntil: "load", timeout: 20000 });
  } catch {
    loaded = false;
  }
  check("offline: app shell loads with no network", loaded);

  if (loaded) {
    await page.waitForTimeout(1500);
    check("offline: the sheet still renders", await page.isVisible(".sheet"));
    check("offline: handwriting font still available (served from cache)",
      await page.evaluate(() => document.fonts.check("16px Caveat")));
  }

  // The hard rule: /api/ must never be answered from the cache.
  const apiCached = await page.evaluate(async () => {
    const names = await caches.keys();
    for (const n of names) {
      const cache = await caches.open(n);
      for (const req of await cache.keys()) {
        if (new URL(req.url).pathname.startsWith("/api/")) return req.url;
      }
    }
    return null;
  });
  check("offline: /api/ is NOT in any cache", apiCached === null, apiCached || "none cached");

  // And an API call while offline must fail, not silently resolve to a cached page.
  const apiOffline = await page.evaluate(async () => {
    try {
      const r = await fetch("/api/day?date=2026-11-05", { headers: { "X-Planner-Key": "x" } });
      const body = await r.text();
      return { ok: r.ok, looksLikeHtml: body.trim().startsWith("<") };
    } catch {
      return { threw: true };
    }
  });
  check("offline: an API request fails rather than returning the cached shell",
    apiOffline.threw === true || (apiOffline.ok === false && !apiOffline.looksLikeHtml),
    JSON.stringify(apiOffline));

  await ctx.close();
}

await browser.close();

const bad = results.filter(r => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
if (bad.length) {
  console.log("FAILURES:\n" + bad.map(f => " - " + f.name).join("\n"));
  process.exit(1);
}
