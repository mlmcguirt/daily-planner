# CLAUDE.md — Daily Planner project

Standing context for Claude Code. Read this before making changes or running deploys.

## What this is
A printable-style **daily planner as an installable PWA**, hosted on **Cloudflare Pages**, with entries stored in **Cloudflare D1** so the same planner syncs across the owner's phone and laptop. Code lives in a **GitHub** repo; Cloudflare auto-deploys on push.

There is also a **public demo** with no backend at all. Same app, fake server. See below — it is the thing most likely to trip you up.

**Deploy account:** `wrangler login` reuses whatever Cloudflare session the browser already has, so run `wrangler whoami` and confirm the account before believing anything is missing.

## Architecture

```
PRODUCTION — auto-deploys from GitHub on every push to main
  phone/laptop ──► Pages (Preact app, Vite → dist/) ──► Pages Functions /api/* ──► D1 (planner-db)
                        │                                     env.DB
                        └── createSync() ──► fetch ──► the real network

DEMO — manual, occasional, built in a throwaway git worktree, direct-uploaded
  visitor ─────► a separate Pages project
                        │
                        └── createSync() ──► fetch ──► src/lib/demo-api.js ──► localStorage
                            ^^^^^^^^^^^^      (patched, demo build only)
                            THE SAME CODE
                        the worktree has NO functions/ and NO wrangler.toml,
                        so /api/* does not exist and no bindings exist
```

The demo fakes the **server**, not the sync layer. That is the whole design: `src/lib/sync.js` runs untouched in both columns, so the demo exercises the real outbox, the real flush and the real version tracking. A demo that reimplemented the sync interface would drift silently the moment `app.jsx` changed, and would have needed its own copy of the module this file spends most of its length warning you about.

- **Frontend:** **Preact + Vite + Tailwind v4**. Day selector (M–S, derived from the date), MM/DD/YYYY date, Morning/Afternoon/Evening/Notes blocks, 17-row checklist. A **white** sheet inside an even cream border; the buttons live **in the border**, not on the sheet. **What the user types renders in a handwriting font (Caveat, self-hosted); all app chrome stays serif.**
- **Sync layer — the outbox.** Every edit is written to localStorage AND queued in an **outbox** (`planner:outbox:<key>`), one entry per date. It flushes on save, on reconnect (`online`), on app start, and on a backoff retry. **An entry is only dropped once the server confirms it**, so an edit made offline survives a reload or tab close and syncs later. Never "simplify" this back to fire-and-forget — that silently loses offline edits, which is the bug it exists to fix.
- **Conflicts.** `updated_at` doubles as a version. The client records the last server version it saw **per date** (`planner:ver:<key>` — it must be per-date; a single global goes stale when you change days while offline and produces phantom conflicts). A PUT sends that version as `base`; if the row has moved on, the server returns **409** with its copy and the client asks *keep mine / use theirs*. Nothing is ever silently overwritten. A 409 whose server content **equals what we sent** is treated as success — our write landed and only the confirmation was lost (this also covers two tabs sharing one outbox).
- **Access control:** a **passphrase** (not real auth). SHA-256 hashed client→server into a `space` id; each space is a separate planner. Same passphrase on every device = same data. Intentionally lightweight; per-person logins would be a real-auth upgrade, not a tweak.

  **The passphrase is the primary key.** `spaceFromKey()` in `lib/planner.js` is `SHA-256(passphrase)`, and that hash *is* `planner_days.space`. Changing the passphrase therefore does not rotate a credential — it opens a **different, empty planner** and strands the existing rows under the old hash. It also orphans anything still sitting in `planner:outbox:<old-key>`. Rotating for real means migrating the data (`UPDATE planner_days SET space=<new> WHERE space=<old>`, and the same for `planner_recurring`). **Never describe a passphrase change as free.**

  **The length check in `PassphraseGate.jsx` is cosmetic.** `spaceFromRequest()` (`lib/planner.js:21-25`) accepts any non-empty `X-Planner-Key` and hashes it; `functions/api/day.js` only checks `if (!space) return 401`. There is **no server-side length check**. An attacker never loads the gate — they curl. So raising the minimum protects nobody, and raising it above the length of the passphrase already in use locks the owner out on any new device or reinstall (existing devices keep working from a cached `planner:key`, so the breakage stays hidden until the worst moment). It was proposed and deliberately cut. If you want the real planner actually authenticated, the answer is Cloudflare Access in front of the Pages project — see `TODOS.md`.
- **Backend:** Pages Functions, all requiring an `X-Planner-Key` header, all using `env.DB`. Shared helpers live in `lib/` — outside `functions/` so they aren't routed as endpoints.
  - `functions/api/day.js` — `GET /api/day?date=YYYY-MM-DD` → `{data, updated_at}`; `PUT` `{data, base, force}` → 200 or **409** on a version clash.
  - `functions/api/search.js` — `GET /api/search?q=` → dates + snippets. LIKE over the JSON blob; query wildcards escaped, and every row re-checked against real field values so a hit on JSON syntax doesn't count.
  - `functions/api/recurring.js` — `GET`/`PUT` the recurring list (whole-list replace).
- **DB:** `planner_days (space, day_date, data, updated_at)`, PK `(space, day_date)`; `data` is a JSON blob of the day. `planner_recurring (space, id, text, weekdays, target, created_at)` — weekdays Mon=0..Sun=6, `target` is `todo` or a block name. Recurring items merge into the checklist on matching weekdays and carry a stable `rid` so they can't duplicate; **merging does not save**, so merely viewing a day creates no row.

## File map
- `index.html` — Vite entry (repo root)
- `src/main.jsx` — bootstrap. In demo builds it installs the fetch shim, seeds `planner:key`, and seeds the demo day, all **before** `render()`
- `src/app.jsx` — passphrase gate, current date, wiring
- `src/lib/sync.js` — **the outbox, per-date versions, flush, 409 handling, retry/backoff.** Framework-agnostic on purpose (no DOM, no Preact)
- `src/lib/demo-api.js` — **the demo's fake server.** Patches `globalThis.fetch`, answers `/api/*` from localStorage, seeds the fictional day. Demo builds only
- `src/lib/day.js` — the day model and pure helpers (normalize, recurring merge, carry-over)
- `src/components/` — Sheet, DateHeader, Toolbar, SelectionPill, SearchDialog, RecurringDialog, ConflictDialog, PassphraseGate
- `src/styles.css` — Tailwind + `@theme` tokens + `@font-face`
- `public/` — static passthrough: `fonts/caveat.woff2`, `icons/`, `manifest.json`, `manifest-demo.json`
- `functions/api/*.js` — the API
- `lib/planner.js` — API helpers (`spaceFromKey`, `json`)
- `lib/search.js` — **what counts as a search hit, and how a snippet is trimmed.** Shared by `functions/api/search.js` and `src/lib/demo-api.js` so the demo's search can never drift from production's
- `scripts/deploy-demo.mjs` — builds the demo in a throwaway worktree and direct-uploads it
- `scripts/check-bundle.mjs` — fails the production build if demo code is in it
- `tests/e2e.mjs`, `tests/demo.mjs`, `tests/migration.mjs` — the safety net (see below)
- `schema.sql` — D1 tables; every statement is `IF NOT EXISTS`, safe to re-run
- `wrangler.toml` — Pages + D1 config; `pages_build_output_dir = "dist"`

## Hard rules / gotchas
- **Do NOT perform auth on the owner's behalf.** Run the login commands; let them click "authorize". Same for anything touching their Cloudflare/GitHub credentials.
- **Never `rm -rf functions/` or delete `wrangler.toml` in the live working tree.** Use `npm run deploy:demo`, which does it inside a throwaway git worktree. Deleting them here means an interrupted deploy leaves production source missing from disk, one `git commit -a` from an outage — and Cloudflare auto-deploys `main` on push.
- **Do NOT delete `[[d1_databases]]` from the committed `wrangler.toml`** to isolate the demo. `functions/api/day.js` reads `env.DB`; stripping it would break the **real** planner's next deploy. Direct Upload is what isolates the demo, not config edits.
- **`src/lib/demo-api.js` must stay in step with `functions/api/*`.** Add an endpoint to the real API and the demo 404s on it — silently, on a site nobody watches. `npm run test:demo` is what catches this.
- **`demo-api.js` must never throw and never return 409.** A throw is caught by `sync.js` as "you are offline" and retried forever, leaving the demo stuck on "Saving… (1)". A 409 shows a conflict dialog to a visitor with one device and no server.
- The D1 binding variable name is **`DB`** — the function reads `env.DB`. Any other name breaks it.
- **Cloudflare Pages build settings must be:** build command `npm ci && npm run build`, output directory `dist`. A blank build command ships an empty site.
- **The service worker must never cache `/api/`.** Workbox generates it (`vite-plugin-pwa`); the API is excluded via `navigateFallbackDenylist` and no runtime caching. Don't "optimize" by caching it — sync goes stale. (It is a non-issue in the demo: the shim synthesises a `Response` and never calls through, so no fetch event reaches the SW.)
- **Don't rewrite `src/lib/sync.js` casually.** Two real data-loss bugs have lived there, both invisible to code review. Change it only with the tests running.
- The handwriting font is **self-hosted on purpose**. A CDN font falls back to serif exactly when the PWA is offline.
- **localStorage keys are load-bearing** (`planner:key`, `planner:outbox:<key>`, `planner:ver:<key>`, `planner:<key>:<date>`). Renaming one strands data on already-installed devices. The demo's own keys are namespaced separately (`demo:*`) precisely so it never writes to the client's cache.
- **`npm` may not be on PATH** (proto shims only `node`). Invoke it from the node install's own directory rather than assuming a global shim: `C:\Users\<you>\.proto\tools\node\<version>\npm.cmd`.
- Free tier is fine; don't add paid features or a domain unless asked.

## Local development
```
npm install
npm run dev                                    # Vite dev server (UI only — no /api)
npm run build && npx wrangler pages dev dist   # full app + Functions + local D1
npx wrangler d1 execute planner-db --local --file=schema.sql   # seed the local DB once

npm run build:demo && npx vite preview --port 8789 --host 127.0.0.1   # the demo, locally
npm run deploy:demo                            # build in a worktree + direct upload
```

## Testing — do not skip this
The sync paths cannot be verified by reading the code or by a simple round-trip. **Every bug found in them so far was invisible to review and only showed up in a real browser.**

```
npm run test:e2e         # 128 checks against the real API + local D1 on :8788.
                         # Offline queue/flush, tab-close survival, both conflict
                         # resolutions, recurring, carry-over, reordering, search
                         # (incl. LIKE-wildcard escaping), honest save failure,
                         # print, layout, handwriting.

npm run test:demo        # 19 checks against the demo build on :8789. No server.
                         # Because the demo runs the REAL sync layer against a fake
                         # server, a green run here proves the actual outbox drains.

npm run test:migration   # 11 checks: upgrade path from the old vanilla build,
                         # offline shell via Workbox, /api/ never cached.
```

These are behavioural (they click buttons and read the screen), which is why they survived the vanilla → Preact rewrite unchanged. Keep them that way.

## Likely next requests
- **Per-person planners / real auth** — would replace the passphrase scheme. Flag the tradeoff rather than silently bolting it on. See `TODOS.md` (Cloudflare Access).
- **Accessibility / touch debt** — focus rings, 44px touch targets, and the `--color-muted` contrast split are catalogued in `TODOS.md` with the reasoning. Do them as one branch.
- Layout tweaks: `TODO_ROWS` in `src/lib/day.js`; block proportions are the `WEIGHT` map in `src/components/Sheet.jsx`; colours and fonts are the `@theme` tokens in `src/styles.css`; the cream band is `--border`.
