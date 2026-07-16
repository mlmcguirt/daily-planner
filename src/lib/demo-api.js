// The demo's fake server. Demo builds only — never ships to production.
//
// THE IDEA
//
// The obvious way to build a no-backend demo is to write a second sync layer: a
// createLocalSync() exporting the same 19 members as createSync(), with hand-written
// status(), a reimplemented search, and no-op conflict stubs. Don't. That means ~200
// lines duplicating the one module CLAUDE.md says has hidden two data-loss bugs, with
// no tests, drifting silently every time app.jsx changes.
//
// Invert it. Keep the REAL sync layer and fake the network instead:
//
//   app.jsx -> createSync() -> fetch() -> demo-api.js -> localStorage
//              ^^^^^^^^^^^^ completely untouched, zero diff
//
// So the demo runs the actual outbox, the actual flush, the actual per-date version
// tracking. The engineering worth bragging about is the engineering being demonstrated,
// not a stub pretending to be it. And it cannot rot: any future change to how app.jsx
// consumes sync flows through here unchanged, because the interface is the same object.
//
// THREE RULES THIS FILE MUST NEVER BREAK
//
//  1. NEVER THROW. sync.js:132-134 catches a throw from fetch as "you are offline" and
//     schedules a retry — forever. The demo would sit on "Saving… (1)" and never move.
//     Every path here returns a real Response, including ones we don't recognise.
//
//  2. NEVER RETURN 409. A conflict dialog in a demo with one device and no server is an
//     obvious bug to every visitor. Always accept the PUT, always hand back a fresh
//     updated_at (sync.js:139 reads it; returning nothing DELETES the version via
//     sync.js:60 and corrupts the next save).
//
//  3. USE OUR OWN KEY NAMESPACE. The "server" rows live under demo:day:*, never under
//     planner:<key>:<date> — those belong to sync.js, which writes them (sync.js:91) and
//     deletes them (sync.js:230) as its own local cache. Sharing the keys would mean the
//     client is quietly editing the server's database.

import { snippetsFor } from "../../lib/search.js";
import { todayStr, shiftDate } from "./day.js";

// The passphrase namespaces every planner:* key, so the demo needs one even though it
// never shows the gate. main.jsx seeds planner:key with this before rendering.
export const DEMO_KEY = "demo";

// The string check-bundle.mjs greps dist/ for. If this literal ever reaches the
// production bundle, the build fails. Identifiers get minified; string literals don't.
const DEMO_MARKER = "gstack-demo-api/v1";

const dayKey = date => `demo:day:${date}`;
const RECUR_KEY = "demo:recurring";
const seededKey = date => `demo:seeded:${date}`;

const read = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
};
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota: the demo is not worth crashing over */ }
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// ---- the seeded day ------------------------------------------------------------
//
// A stranger's first impression, the source of both README screenshots, and the proof
// that the handwriting font works. It is a deliverable, not a fixture.
//
// Seeding is PER DATE, not once. app.jsx:29 always opens on todayStr(). Seed a single
// date and tomorrow a visitor gets a blank sheet — and then app.jsx:83 -> refreshCarry
// -> isUntouched passes on the empty day -> finds yesterday's seed -> renders
// "Carry over 4 unfinished from 07/12" across an empty planner. The demo would rot in
// 24 hours, by construction.

const seedFor = offset => {
  if (offset === 0) return {
    blocks: {
      morning: "Draft the Q3 letter\nCall the dentist back",
      afternoon: "Review the lease redlines\nCoffee with Sam, 4pm",
      evening: "Pick up the dry cleaning\nDinner with Ruth, 7:30",
      notes: "The good pens are in the second drawer"
    },
    todos: [
      { checked: false, text: "Book the flights" },
      { checked: true, text: "Pay the electric bill" },
      { checked: false, text: "Reply to Ana about the lease" },
      { checked: true, text: "Renew the parking permit" },
      { checked: false, text: "Water the fig tree" },
      { checked: false, text: "Find the passport" },
      { checked: false, text: "Cancel the gym trial" }
    ]
  };
  if (offset === -1) return {
    blocks: { morning: "Team standup", afternoon: "", evening: "", notes: "" },
    todos: [
      { checked: true, text: "Send the invoice" },
      { checked: false, text: "Chase the plumber" }
    ]
  };
  return {
    blocks: { morning: "Train to Leeds, 8:04", afternoon: "", evening: "", notes: "" },
    todos: [{ checked: false, text: "Print the tickets" }]
  };
};

// Daily, so it is visible whatever day someone visits. It is NOT written into the
// seeded todos — mergeRecurring puts it on the sheet at render time, which is what
// gives it the dashed underline that marks a recurring row.
const SEED_RECURRING = [
  { id: "demo-r1", text: "Read 20 pages", weekdays: [0, 1, 2, 3, 4, 5, 6], target: "todo" }
];

const buildDay = (date, weekday, offset) => {
  const s = seedFor(offset);
  return {
    day: weekday,
    blocks: { morning: "", afternoon: "", evening: "", notes: "", ...s.blocks },
    todos: s.todos,
    applied: []
  };
};

// Runs on every load, before render. Fills in any of today / yesterday / tomorrow that
// this visitor has not already been given — so the sheet is never blank, and the day
// arrows always land on something.
//
// Clearing still sticks: doClear (app.jsx:134) empties the day, but the date is already
// marked seeded, so a reload does not silently un-clear it.
export function seedDemo() {
  if (!read(RECUR_KEY, null)) write(RECUR_KEY, SEED_RECURRING);

  const today = todayStr();

  for (const offset of [-1, 0, 1]) {
    const date = shiftDate(today, offset);
    if (read(seededKey(date), false)) continue;
    write(seededKey(date), true);

    const [y, m, d] = date.split("-").map(Number);
    const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7;
    const day = buildDay(date, weekday, offset);

    if (offset === 0) {
      // TODAY goes into the OUTBOX, not straight into the fake server.
      //
      // A fresh createSync has lastSavedAt = null, so Toolbar.jsx:48 renders "Synced" —
      // a lie in an app with no server, in a file whose own comment reads "Say what is
      // actually true." Putting the seed in the outbox means app.jsx:98's existing
      // flush-on-mount PUTs it here, we answer 200, sync.js:144 sets lastSavedAt, and
      // the status line settles on "Saved HH:MM" — honestly, and with zero diff to
      // sync.js AND zero diff to Toolbar.jsx.
      //
      // It also means the demo genuinely demonstrates the outbox draining, which is the
      // whole thing we want people to look at.
      write(`planner:${DEMO_KEY}:${date}`, day);                    // the local copy sync.js reads
      write(`planner:outbox:${DEMO_KEY}`, {
        [date]: { data: day, base: null, force: false, conflict: false, server: null, queued_at: "seed" }
      });
    } else {
      write(dayKey(date), { data: day, updated_at: new Date(y, m - 1, d, 9).toISOString() });
    }
  }
}

// Wipes everything this demo owns, so "Reset demo" puts the visitor back on the
// seeded day. Deliberately does NOT touch planner:key — removing it would resurrect
// the passphrase gate the demo exists to bypass.
export function resetDemo() {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith("demo:") || (k.startsWith("planner:") && k !== "planner:key")) {
      localStorage.removeItem(k);
    }
  }
  seedDemo();
}

// ---- the fake server -----------------------------------------------------------

function handle(method, url) {
  const path = url.pathname;

  if (path === "/api/day") {
    const date = url.searchParams.get("date");
    if (!date) return json({ error: "Bad date" }, 400);

    if (method === "GET") {
      const row = read(dayKey(date), null);
      return json({ data: row ? row.data : null, updated_at: row ? row.updated_at : null });
    }
    // PUT is handled by the caller (it needs the body). See below.
  }

  if (path === "/api/recurring" && method === "GET") {
    return json({ items: read(RECUR_KEY, []) });
  }

  if (path === "/api/export" && method === "GET") {
    // Mirror the real /api/export from the demo's own "server" rows, so the backup button
    // works here too and cannot drift from production's shape (CLAUDE.md's must-stay-in-step
    // rule). The days live under demo:day:*, oldest-first like the API's ORDER BY day_date.
    const days = [];
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith("demo:day:")) continue;
      const row = read(k, null);
      if (!row || !row.data) continue;
      days.push({ date: k.slice("demo:day:".length), data: row.data, updated_at: row.updated_at });
    }
    days.sort((a, b) => (a.date < b.date ? -1 : 1));
    return json({ version: 1, exported_at: new Date().toISOString(), days, recurring: read(RECUR_KEY, []) });
  }

  if (path === "/api/search" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    if (q.length < 2) return json({ error: "Search for at least 2 characters" }, 400);

    const results = [];
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith("demo:day:")) continue;
      const row = read(k, null);
      if (!row || !row.data) continue;
      // Same hit test as the real API — lib/search.js, shared, so the demo's search
      // cannot behave differently from the app it is advertising.
      const snippets = snippetsFor(row.data, q);
      if (snippets.length) results.push({ date: k.slice("demo:day:".length), snippets });
    }
    results.sort((a, b) => (a.date < b.date ? 1 : -1));      // newest first, like the API
    return json({ results: results.slice(0, 50) });
  }

  return null;                                                // not ours
}

export function installDemoApi() {
  const real = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input, init = {}) => {
    let url;
    try {
      url = new URL(typeof input === "string" ? input : input.url, location.origin);
    } catch {
      return real(input, init);
    }

    if (!url.pathname.startsWith("/api/")) return real(input, init);

    const method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();

    // Everything below is wrapped: a throw here would be caught by sync.js as "offline"
    // and retried forever, leaving the demo stuck on "Saving… (1)". See rule 1 above.
    try {
      if (url.pathname === "/api/day" && method === "PUT") {
        const date = url.searchParams.get("date");
        if (!date) return json({ error: "Bad date" }, 400);

        const payload = JSON.parse(init.body || "{}");
        const data = "data" in payload ? payload.data : payload;

        // Always accept. Never 409. One device, no server, nothing to reconcile.
        const updated_at = new Date().toISOString();
        write(dayKey(date), { data, updated_at });
        return json({ ok: true, updated_at });
      }

      if (url.pathname === "/api/recurring" && method === "PUT") {
        const payload = JSON.parse(init.body || "{}");
        const items = Array.isArray(payload.items) ? payload.items : [];
        write(RECUR_KEY, items);
        return json({ ok: true, items });
      }

      const res = handle(method, url);
      if (res) return res;

      return json({ error: `No demo route for ${method} ${url.pathname}` }, 404);
    } catch (err) {
      // Should be unreachable. If it happens, say so out loud rather than letting the
      // demo silently retry into the void.
      console.error(`${DEMO_MARKER}: demo request failed`, err);
      return json({ error: "Demo error" }, 500);
    }
  };
}
