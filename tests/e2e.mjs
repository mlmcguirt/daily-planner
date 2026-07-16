// End-to-end behaviour tests. Drives the real UI in a real browser and asserts
// against real D1 rows — the sync paths (offline queue, conflicts) cannot be
// verified any other way, and every bug found in them so far was invisible to
// code review.
//
//   npm run build && npx wrangler pages dev dist --port 8788
//   npm run test:e2e
//
// Deliberately not coupled to the implementation: it clicks buttons and reads the
// screen, so it survived the vanilla -> Preact rewrite unchanged.

import { chromium } from "playwright-core";

const U = process.env.PLANNER_URL || "http://127.0.0.1:8788";
// Overridable so a run against a real deployment can clean up after itself.
const PASS = process.env.PLANNER_PASS || "e2e-" + Math.random().toString(36).slice(2, 8);
const H = { "X-Planner-Key": PASS, "Content-Type": "application/json" };

// "Another device": plain fetch, unaffected by the browser's offline state.
const api = {
  get: d => fetch(`${U}/api/day?date=${d}`, { headers: H }).then(r => r.json()),
  put: (d, data) =>
    fetch(`${U}/api/day?date=${d}`, {
      method: "PUT", headers: H,
      body: JSON.stringify({ data, base: null, force: true })
    }).then(r => r.json()),
  recurring: items =>
    fetch(`${U}/api/recurring`, { method: "PUT", headers: H, body: JSON.stringify({ items }) }).then(r => r.json()),
  search: q => fetch(`${U}/api/search?q=${encodeURIComponent(q)}`, { headers: H }).then(r => r.json())
};

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const setDate = async (pg, ds) => {
  const [y, m, d] = ds.split("-");
  await pg.fill("#yy", y);
  await pg.fill("#mm", m);
  await pg.fill("#dd", d);
  await pg.waitForTimeout(700);
};
const typeMorning = async (pg, text) => {
  await pg.fill('textarea[data-key="morning"]', text);
  await pg.waitForTimeout(1000);                       // 400ms debounce + request
};
const status = pg => pg.textContent("#status");
const outbox = pg => pg.evaluate(k => JSON.parse(localStorage.getItem(`planner:outbox:${k}`) || "{}"), PASS);
const todoTexts = pg =>
  pg.$$eval("#todo-list li input[type=text]", els => els.map(e => e.value).filter(Boolean));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
let page = await ctx.newPage();

await page.goto(U);
await page.fill("#keyInput", PASS);
await page.click("#keySave");
await page.waitForTimeout(800);

// ---------- 1. round-trip ----------
await setDate(page, "2026-08-05");
await typeMorning(page, "dentist at ten");
let row = await api.get("2026-08-05");
check("round-trip: typed text reaches D1", row.data?.blocks?.morning === "dentist at ten", JSON.stringify(row.data?.blocks?.morning));
check("round-trip: status says Saved", (await status(page)).startsWith("Saved"), await status(page));

// ---------- 2. look: handwriting only on typed content ----------
const look = await page.evaluate(() => ({
  textarea: getComputedStyle(document.querySelector('textarea[data-key="morning"]')).fontFamily,
  todo: getComputedStyle(document.querySelector("#todo-list li input[type=text]")).fontFamily,
  heading: getComputedStyle(document.querySelector("h2")).fontFamily,
  button: getComputedStyle(document.querySelector("#printBtn")).fontFamily,
  paper: getComputedStyle(document.querySelector(".sheet")).backgroundColor,
  backdrop: getComputedStyle(document.body).backgroundColor
}));
check("handwriting on textarea", look.textarea.includes("Caveat"), look.textarea);
check("handwriting on to-do text", look.todo.includes("Caveat"), look.todo);
check("heading stays serif", !look.heading.includes("Caveat"), look.heading);
check("button stays serif", !look.button.includes("Caveat"), look.button);
check("sheet is white", look.paper === "rgb(255, 255, 255)", look.paper);
check("backdrop is cream", look.backdrop === "rgb(247, 239, 221)", look.backdrop);
check("Caveat font actually loaded", await page.evaluate(() => document.fonts.check("16px Caveat")));

// ---------- 3. fits one screen, buttons on the cream ----------
const fit = await page.evaluate(() => {
  const sheet = document.querySelector(".sheet").getBoundingClientRect();
  const btn = document.querySelector("#searchBtn").getBoundingClientRect();
  return {
    scrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
    even: [Math.round(sheet.left), Math.round(window.innerWidth - sheet.right), Math.round(sheet.top),
           Math.round(window.innerHeight - sheet.bottom)],
    buttonOnCream: btn.bottom <= sheet.top + 1,
    rows: document.querySelectorAll("#todo-list li").length
  };
});
check("sheet fits one screen (no scrolling)", !fit.scrolls);
check("cream border even on all sides", new Set(fit.even).size === 1, fit.even.join("/"));
check("buttons sit on the cream, not the paper", fit.buttonOnCream);
check("checklist has 17 rows", fit.rows === 17, String(fit.rows));

// ---------- 4. offline edit syncs on reconnect ----------
await ctx.setOffline(true);
await setDate(page, "2026-08-06");
await typeMorning(page, "written while offline");
check("offline: edit queued in the outbox", !!(await outbox(page))["2026-08-06"]);
check("offline: status admits it's offline", (await status(page)).toLowerCase().includes("offline"), await status(page));
check("offline: nothing on the server yet", (await api.get("2026-08-06")).data === null);

await ctx.setOffline(false);
await page.waitForTimeout(1800);
check("reconnect: queued edit flushed to D1",
  (await api.get("2026-08-06")).data?.blocks?.morning === "written while offline");
check("reconnect: outbox drained", Object.keys(await outbox(page)).length === 0);

// ---------- 5. an offline edit survives closing the tab ----------
await ctx.setOffline(true);
await setDate(page, "2026-08-07");
await typeMorning(page, "queued then tab closed");
check("tab-close: queued before closing", !!(await outbox(page))["2026-08-07"]);
await page.close();
await ctx.setOffline(false);
page = await ctx.newPage();
await page.goto(U);
await page.waitForTimeout(2500);
check("tab-close: edit still landed after reopen",
  (await api.get("2026-08-07")).data?.blocks?.morning === "queued then tab closed");

// ---------- 6. two-device conflict ----------
await ctx.setOffline(true);
await setDate(page, "2026-08-08");
await typeMorning(page, "my offline version");
await api.put("2026-08-08", { day: 5, blocks: { morning: "their version" }, todos: [] });
await ctx.setOffline(false);
await page.waitForTimeout(2500);
check("conflict: prompt appears instead of silent overwrite", await page.isVisible("#conflictOverlay"));
check("conflict: shows their version", (await page.textContent("#theirsText")).includes("their version"));
check("conflict: shows my version", (await page.textContent("#mineText")).includes("my offline version"));
check("conflict: server NOT clobbered while unresolved",
  (await api.get("2026-08-08")).data?.blocks?.morning === "their version");

await page.click("#keepMine");
await page.waitForTimeout(1800);
check("conflict: 'keep mine' then wins",
  (await api.get("2026-08-08")).data?.blocks?.morning === "my offline version");
check("conflict: outbox drained after resolve", Object.keys(await outbox(page)).length === 0);

// ---------- 7. conflict resolved the other way ----------
await ctx.setOffline(true);
await setDate(page, "2026-08-20");
await typeMorning(page, "mine again");
await api.put("2026-08-20", { day: 3, blocks: { morning: "theirs again" }, todos: [{ checked: false, text: "their todo" }] });
await ctx.setOffline(false);
await page.waitForTimeout(2500);
check("use-theirs: prompt shown", await page.isVisible("#conflictOverlay"));
await page.click("#useTheirs");
await page.waitForTimeout(1500);
check("use-theirs: screen shows their version",
  (await page.inputValue('textarea[data-key="morning"]')) === "theirs again");
check("use-theirs: their to-do is on screen", (await todoTexts(page)).includes("their todo"));
check("use-theirs: server keeps their version",
  (await api.get("2026-08-20")).data?.blocks?.morning === "theirs again");
check("use-theirs: no stuck conflict", Object.keys(await outbox(page)).length === 0);

// ---------- 8. carry over unfinished ----------
await api.put("2026-09-01", {
  day: 1, blocks: {},
  todos: [{ checked: false, text: "unfinished thing" }, { checked: true, text: "done thing" }]
});
await setDate(page, "2026-09-02");
await page.waitForTimeout(1500);
check("carry-over: button offered", await page.isVisible("#carryBtn"));
check("carry-over: counts only the unfinished one",
  (await page.textContent("#carryBtn")).includes("1 unfinished"), await page.textContent("#carryBtn"));
await page.click("#carryBtn");
await page.waitForTimeout(1500);
let texts = ((await api.get("2026-09-02")).data?.todos || []).filter(t => t.text).map(t => t.text);
check("carry-over: unfinished item copied", texts.includes("unfinished thing"), JSON.stringify(texts));
check("carry-over: completed item NOT copied", !texts.includes("done thing"), JSON.stringify(texts));

// ---------- 9. recurring ----------
await api.recurring([{ id: "rec-tue", text: "Bins out", weekdays: [1] }]);   // Tuesday
await page.reload();
await page.waitForTimeout(1500);
await setDate(page, "2026-09-08");                                          // a Tuesday
await page.waitForTimeout(900);
check("recurring: appears on its weekday",
  (await todoTexts(page)).filter(t => t === "Bins out").length === 1);
await setDate(page, "2026-09-09");                                          // Wednesday
await page.waitForTimeout(900);
check("recurring: absent on other weekdays",
  (await todoTexts(page)).filter(t => t === "Bins out").length === 0);

await setDate(page, "2026-09-08");
await page.waitForTimeout(900);
await typeMorning(page, "tuesday notes");        // saves the day, persisting the rid
await setDate(page, "2026-09-09");
await page.waitForTimeout(600);
await setDate(page, "2026-09-08");
await page.waitForTimeout(1500);
check("recurring: no duplicate after save + reopen",
  (await todoTexts(page)).filter(t => t === "Bins out").length === 1,
  JSON.stringify(await todoTexts(page)));

// ---------- 10. reordering the checklist ----------
await api.put("2026-12-03", {
  day: 1, blocks: {},
  todos: [{ checked: false, text: "first" }, { checked: false, text: "second" }, { checked: false, text: "third" }]
});
await setDate(page, "2026-12-03");
await page.waitForTimeout(1500);
check("reorder: starts in the saved order",
  JSON.stringify(await todoTexts(page)) === JSON.stringify(["first", "second", "third"]),
  JSON.stringify(await todoTexts(page)));

// Drag row 3 ("third") up onto row 1 with a real pointer drag.
const grips = await page.$$("#todo-list li .grip");
const rows = await page.$$("#todo-list li");
const from = await grips[2].boundingBox();
const onto = await rows[0].boundingBox();
await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
await page.mouse.down();
await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(1500);

check("reorder: order changes on screen",
  JSON.stringify(await todoTexts(page)) === JSON.stringify(["third", "first", "second"]),
  JSON.stringify(await todoTexts(page)));

const saved = ((await api.get("2026-12-03")).data?.todos || []).filter(t => t.text).map(t => t.text);
check("reorder: the new order is saved to D1",
  JSON.stringify(saved) === JSON.stringify(["third", "first", "second"]), JSON.stringify(saved));

await page.reload();
await page.waitForTimeout(1500);
await setDate(page, "2026-12-03");
await page.waitForTimeout(1500);
check("reorder: survives a reload",
  JSON.stringify(await todoTexts(page)) === JSON.stringify(["third", "first", "second"]),
  JSON.stringify(await todoTexts(page)));

// Keyboard fallback: focus a handle and press ArrowDown.
const grips2 = await page.$$("#todo-list li .grip");
await grips2[0].focus();
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(1200);
check("reorder: keyboard (arrow keys) moves a row too",
  JSON.stringify(await todoTexts(page)) === JSON.stringify(["first", "third", "second"]),
  JSON.stringify(await todoTexts(page)));

// ---------- 11. stepping between days with the arrows ----------
await api.put("2026-05-31", { day: 6, blocks: { morning: "last day of May" }, todos: [] });
await api.put("2026-06-01", { day: 0, blocks: { morning: "first day of June" }, todos: [] });

await setDate(page, "2026-06-01");
await page.waitForTimeout(1200);
const dateNow = () => page.evaluate(() =>
  `${document.getElementById("yy").value}-${document.getElementById("mm").value}-${document.getElementById("dd").value}`);

await page.click("#prevDay");
await page.waitForTimeout(1500);
check("arrows: back a day crosses the month boundary", (await dateNow()) === "2026-05-31", await dateNow());
check("arrows: it loads that day's saved entries",
  (await page.inputValue('textarea[data-key="morning"]')) === "last day of May");

await page.click("#nextDay");
await page.waitForTimeout(1500);
check("arrows: forward a day returns", (await dateNow()) === "2026-06-01", await dateNow());
check("arrows: and loads its entries",
  (await page.inputValue('textarea[data-key="morning"]')) === "first day of June");

check("arrows: the weekday marker follows",
  await page.evaluate(() => {
    const active = [...document.querySelectorAll(".days button[data-idx]")].findIndex(b => b.getAttribute("aria-current") === "date");
    return active === 0;                       // 2026-06-01 is a Monday
  }));

// ---------- 12. several recurring to-dos, created through the UI ----------
await api.recurring([]);                        // start from an empty list
await page.reload();
await page.waitForTimeout(1500);
await page.click("#recurBtn");
await page.waitForTimeout(400);

const fillRecur = async (i, text, weekdays) => {
  const boxes = await page.$$(".recur-row input[type=text]");
  await boxes[i].fill(text);                    // typing in the last row grows a new one
  await page.waitForTimeout(200);
  for (const wd of weekdays) {
    await page.click(`.recur-row:nth-of-type(${i + 1}) button[data-wd="${wd}"]`);
  }
  await page.waitForTimeout(150);
};

await fillRecur(0, "Vitamins", [0]);            // Monday
await fillRecur(1, "Bins out", [0]);            // ALSO Monday — two on one day
await fillRecur(2, "Water plants", [3]);        // Thursday
check("recurring: rows grow as you type, no hunting for a button",
  (await page.$$(".recur-row")).length >= 4);   // 3 filled + 1 blank

await page.click("#recurSave");
await page.waitForTimeout(1800);

const savedRecur = (await fetch(`${U}/api/recurring`, { headers: H }).then(r => r.json())).items || [];
check("recurring: all three saved", savedRecur.length === 3, JSON.stringify(savedRecur.map(i => i.text)));
check("recurring: the blank row was not saved as an item",
  !savedRecur.some(i => !i.text.trim()));

await setDate(page, "2026-07-13");              // a Monday
await page.waitForTimeout(1500);
let onMonday = await todoTexts(page);
check("recurring: BOTH Monday items appear together",
  onMonday.includes("Vitamins") && onMonday.includes("Bins out"), JSON.stringify(onMonday));
check("recurring: the Thursday item stays off Monday",
  !onMonday.includes("Water plants"), JSON.stringify(onMonday));

await setDate(page, "2026-07-16");              // Thursday
await page.waitForTimeout(1200);
const onThursday = await todoTexts(page);
check("recurring: Thursday item appears on Thursday",
  onThursday.includes("Water plants") && !onThursday.includes("Vitamins"), JSON.stringify(onThursday));

// Reopening the editor must show all of them, not just one.
await page.click("#recurBtn");
await page.waitForTimeout(500);
const reopened = await page.$$eval(".recur-row input[type=text]", els => els.map(e => e.value).filter(Boolean));
check("recurring: the editor reopens with all of them",
  reopened.length === 3, JSON.stringify(reopened));
await page.click("#recurClose");
await page.waitForTimeout(300);

await api.recurring([]);                        // don't leak into later checks
await page.reload();
await page.waitForTimeout(1200);

// ---------- 13. the selection pill ----------
await api.recurring([]);
await api.put("2026-04-06", {                      // a Monday
  day: 0,
  blocks: { morning: "walk the dog and buy milk" },
  todos: [{ checked: false, text: "Take out the bins" }, { checked: false, text: "Keep me" }]
});
await page.reload();
await page.waitForTimeout(1500);
await setDate(page, "2026-04-06");
await page.waitForTimeout(1500);

// Highlight " and buy milk" inside the Morning block.
const full = "walk the dog and buy milk";
await page.$eval('textarea[data-key="morning"]', (el, [from, to]) => {
  el.focus();
  el.setSelectionRange(from, to);
  el.dispatchEvent(new Event("select", { bubbles: true }));
}, [full.indexOf(" and buy milk"), full.length]);
await page.waitForTimeout(400);
check("pill: appears when text in a block is highlighted", await page.isVisible("#selectionPill"));

await page.click("#pillDelete");
await page.waitForTimeout(1500);
check("pill: Delete removes just the highlighted text",
  (await page.inputValue('textarea[data-key="morning"]')) === "walk the dog",
  await page.inputValue('textarea[data-key="morning"]'));
check("pill: the deletion is saved to D1",
  (await api.get("2026-04-06")).data?.blocks?.morning === "walk the dog");
check("pill: disappears once the selection is gone", !(await page.isVisible("#selectionPill")));

// Highlight a whole to-do and make it recurring.
await page.$$eval("#todo-list li input[type=text]", els => {
  const el = els.find(e => e.value === "Take out the bins");
  el.focus();
  el.setSelectionRange(0, el.value.length);
  el.dispatchEvent(new Event("select", { bubbles: true }));
});
await page.waitForTimeout(400);
check("pill: appears when a to-do is highlighted", await page.isVisible("#selectionPill"));

await page.click("#pillRecurring");
await page.waitForTimeout(600);
check("pill: 'Make recurring' opens the editor prefilled",
  (await page.$$eval(".recur-row input[type=text]", els => els.map(e => e.value)))
    .includes("Take out the bins"));
check("pill: today's weekday is ticked, ready to adjust",
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".recur-row")]
      .find(r => r.querySelector("input[type=text]").value === "Take out the bins");
    return row.querySelector('button[data-wd="0"]').className.includes("bg-ink");   // Monday
  }));

await page.click("#recurSave");
await page.waitForTimeout(1800);
const pillRecur = (await fetch(`${U}/api/recurring`, { headers: H }).then(r => r.json())).items || [];
check("pill: it really is recurring now",
  pillRecur.some(i => i.text === "Take out the bins" && i.weekdays.includes(0)),
  JSON.stringify(pillRecur));

await api.recurring([]);
await page.reload();
await page.waitForTimeout(1200);

// ---------- 14. the pill's third action: stop something recurring ----------
await api.recurring([{ id: "bins", text: "Bins out", weekdays: [0] }]);   // Mondays
await page.reload();
await page.waitForTimeout(1500);
await setDate(page, "2026-04-13");                                        // a Monday
await page.waitForTimeout(1500);
check("stop-recurring: the recurring item is on the day",
  (await todoTexts(page)).includes("Bins out"), JSON.stringify(await todoTexts(page)));

const highlight = text => page.$$eval("#todo-list li input[type=text]", (els, t) => {
  const el = els.find(e => e.value === t);
  el.focus();
  el.setSelectionRange(0, el.value.length);
  el.dispatchEvent(new Event("select", { bubbles: true }));
}, text);

await highlight("Bins out");
await page.waitForTimeout(400);
check("stop-recurring: pill offers 'Delete recurring' for a recurring item",
  await page.isVisible("#pillDeleteRecurring"));
check("stop-recurring: and NOT 'Make recurring' (it already is)",
  !(await page.isVisible("#pillRecurring")));

// A plain to-do should still get "Make recurring", not "Delete recurring".
await page.fill("#todo-list li:nth-of-type(3) input[type=text]", "Just a normal todo");
await page.waitForTimeout(900);
await highlight("Just a normal todo");
await page.waitForTimeout(400);
check("stop-recurring: a plain to-do still offers 'Make recurring'",
  (await page.isVisible("#pillRecurring")) && !(await page.isVisible("#pillDeleteRecurring")));

page.once("dialog", d => d.accept());                                     // the confirm
await highlight("Bins out");
await page.waitForTimeout(400);
await page.click("#pillDeleteRecurring");
await page.waitForTimeout(2000);

const left = (await fetch(`${U}/api/recurring`, { headers: H }).then(r => r.json())).items || [];
check("stop-recurring: removed from the recurring list", left.length === 0, JSON.stringify(left));
check("stop-recurring: taken off today too", !(await todoTexts(page)).includes("Bins out"),
  JSON.stringify(await todoTexts(page)));

// The real test: it must not come back on the NEXT Monday.
await setDate(page, "2026-04-20");                                        // the following Monday
await page.waitForTimeout(1500);
check("stop-recurring: it does not come back on future Mondays",
  !(await todoTexts(page)).includes("Bins out"), JSON.stringify(await todoTexts(page)));

await api.recurring([]);
await page.reload();
await page.waitForTimeout(1200);

// ---------- 15. a recurring block line comes back in its own block ----------
await api.recurring([]);
await api.put("2026-03-02", { day: 0, blocks: { morning: "Post office" }, todos: [] });   // Monday
await page.reload();
await page.waitForTimeout(1500);
await setDate(page, "2026-03-02");
await page.waitForTimeout(1500);

// Highlight "Post office" in the Morning block and make it recurring.
await page.$eval('textarea[data-key="morning"]', el => {
  el.focus();
  el.setSelectionRange(0, "Post office".length);
  el.dispatchEvent(new Event("select", { bubbles: true }));
});
await page.waitForTimeout(400);
await page.click("#pillRecurring");
await page.waitForTimeout(600);
check("block-recurring: the editor points it back at Morning",
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".recur-row")]
      .find(r => r.querySelector("input[type=text]").value === "Post office");
    return row.querySelector(".recur-target").value === "morning";
  }));
await page.click("#recurSave");
await page.waitForTimeout(1800);

const blockRec = (await fetch(`${U}/api/recurring`, { headers: H }).then(r => r.json())).items || [];
check("block-recurring: saved with target=morning",
  blockRec.some(i => i.text === "Post office" && i.target === "morning"), JSON.stringify(blockRec));

// The following Monday: it must be IN Morning, and NOT a new to-do.
await setDate(page, "2026-03-09");
await page.waitForTimeout(1800);
const nextMorning = await page.inputValue('textarea[data-key="morning"]');
const nextTodos = await todoTexts(page);
check("block-recurring: comes back inside the Morning box",
  nextMorning.includes("Post office"), JSON.stringify(nextMorning));
check("block-recurring: does NOT become a new to-do",
  !nextTodos.includes("Post office"), JSON.stringify(nextTodos));

// Not on a Tuesday.
await setDate(page, "2026-03-10");
await page.waitForTimeout(1500);
check("block-recurring: absent on other weekdays",
  !(await page.inputValue('textarea[data-key="morning"]')).includes("Post office"));

// And it must not pile up: revisit the same Monday, still one copy.
await setDate(page, "2026-03-09");
await page.waitForTimeout(1500);
await page.fill('textarea[data-key="notes"]', "touch the day so it saves");
await page.waitForTimeout(1200);
await setDate(page, "2026-03-10");
await page.waitForTimeout(600);
await setDate(page, "2026-03-09");
await page.waitForTimeout(1800);
const occurrences = (await page.inputValue('textarea[data-key="morning"]')).split("Post office").length - 1;
check("block-recurring: no duplicate after save + reopen", occurrences === 1,
  `${occurrences} copies: ${await page.inputValue('textarea[data-key="morning"]')}`);

await api.recurring([]);
await page.reload();
await page.waitForTimeout(1200);

// ---------- 16. the pill's Edit action ----------
await api.recurring([
  { id: "vits", text: "Vitamins", weekdays: [0], target: "todo" },
  { id: "bins", text: "Bins out", weekdays: [0], target: "todo" }
]);
await page.reload();
await page.waitForTimeout(1500);
await setDate(page, "2026-04-27");                       // a Monday
await page.waitForTimeout(1500);

const pick = text => page.$$eval("#todo-list li input[type=text]", (els, t) => {
  const el = els.find(e => e.value === t);
  el.focus();
  el.setSelectionRange(0, el.value.length);
  el.dispatchEvent(new Event("select", { bubbles: true }));
}, text);

await pick("Bins out");
await page.waitForTimeout(400);
check("pill: a recurring item offers Edit, Delete recurring and Delete",
  (await page.isVisible("#pillEditRecurring")) &&
  (await page.isVisible("#pillDeleteRecurring")) &&
  (await page.isVisible("#pillDelete")));

await page.click("#pillEditRecurring");
await page.waitForTimeout(700);
check("pill: Edit opens the editor focused on THAT item, not the other one",
  await page.evaluate(() => {
    const active = document.activeElement;
    const row = active?.closest?.(".recur-row");
    return row?.dataset.id === "bins" && active.value === "Bins out";
  }));

// Change it: rename, move it to Tuesday, and send it to the Evening box.
await page.fill('.recur-row[data-id="bins"] input[type=text]', "Bins out (green)");
await page.click('.recur-row[data-id="bins"] button[data-wd="0"]');   // untick Monday
await page.click('.recur-row[data-id="bins"] button[data-wd="1"]');   // tick Tuesday
await page.selectOption('.recur-row[data-id="bins"] .recur-target', "evening");
await page.click("#recurSave");
await page.waitForTimeout(1800);

const edited = (await fetch(`${U}/api/recurring`, { headers: H }).then(r => r.json())).items || [];
const bins = edited.find(i => i.id === "bins");
check("pill: the edit saved (text, weekday and box all changed)",
  bins?.text === "Bins out (green)" && JSON.stringify(bins.weekdays) === "[1]" && bins.target === "evening",
  JSON.stringify(bins));
check("pill: editing one item didn't disturb the other",
  edited.some(i => i.id === "vits" && i.text === "Vitamins" && i.target === "todo"),
  JSON.stringify(edited));

// It should now be gone from Monday's checklist and appear in Tuesday's Evening box.
await page.waitForTimeout(800);
check("pill: the edited item leaves Monday",
  !(await todoTexts(page)).includes("Bins out"), JSON.stringify(await todoTexts(page)));
await setDate(page, "2026-04-28");                       // Tuesday
await page.waitForTimeout(1800);
check("pill: and lands in the Evening box on Tuesday",
  (await page.inputValue('textarea[data-key="evening"]')).includes("Bins out (green)"),
  await page.inputValue('textarea[data-key="evening"]'));

await api.recurring([]);
await page.reload();
await page.waitForTimeout(1200);

// ---------- 17. making something recurring must not duplicate it on today ----------
await api.recurring([]);
await api.put("2026-02-02", {                    // a Monday
  day: 0,
  blocks: { morning: "Post office" },
  todos: [{ checked: false, text: "Take out the bins" }]
});
await page.reload();
await page.waitForTimeout(1500);
await setDate(page, "2026-02-02");
await page.waitForTimeout(1500);

const countTodo = async t => (await todoTexts(page)).filter(x => x === t).length;

await pick("Take out the bins");
await page.waitForTimeout(400);
await page.click("#pillRecurring");
await page.waitForTimeout(600);
await page.click("#recurSave");
await page.waitForTimeout(2000);

check("no-dupe: exactly ONE 'Take out the bins' on the day, not two",
  (await countTodo("Take out the bins")) === 1, JSON.stringify(await todoTexts(page)));

const savedDay = (await api.get("2026-02-02")).data;
const binRows = (savedDay?.todos || []).filter(t => t.text === "Take out the bins");
check("no-dupe: and only one row in D1", binRows.length === 1, JSON.stringify(savedDay?.todos?.filter(t => t.text)));
check("no-dupe: the existing row became the recurring one (it carries the id)",
  binRows[0]?.rid !== undefined, JSON.stringify(binRows));

// Still only one after a reload — the classic way a duplicate shows up late.
await page.reload();
await page.waitForTimeout(1500);
await setDate(page, "2026-02-02");
await page.waitForTimeout(1800);
check("no-dupe: still one after a reload", (await countTodo("Take out the bins")) === 1,
  JSON.stringify(await todoTexts(page)));

// Same for a block line: making it recurring must not write it twice.
await page.$eval('textarea[data-key="morning"]', el => {
  el.focus();
  el.setSelectionRange(0, "Post office".length);
  el.dispatchEvent(new Event("select", { bubbles: true }));
});
await page.waitForTimeout(400);
await page.click("#pillRecurring");
await page.waitForTimeout(600);
await page.click("#recurSave");
await page.waitForTimeout(2000);
let morningNow = await page.inputValue('textarea[data-key="morning"]');
check("no-dupe: the block line isn't written twice",
  morningNow.split("Post office").length - 1 === 1, JSON.stringify(morningNow));

await page.reload();
await page.waitForTimeout(1500);
await setDate(page, "2026-02-02");
await page.waitForTimeout(1800);
morningNow = await page.inputValue('textarea[data-key="morning"]');
check("no-dupe: block line still single after a reload",
  morningNow.split("Post office").length - 1 === 1, JSON.stringify(morningNow));

// And it does still recur — next Monday it's there (once).
await setDate(page, "2026-02-09");
await page.waitForTimeout(1800);
check("no-dupe: it genuinely recurs next Monday",
  (await countTodo("Take out the bins")) === 1 &&
  (await page.inputValue('textarea[data-key="morning"]')).includes("Post office"));

await api.recurring([]);
await page.reload();
await page.waitForTimeout(1200);

// ---------- 18. the pill recognises a recurring line in a BLOCK ----------
await api.recurring([{ id: "postoffice", text: "Post office", weekdays: [0], target: "morning" }]);
await api.put("2026-01-05", { day: 0, blocks: { morning: "Post office" }, todos: [] });   // Monday
await page.reload();
await page.waitForTimeout(1500);
await setDate(page, "2026-01-05");
await page.waitForTimeout(1500);

const pickInMorning = phrase => page.$eval('textarea[data-key="morning"]', (el, p) => {
  const at = el.value.indexOf(p);
  el.focus();
  el.setSelectionRange(at, at + p.length);
  el.dispatchEvent(new Event("select", { bubbles: true }));
}, phrase);

await pickInMorning("Post office");
await page.waitForTimeout(400);
check("block-pill: a recurring line offers Edit and Delete recurring",
  (await page.isVisible("#pillEditRecurring")) && (await page.isVisible("#pillDeleteRecurring")));
check("block-pill: and NOT 'Make recurring' (it already is)",
  !(await page.isVisible("#pillRecurring")));

// Plain text in the same block still offers Make recurring.
await page.fill('textarea[data-key="morning"]', "Post office\nBuy stamps");
await page.waitForTimeout(1200);
await pickInMorning("Buy stamps");
await page.waitForTimeout(400);
check("block-pill: ordinary text in the block still offers Make recurring",
  (await page.isVisible("#pillRecurring")) && !(await page.isVisible("#pillEditRecurring")));

// Edit opens on the right item.
await pickInMorning("Post office");
await page.waitForTimeout(400);
await page.click("#pillEditRecurring");
await page.waitForTimeout(700);
check("block-pill: Edit opens the editor on that item",
  await page.evaluate(() => {
    const row = document.activeElement?.closest?.(".recur-row");
    return row?.dataset.id === "postoffice";
  }));
await page.click("#recurClose");
await page.waitForTimeout(400);

// Delete recurring stops it on future days.
page.once("dialog", d => d.accept());
await pickInMorning("Post office");
await page.waitForTimeout(400);
await page.click("#pillDeleteRecurring");
await page.waitForTimeout(2000);
const afterDel = (await fetch(`${U}/api/recurring`, { headers: H }).then(r => r.json())).items || [];
check("block-pill: Delete recurring removes it from the list", afterDel.length === 0, JSON.stringify(afterDel));

await setDate(page, "2026-01-12");                    // the following Monday
await page.waitForTimeout(1800);
check("block-pill: it no longer comes back in Morning",
  !(await page.inputValue('textarea[data-key="morning"]')).includes("Post office"),
  await page.inputValue('textarea[data-key="morning"]'));

await api.recurring([]);
await page.reload();
await page.waitForTimeout(1200);

// ---------- 19. printing: landscape, one page, nothing lost ----------
await api.recurring([]);
await api.put("2026-01-19", {
  day: 0,
  blocks: {
    morning: "Gym, then dentist at 10.\nCall the plumber back.",
    afternoon: "Deep work: finish the Q3 deck.",
    evening: "Swimming, 6pm",
    // long enough to scroll out of sight inside the textarea on screen
    notes: Array.from({ length: 8 }, (_, i) => `Note line ${i + 1}`).join("\n")
  },
  todos: Array.from({ length: 6 }, (_, i) => ({ checked: i === 0, text: `To-do ${i + 1}` }))
});
await page.reload();
await page.waitForTimeout(1500);
await setDate(page, "2026-01-19");
await page.waitForTimeout(1500);

const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
const raw = Buffer.from(pdf).toString("latin1");

const pages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;
check("print: fits on a single page", pages === 1, `${pages} pages`);

const box = raw.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
const [w, h] = box ? [parseFloat(box[1]), parseFloat(box[2])] : [0, 0];
check("print: landscape (wider than tall)", w > h, `${Math.round(w)}x${Math.round(h)}`);

// The chrome must not print, and the content must.
await page.emulateMedia({ media: "print" });
await page.waitForTimeout(300);
const printed = await page.evaluate(() => ({
  toolbar: getComputedStyle(document.querySelector(".toolbar")).display,
  textarea: getComputedStyle(document.querySelector('textarea[data-key="notes"]')).display,
  mirror: getComputedStyle(document.querySelector('[data-print="notes"]')).display,
  mirrorText: document.querySelector('[data-print="notes"]').textContent,
  grips: getComputedStyle(document.querySelector(".grip")).display
}));
check("print: toolbar not printed", printed.toolbar === "none", printed.toolbar);
check("print: drag handles not printed", printed.grips === "none", printed.grips);
check("print: the textarea is replaced by a printable mirror",
  printed.textarea === "none" && printed.mirror === "block",
  `textarea=${printed.textarea} mirror=${printed.mirror}`);
check("print: long block text isn't cut off (all 8 lines present)",
  printed.mirrorText.includes("Note line 1") && printed.mirrorText.includes("Note line 8"));
// Clear the override rather than forcing "screen": an explicit media override persists
// and page.pdf() honours it, so the PDF below would be rendered with screen styles —
// where the sheet is deliberately one viewport tall — and could never spill to page 2.
await page.emulateMedia({ media: null });
await page.waitForTimeout(300);

// Adding a lot of rows is allowed to spill onto a second page — that's the "unless".
await page.evaluate(() => {
  const el = document.querySelector('textarea[data-key="notes"]');
  el.value = Array.from({ length: 60 }, (_, i) => `Overflow line ${i + 1}`).join("\n");
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(1200);
const bigPdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
const bigPages = (Buffer.from(bigPdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
check("print: it does grow past one page when there's genuinely more to print",
  bigPages >= 2, `${bigPages} pages`);

await page.reload();
await page.waitForTimeout(1200);

// ---------- 20. clicking a weekday jumps within the week you're on ----------
await api.put("2026-06-03", { day: 2, blocks: { morning: "Wednesday of that week" }, todos: [] });
await api.put("2026-06-07", { day: 6, blocks: { morning: "Sunday of that week" }, todos: [] });
await page.reload();
await page.waitForTimeout(1500);

const shownDate = () => page.evaluate(() =>
  `${document.getElementById("yy").value}-${document.getElementById("mm").value}-${document.getElementById("dd").value}`);

await setDate(page, "2026-06-05");             // a Friday
await page.waitForTimeout(1200);

await page.click('.days button[data-idx="2"]');   // W
await page.waitForTimeout(1500);
check("weekdays: clicking W goes to Wednesday of THAT week", (await shownDate()) === "2026-06-03",
  await shownDate());
check("weekdays: and loads that day's entries",
  (await page.inputValue('textarea[data-key="morning"]')) === "Wednesday of that week");

await page.click('.days button[data-idx="6"]');   // S (Sunday)
await page.waitForTimeout(1500);
check("weekdays: clicking Sunday goes forward within the same week",
  (await shownDate()) === "2026-06-07", await shownDate());
check("weekdays: and loads that day",
  (await page.inputValue('textarea[data-key="morning"]')) === "Sunday of that week");

check("weekdays: the clicked day is the one marked active",
  await page.evaluate(() =>
    [...document.querySelectorAll(".days button[data-idx]")].findIndex(b => b.getAttribute("aria-current") === "date") === 6));

// A week that straddles a month boundary: Mon 30 Nov 2026 .. Sun 6 Dec 2026.
await setDate(page, "2026-12-02");             // Wednesday 2 Dec
await page.waitForTimeout(1200);
await page.click('.days button[data-idx="0"]');   // M
await page.waitForTimeout(1500);
check("weekdays: it steps back across a month boundary, not to the 1st of the month",
  (await shownDate()) === "2026-11-30", await shownDate());

// Clicking the day you're already on shouldn't move.
await page.click('.days button[data-idx="0"]');
await page.waitForTimeout(1000);
check("weekdays: clicking the current day stays put", (await shownDate()) === "2026-11-30",
  await shownDate());

// ---------- 21. week arrows ----------
await api.put("2026-06-10", { day: 2, blocks: { morning: "the next Wednesday" }, todos: [] });
await page.reload();
await page.waitForTimeout(1500);
await setDate(page, "2026-06-03");              // Wednesday 3 June
await page.waitForTimeout(1200);

await page.click("#nextWeek");
await page.waitForTimeout(1500);
check("weeks: next week keeps the weekday (Wed -> Wed)", (await shownDate()) === "2026-06-10",
  await shownDate());
check("weeks: and loads that day",
  (await page.inputValue('textarea[data-key="morning"]')) === "the next Wednesday");
check("weeks: the marker still says Wednesday",
  await page.evaluate(() =>
    [...document.querySelectorAll(".days button[data-idx]")].findIndex(b => b.getAttribute("aria-current") === "date") === 2));

await page.click("#prevWeek");
await page.waitForTimeout(1500);
check("weeks: previous week goes back seven days", (await shownDate()) === "2026-06-03",
  await shownDate());

// Across a month boundary.
await setDate(page, "2026-12-02");              // Wednesday 2 December
await page.waitForTimeout(1200);
await page.click("#prevWeek");
await page.waitForTimeout(1500);
check("weeks: it crosses a month boundary (2 Dec -> 25 Nov)", (await shownDate()) === "2026-11-25",
  await shownDate());

// The week arrows and the day arrows are different controls.
await page.click("#prevDay");
await page.waitForTimeout(1500);
check("weeks: the day arrow still moves one day, not seven", (await shownDate()) === "2026-11-24",
  await shownDate());

// ---------- 22. honest failure ----------
await page.route("**/api/day**", r => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }));
await setDate(page, "2026-10-01");
await typeMorning(page, "server is broken");
await page.waitForTimeout(1500);
const failed = await status(page);
check("failure: status names the reason", failed.toLowerCase().includes("failed"), failed);
check("failure: says data is kept locally", failed.toLowerCase().includes("kept"), failed);
check("failure: Retry button offered", await page.isVisible("#retryBtn"));
check("failure: edit stays queued, not lost", !!(await outbox(page))["2026-10-01"]);
await page.unroute("**/api/day**");
await page.click("#retryBtn");
await page.waitForTimeout(2000);
check("failure: Retry saves once the server is back",
  (await api.get("2026-10-01")).data?.blocks?.morning === "server is broken");

// ---------- 23. Enter goes down a line ----------
// Each to-do row is its own <input>, so Enter used to do nothing at all — you had to
// reach for the mouse to keep writing. On paper you just carry on down the list.
// A date no other test touches — 2026-04-06 already has "Keep me" on row 2 from the
// recurring tests, and typing into it appended rather than replaced.
await setDate(page, "2026-10-20");
await page.waitForTimeout(1200);

const rowInput = n => `#todo-list li:nth-child(${n}) input[type=text]`;
const focusedIndex = () => page.evaluate(() =>
  [...document.querySelectorAll("#todo-list li input[type=text]")].indexOf(document.activeElement));

await page.click(rowInput(1));
await page.keyboard.type("milk");
await page.keyboard.press("Enter");
check("enter: moves to the next row", (await focusedIndex()) === 1, String(await focusedIndex()));

await page.keyboard.type("bread");
await page.keyboard.press("Enter");
await page.keyboard.type("eggs");
await page.waitForTimeout(1200);
const typed = await todoTexts(page);
check("enter: you can write a list without touching the mouse",
  typed[0] === "milk" && typed[1] === "bread" && typed[2] === "eggs", JSON.stringify(typed.slice(0, 3)));
check("enter: the list is saved", (await api.get("2026-10-20")).data?.todos?.[1]?.text === "bread");

// Enter on an existing line puts the caret at the END of the next one — you're carrying
// on down the list, not editing what's already written there.
await page.click(rowInput(1));
await page.keyboard.press("Enter");
const caret = await page.evaluate(() => document.activeElement.selectionStart);
check("enter: caret lands at the end of the next line, not the start", caret === "bread".length, String(caret));

// The page has 17 ruled lines. Enter on the last one adds another and the list scrolls —
// you can write past the bottom of the page.
const listState = () => page.evaluate(() => {
  const ul = document.querySelector("#todo-list");
  return {
    rows: ul.children.length,
    rowH: Math.round(ul.children[0].getBoundingClientRect().height),
    scrollbar: ul.scrollHeight > ul.clientHeight + 1
  };
});

const before = await listState();
check("enter: 17 rows fill the page exactly, with no scrollbar", before.rows === 17 && !before.scrollbar,
  JSON.stringify(before));

await page.click(rowInput(17));
await page.keyboard.type("past the bottom");
await page.keyboard.press("Enter");
await page.waitForTimeout(150);                  // the new row appears on the next render
const after = await listState();
check("enter: the last row adds a new one", after.rows === 18, JSON.stringify(after));
check("enter: and focus lands on it", (await focusedIndex()) === 17, String(await focusedIndex()));
check("enter: and the list now scrolls", after.scrollbar, JSON.stringify(after));

// The old row must not collect stray characters typed in the gap before focus moves.
// (It used to: the first letter after Enter was appended to the line you had just left.)
check("enter: the line you left is untouched",
  (await todoTexts(page)).includes("past the bottom"), JSON.stringify(await todoTexts(page)));

// The lines must not re-space under your cursor while you write. A ruled line is a ruled
// line; the page scrolls instead of the rows shrinking to make room.
check("enter: the existing rows keep their height", after.rowH === before.rowH,
  `${before.rowH} -> ${after.rowH}`);

await page.keyboard.type("and another");
await page.waitForTimeout(1200);
const grown = (await api.get("2026-10-20")).data?.todos || [];
check("enter: the extra line is saved", grown[17]?.text === "and another",
  JSON.stringify(grown.slice(16, 18)));

// ---------- 24. search ----------
// /api/search had NO coverage before this: #searchBtn appeared in this file exactly
// once, to measure a bounding box. Two pieces of genuinely subtle logic live in there
// (LIKE-wildcard escaping, and re-checking every row against real field values so a
// hit on JSON punctuation doesn't count), and lib/search.js now shares them with the
// demo's fake server. Refactoring untested subtle code is how you get a silent break.

// A day whose text contains a literal "%", and a day that would be a FALSE hit if the
// query's "%" were treated as a SQL wildcard: LIKE '%a%c%' matches "abc".
await api.put("2026-05-11", { day: 0, blocks: { morning: "took a%c to the vet" }, todos: [], applied: [] });
await api.put("2026-05-12", { day: 1, blocks: { morning: "abc reading group" }, todos: [], applied: [] });

const hits = await api.search("a%c");
const dates = hits.results?.map(r => r.date) || [];
check("search: a literal % matches literally", dates.includes("2026-05-11"), JSON.stringify(dates));
check("search: % is escaped, not treated as a wildcard", !dates.includes("2026-05-12"), JSON.stringify(dates));

// The stored blob contains "checked" on every to-do and "todos" as a key. A LIKE over
// the blob hits both. Neither is a thing anyone typed, so neither may be returned.
const syntax = await api.search("checked");
check("search: a hit on JSON syntax is not a hit", (syntax.results || []).length === 0,
  JSON.stringify((syntax.results || []).map(r => r.date)));

// The shape SearchDialog.jsx:55 actually consumes: r.date, and r.snippets[].text.
const plain = await api.search("dentist");
const hit = (plain.results || []).find(r => r.date === "2026-08-05");
check("search: finds a day by its typed text", !!hit, JSON.stringify(plain.results));
check("search: returns the snippet contract the dialog reads",
  !!hit && Array.isArray(hit.snippets) && typeof hit.snippets[0]?.text === "string",
  JSON.stringify(hit?.snippets));
check("search: the snippet contains the match", !!hit && hit.snippets[0].text.includes("dentist"),
  hit?.snippets?.[0]?.text);

// And through the real dialog, not just the endpoint.
await page.click("#searchBtn");
await page.fill("#searchInput", "dentist");
await page.waitForTimeout(1200);
check("search: the dialog lists the matching day",
  await page.isVisible('#searchResults li[data-date="2026-08-05"]'));
await page.click('#searchResults li[data-date="2026-08-05"]');
await page.waitForTimeout(1200);
check("search: picking a result navigates to that day", (await shownDate()) === "2026-08-05",
  await shownDate());

// ---------- 25. "Today" jumps home ----------
// You can step a day or a week, but paging weeks away used to strand you: the only way
// back was retyping the whole date. The button appears only when you're somewhere else —
// on today it would do nothing, so it isn't drawn.
const pad = n => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

await setDate(page, "2026-08-05");
await page.waitForTimeout(400);
check("today: the button is offered when you're not on today", await page.isVisible("#todayBtn"));
await page.click("#todayBtn");
await page.waitForTimeout(1200);
check("today: clicking it jumps straight to today", (await shownDate()) === today, await shownDate());
check("today: and it hides once you're there", !(await page.isVisible("#todayBtn")));

// ---------- 26. Undo a Clear ----------
// Clear was the one action that broke the app's promise that nothing is silently lost —
// a confirm, and then it was gone for good. Now the cleared day can be taken back, on
// screen AND on the server, until you leave the day or write on it.
await setDate(page, "2026-11-05");
await typeMorning(page, "hold onto this");
await page.click(rowInput(1));
await page.keyboard.type("and this too");
await page.waitForTimeout(1200);

page.once("dialog", d => d.accept());                                      // the Clear confirm
await page.click("#clearBtn");
await page.waitForTimeout(1200);
check("undo: Clear empties the sheet",
  (await page.inputValue('textarea[data-key="morning"]')) === "" && (await todoTexts(page)).length === 0,
  JSON.stringify(await todoTexts(page)));
check("undo: Clear reaches the server", !(await api.get("2026-11-05")).data?.blocks?.morning,
  JSON.stringify((await api.get("2026-11-05")).data?.blocks));
check("undo: the Undo offer appears", await page.isVisible("#undoClearBtn"));

await page.click("#undoClearBtn");
await page.waitForTimeout(1200);
check("undo: it brings the cleared day back on screen",
  (await page.inputValue('textarea[data-key="morning"]')) === "hold onto this"
    && (await todoTexts(page)).includes("and this too"), JSON.stringify(await todoTexts(page)));
check("undo: and restores it on the server too",
  (await api.get("2026-11-05")).data?.blocks?.morning === "hold onto this",
  JSON.stringify((await api.get("2026-11-05")).data?.blocks));
check("undo: the offer clears once taken", !(await page.isVisible("#undoClearBtn")));

// The offer belongs to the day you cleared. Leaving that day withdraws it.
page.once("dialog", d => d.accept());
await page.click("#clearBtn");
await page.waitForTimeout(600);
check("undo: offered again after another clear", await page.isVisible("#undoClearBtn"));
await page.click("#nextDay");
await page.waitForTimeout(1200);
check("undo: leaving the day withdraws the offer", !(await page.isVisible("#undoClearBtn")));

await browser.close();

const bad = results.filter(r => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
if (bad.length) {
  console.log("FAILURES:\n" + bad.map(f => " - " + f.name).join("\n"));
  process.exit(1);
}
