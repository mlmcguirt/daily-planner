// Cloudflare Pages Function -> served at /api/export
// GET /api/export   (with X-Planner-Key header) -> a full backup of this planner:
//   { version, exported_at, days: [{ date, data, updated_at }], recurring: [{ id, text, weekdays, target }] }
//
// The passphrase IS the database key and there is no reset — a mistyped one silently
// opens a different, empty planner. So a downloadable copy is the one real guard against
// losing everything, and this endpoint is what produces it. Read-only: it never writes.

import { json, spaceFromRequest } from "../../lib/planner.js";

const TARGETS = ["todo", "morning", "afternoon", "evening", "notes"];

export async function onRequest(context) {
  const { request, env } = context;

  const space = await spaceFromRequest(request);
  if (!space) return json({ error: "Missing planner key" }, 401);
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const days = await env.DB
    .prepare("SELECT day_date, data, updated_at FROM planner_days WHERE space = ? ORDER BY day_date")
    .bind(space)
    .all();

  const recurring = await env.DB
    .prepare("SELECT id, text, weekdays, target FROM planner_recurring WHERE space = ? ORDER BY created_at")
    .bind(space)
    .all();

  return json({
    version: 1,
    exported_at: new Date().toISOString(),
    days: (days.results || []).map(r => ({
      date: r.day_date,
      data: JSON.parse(r.data),
      updated_at: r.updated_at
    })),
    // Same shape the app and /api/recurring use — weekdays as numbers, target validated.
    recurring: (recurring.results || []).map(r => ({
      id: r.id,
      text: r.text,
      weekdays: r.weekdays.split(",").filter(s => s !== "").map(Number),
      target: TARGETS.includes(r.target) ? r.target : "todo"
    }))
  });
}
