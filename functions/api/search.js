// Cloudflare Pages Function -> served at /api/search
// GET /api/search?q=text   (with X-Planner-Key header) -> { results: [{ date, snippets }] }
//
// The day's contents are stored as a JSON blob, so at this size a LIKE over the
// blob (scoped to your space) is enough — no need for a separate index table.
// The blob match can hit JSON punctuation/keys, so every row is re-checked
// against the actual field values before it's returned.
//
// That re-check — and the snippet trimming — live in lib/search.js, shared with
// the demo's fake server (src/lib/demo-api.js). One definition of what a hit is.

import { json, spaceFromRequest } from "../../lib/planner.js";
import { snippetsFor } from "../../lib/search.js";

const MAX_RESULTS = 50;

export async function onRequest(context) {
  const { request, env } = context;

  const space = await spaceFromRequest(request);
  if (!space) return json({ error: "Missing planner key" }, 401);
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (q.length < 2) return json({ error: "Search for at least 2 characters" }, 400);

  // LIKE treats % and _ as wildcards — escape them so a literal search stays literal.
  const escaped = q.toLowerCase().replace(/[\\%_]/g, c => "\\" + c);

  const { results: rows } = await env.DB
    .prepare(
      `SELECT day_date, data FROM planner_days
       WHERE space = ? AND lower(data) LIKE ? ESCAPE '\\'
       ORDER BY day_date DESC
       LIMIT ?`
    )
    .bind(space, `%${escaped}%`, MAX_RESULTS)
    .all();

  const results = [];

  for (const row of rows) {
    let day;
    try { day = JSON.parse(row.data); } catch { continue; }

    // Blob matched but no real field did — the hit was in JSON syntax, not content.
    const snippets = snippetsFor(day, q);
    if (snippets.length) results.push({ date: row.day_date, snippets });
  }

  return json({ results });
}
