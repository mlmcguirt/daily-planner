// Sync layer — framework-agnostic. No DOM, no Preact.
//
// This is the part of the app that can lose your data, so it is deliberately kept
// out of the UI and away from rewrites. The behaviour here is ported unchanged from
// the vanilla build, where it was verified end-to-end in a browser:
//
//   * Every edit goes into an OUTBOX in localStorage and is only dropped once the
//     server confirms it — so an edit made offline survives a reload or a tab close
//     and syncs on reconnect.
//   * `updated_at` doubles as a version. A PUT carries the version it was based on;
//     if the row has moved on, the server answers 409 and the user chooses. Nothing
//     is ever silently overwritten.
//   * Versions are tracked PER DATE. A single global goes stale the moment you change
//     days while offline (the fetch fails, the value lingers) and produces phantom
//     conflicts for days nobody else touched.
//   * A 409 whose server content EQUALS what we sent is a success, not a conflict:
//     our write landed and only the confirmation was lost. This also covers two tabs
//     sharing one outbox.
//
// localStorage keys are load-bearing for compatibility with already-installed copies
// of the app — do not rename them.
//   planner:key                 the passphrase
//   planner:outbox:<key>        { [date]: {data, base, force, conflict, server, queued_at} }
//   planner:ver:<key>           { [date]: updated_at }   last server version seen
//   planner:<key>:<date>        last known day content (offline fallback)
//   planner:recurring:<key>     cached recurring list

import { sameDay } from "./day.js";

const MAX_BACKOFF = 60000;

export function createSync(key) {
  const obKey = `planner:outbox:${key}`;
  const verKey = `planner:ver:${key}`;
  const dayKey = date => `planner:${key}:${date}`;
  const recurKey = `planner:recurring:${key}`;

  let flushing = false;
  let retryTimer = null;
  let retryDelay = 0;
  let lastError = null;
  let lastSavedAt = null;

  const listeners = new Set();
  let onConflict = () => {};

  const readJSON = (k, fallback) => {
    try { return JSON.parse(localStorage.getItem(k) || fallback); } catch { return JSON.parse(fallback); }
  };
  const readOutbox = () => readJSON(obKey, "{}");
  const writeOutbox = o => localStorage.setItem(obKey, JSON.stringify(o));
  const readVersions = () => readJSON(verKey, "{}");

  function getVersion(date) {
    const v = readVersions()[date];
    return v === undefined ? null : v;
  }
  function setVersion(date, updated_at) {
    const v = readVersions();
    if (updated_at === null || updated_at === undefined) delete v[date];
    else v[date] = updated_at;
    localStorage.setItem(verKey, JSON.stringify(v));
  }

  const headers = extra => ({ "X-Planner-Key": key, ...extra });

  function status() {
    const o = readOutbox();
    const entries = Object.values(o);
    return {
      pending: entries.length,
      conflicts: entries.filter(e => e.conflict).length,
      online: navigator.onLine,
      lastError,
      lastSavedAt
    };
  }
  const emit = () => listeners.forEach(fn => fn(status()));

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // ---- local copies -------------------------------------------------------
  function localDay(date) {
    const raw = localStorage.getItem(dayKey(date));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  const saveLocal = (date, data) => localStorage.setItem(dayKey(date), JSON.stringify(data));

  // ---- outbox -------------------------------------------------------------
  function enqueue(date, data) {
    const o = readOutbox();
    const prev = o[date];
    o[date] = {
      data,
      // keep the version the queued edits were originally based on
      base: prev ? prev.base : getVersion(date),
      force: prev ? !!prev.force : false,
      conflict: prev ? !!prev.conflict : false,
      server: prev ? prev.server : null,
      queued_at: String(Date.now()) + Math.random().toString(16).slice(2, 6)
    };
    writeOutbox(o);
    saveLocal(date, data);
    emit();
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryDelay = retryDelay ? Math.min(retryDelay * 2, MAX_BACKOFF) : 2000;
    retryTimer = setTimeout(flush, retryDelay);
  }

  async function flush() {
    if (flushing || !key) return;
    flushing = true;
    try {
      for (const date of Object.keys(readOutbox())) {
        const entry = readOutbox()[date];
        if (!entry || entry.conflict) continue;   // conflicts wait for the user

        let r;
        try {
          r = await fetch(`/api/day?date=${date}`, {
            method: "PUT",
            headers: headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ data: entry.data, base: entry.base, force: entry.force })
          });
        } catch {
          scheduleRetry();                        // offline: everything stays queued
          return;
        }

        if (r.ok) {
          const j = await r.json();
          setVersion(date, j.updated_at);
          const o = readOutbox();
          // only drop it if it wasn't edited again while the request was in flight
          if (o[date] && o[date].queued_at === entry.queued_at) { delete o[date]; writeOutbox(o); }
          else if (o[date]) { o[date].base = j.updated_at; o[date].force = false; writeOutbox(o); }
          lastError = null; lastSavedAt = new Date(); retryDelay = 0;
        } else if (r.status === 409) {
          const j = await r.json().catch(() => ({}));
          if (j.server) setVersion(date, j.server.updated_at);
          const o = readOutbox();
          if (!o[date]) continue;                 // resolved elsewhere while in flight

          // Our write already landed; only the confirmation was lost. The server holds
          // exactly what we meant to say, so there is nothing to reconcile.
          if (j.server && sameDay(j.server.data, entry.data)) {
            if (o[date].queued_at === entry.queued_at) { delete o[date]; writeOutbox(o); }
            lastError = null; lastSavedAt = new Date(); retryDelay = 0;
            continue;
          }

          o[date].conflict = true;
          o[date].server = j.server || null;
          writeOutbox(o);
          onConflict(date);
        } else {
          const j = await r.json().catch(() => ({}));
          lastError = j.error || `${r.status} ${r.statusText}`;
          scheduleRetry();
          return;
        }
      }
    } finally {
      flushing = false;
      emit();
    }
  }

  // ---- reads --------------------------------------------------------------
  // Returns what to show now, and whether it came from the server.
  async function fetchDay(date) {
    try {
      const r = await fetch(`/api/day?date=${date}`, { headers: headers() });
      if (!r.ok) return { ok: false };
      const j = await r.json();
      setVersion(date, j.updated_at);
      if (j.data) saveLocal(date, j.data);
      return { ok: true, data: j.data, updated_at: j.updated_at };
    } catch {
      return { ok: false };                       // offline: caller falls back to local
    }
  }

  // Best available copy of a day, without hitting the network if we don't have to.
  async function anyDay(date) {
    const queued = readOutbox()[date];
    if (queued) return queued.data;
    const local = localDay(date);
    if (local) return local;
    const r = await fetchDay(date);
    return r.ok ? r.data : null;
  }

  // ---- conflict resolution ------------------------------------------------
  function conflictFor(date) {
    const e = readOutbox()[date];
    if (!e || !e.conflict) return null;
    return { date, mine: e.data, theirs: e.server ? e.server.data : null };
  }
  function nextConflict() {
    const o = readOutbox();
    const date = Object.keys(o).find(d => o[d].conflict);
    return date ? conflictFor(date) : null;
  }
  function keepMine(date) {
    const o = readOutbox(), e = o[date];
    if (e) {
      e.conflict = false;
      e.force = true;                             // deliberate overwrite, chosen by the user
      e.base = e.server ? e.server.updated_at : null;
      writeOutbox(o);
    }
    retryDelay = 0;
    flush();
  }
  // Returns their version so the caller can put it on screen.
  function useTheirs(date) {
    const o = readOutbox(), e = o[date];
    const server = e ? e.server : null;
    if (e) { delete o[date]; writeOutbox(o); }
    setVersion(date, server ? server.updated_at : null);
    if (server) saveLocal(date, server.data);
    else localStorage.removeItem(dayKey(date));
    emit();
    flush();
    return server ? server.data : null;
  }

  // ---- recurring ----------------------------------------------------------
  async function getRecurring() {
    let cached = [];
    try { cached = JSON.parse(localStorage.getItem(recurKey) || "[]"); } catch {}
    try {
      const r = await fetch("/api/recurring", { headers: headers() });
      if (r.ok) {
        const items = (await r.json()).items || [];
        localStorage.setItem(recurKey, JSON.stringify(items));
        return items;
      }
    } catch { /* offline: the cached list is fine */ }
    return cached;
  }
  async function putRecurring(items) {
    const r = await fetch("/api/recurring", {
      method: "PUT",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ items })
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || r.statusText);
    }
    const saved = (await r.json()).items || [];
    localStorage.setItem(recurKey, JSON.stringify(saved));
    return saved;
  }

  // ---- export -------------------------------------------------------------
  // A full copy of this planner — every day and the recurring list — for the owner to
  // keep. The passphrase is the only key and there's no reset, so a downloadable backup
  // is the one guard against a mistyped passphrase (or a cleared browser) taking
  // everything with it. Read-only; goes through the same shimmed fetch as everything else,
  // so it works untouched in the demo.
  async function exportAll() {
    const r = await fetch("/api/export", { headers: headers() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  // ---- search -------------------------------------------------------------
  async function search(q) {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: headers() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j.results || [];
  }

  // ---- wiring -------------------------------------------------------------
  const onOnline = () => { retryDelay = 0; lastError = null; emit(); flush(); };
  const onOffline = () => emit();
  // Another tab shares this outbox; keep our status honest when it syncs.
  const onStorage = e => { if (e.key === obKey) emit(); };

  addEventListener("online", onOnline);
  addEventListener("offline", onOffline);
  addEventListener("storage", onStorage);

  function destroy() {
    removeEventListener("online", onOnline);
    removeEventListener("offline", onOffline);
    removeEventListener("storage", onStorage);
    clearTimeout(retryTimer);
    listeners.clear();
  }

  // The unsent edit for a date, if any — fresher than anything on the server.
  const queuedDay = date => {
    const e = readOutbox()[date];
    return e ? e.data : null;
  };

  return {
    enqueue, flush, fetchDay, anyDay, localDay, queuedDay,
    getVersion, status, subscribe, destroy,
    conflictFor, nextConflict, keepMine, useTheirs,
    getRecurring, putRecurring, search, exportAll,
    retryNow: () => { retryDelay = 0; lastError = null; emit(); flush(); },
    set onConflict(fn) { onConflict = fn; }
  };
}
