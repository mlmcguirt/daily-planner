// Cloudflare Pages Function -> served at /api/day
// GET  /api/day?date=YYYY-MM-DD   (with X-Planner-Key header) -> { data, updated_at }
// PUT  /api/day?date=YYYY-MM-DD   (with X-Planner-Key header) -> saves, returns { ok, updated_at }
//
// The passphrase is sent in the X-Planner-Key header, hashed to a "space"
// so the raw passphrase is never stored. Data is separated per space.
//
// PUT body is { data, base } where `base` is the updated_at the client last saw.
// If the stored row has moved on since then, another device saved in the meantime:
// we refuse with 409 and hand back the server's version rather than silently
// overwriting it. `base: null` means "no version seen" (first save of this day);
// force: true overwrites deliberately (used when the user picks "keep mine").

import { DATE_RE, json, spaceFromRequest } from "../../lib/planner.js";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const date = url.searchParams.get("date");

  const space = await spaceFromRequest(request);
  if (!space) return json({ error: "Missing planner key" }, 401);
  if (!date || !DATE_RE.test(date)) return json({ error: "Bad date" }, 400);

  if (request.method === "GET") {
    const row = await env.DB
      .prepare("SELECT data, updated_at FROM planner_days WHERE space = ? AND day_date = ?")
      .bind(space, date)
      .first();
    return json({
      data: row ? JSON.parse(row.data) : null,
      updated_at: row ? row.updated_at : null
    });
  }

  if (request.method === "PUT") {
    let payload;
    try { payload = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }
    if (!payload || typeof payload !== "object") return json({ error: "Bad JSON" }, 400);

    // Envelope { data, base, force } from current clients. A cached older client
    // PUTs the bare day object instead — treat that as an unconditional save so a
    // stale phone keeps working until its service worker picks up the new shell.
    const isEnvelope = "data" in payload;
    const data = isEnvelope ? payload.data : payload;
    const base = isEnvelope ? (payload.base ?? null) : null;
    const force = isEnvelope ? payload.force === true : true;

    const now = new Date().toISOString();
    const body = JSON.stringify(data);

    const current = await env.DB
      .prepare("SELECT data, updated_at FROM planner_days WHERE space = ? AND day_date = ?")
      .bind(space, date)
      .first();

    if (!current) {
      // No row yet. DO NOTHING guards the race where another device inserts first.
      const res = await env.DB
        .prepare(
          `INSERT INTO planner_days (space, day_date, data, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(space, day_date) DO NOTHING`
        )
        .bind(space, date, body, now)
        .run();
      if (res.meta.changes === 0) return conflict(env, space, date);
      return json({ ok: true, updated_at: now });
    }

    if (!force && base !== current.updated_at) {
      return json({
        error: "conflict",
        server: { data: JSON.parse(current.data), updated_at: current.updated_at }
      }, 409);
    }

    // Compare-and-set: the WHERE guards against a write landing between our read
    // and this update. force skips the version check but still writes atomically.
    const res = force
      ? await env.DB
          .prepare("UPDATE planner_days SET data = ?, updated_at = ? WHERE space = ? AND day_date = ?")
          .bind(body, now, space, date)
          .run()
      : await env.DB
          .prepare(
            "UPDATE planner_days SET data = ?, updated_at = ? WHERE space = ? AND day_date = ? AND updated_at = ?"
          )
          .bind(body, now, space, date, base)
          .run();

    if (res.meta.changes === 0) return conflict(env, space, date);
    return json({ ok: true, updated_at: now });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function conflict(env, space, date) {
  const row = await env.DB
    .prepare("SELECT data, updated_at FROM planner_days WHERE space = ? AND day_date = ?")
    .bind(space, date)
    .first();
  return json({
    error: "conflict",
    server: row ? { data: JSON.parse(row.data), updated_at: row.updated_at } : null
  }, 409);
}
