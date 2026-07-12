// Cloudflare Pages Function -> served at /api/recurring
// GET /api/recurring   (with X-Planner-Key header) -> { items: [{ id, text, weekdays }] }
// PUT /api/recurring   (with X-Planner-Key header) -> replaces the whole list
//
// Recurring todos belong to the space, not to a day. The client merges them into
// the checklist when the weekday matches. weekdays is Mon=0 .. Sun=6, matching the
// M-T-W-T-F-S-S day selector in the UI.

import { json, spaceFromRequest } from "../../lib/planner.js";

const MAX_ITEMS = 50;
// Where a recurring item comes back: in the checklist, or in one of the day's blocks.
const TARGETS = ["todo", "morning", "afternoon", "evening", "notes"];

export async function onRequest(context) {
  const { request, env } = context;

  const space = await spaceFromRequest(request);
  if (!space) return json({ error: "Missing planner key" }, 401);

  if (request.method === "GET") {
    const { results } = await env.DB
      .prepare("SELECT id, text, weekdays, target FROM planner_recurring WHERE space = ? ORDER BY created_at")
      .bind(space)
      .all();
    return json({
      items: results.map(r => ({
        id: r.id,
        text: r.text,
        weekdays: r.weekdays.split(",").filter(s => s !== "").map(Number),
        target: TARGETS.includes(r.target) ? r.target : "todo"
      }))
    });
  }

  if (request.method === "PUT") {
    let payload;
    try { payload = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }

    const items = Array.isArray(payload && payload.items) ? payload.items : null;
    if (!items) return json({ error: "Expected { items: [] }" }, 400);
    if (items.length > MAX_ITEMS) return json({ error: `At most ${MAX_ITEMS} recurring items` }, 400);

    const clean = [];
    for (const item of items) {
      const text = String((item && item.text) || "").trim();
      const id = String((item && item.id) || "").trim();
      if (!text || !id) continue; // a blank row in the editor isn't an item
      const weekdays = (Array.isArray(item.weekdays) ? item.weekdays : [])
        .map(Number)
        .filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
      if (!weekdays.length) continue; // recurring on no day is just a todo
      const target = TARGETS.includes(item.target) ? item.target : "todo";
      clean.push({ id, text, weekdays: [...new Set(weekdays)].sort(), target });
    }

    const now = new Date().toISOString();
    // Whole-list replace: the editor always sends the full set, so anything absent
    // was deleted. Batched so a partial write can't leave a half-updated list.
    const stmts = [
      env.DB.prepare("DELETE FROM planner_recurring WHERE space = ?").bind(space),
      ...clean.map(item =>
        env.DB
          .prepare(
            "INSERT INTO planner_recurring (space, id, text, weekdays, target, created_at) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .bind(space, item.id, item.text, item.weekdays.join(","), item.target, now)
      )
    ];
    await env.DB.batch(stmts);

    return json({ ok: true, items: clean });
  }

  return json({ error: "Method not allowed" }, 405);
}
