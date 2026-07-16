# TODOS

Deferred work. Each item was considered during a review, judged real, and judged
not-this-branch. Context is included so picking one up in three months doesn't
mean rediscovering why it mattered.

---

## Put Cloudflare Access in front of the real planner

**What:** Add Cloudflare Access (free tier) to the production Pages project, so the
real planner sits behind actual authentication rather than a shared secret.

**Why:** Publishing the repo publishes `lib/planner.js`, `functions/api/*`, and
`schema.sql`. The endpoint becomes fully documented, unauthenticated, and
un-rate-limited. The passphrase is the only thing between a stranger and the
planner's contents — and the README, by design, tells them so.

**Pros:** Real auth. Free. Orthogonal to everything else — it wraps the deployment
and needs no code change.

**Cons:** New infrastructure on a project whose whole pitch is that it is lightweight.
The passphrase scheme was a deliberate choice, not an oversight.

**Context:** `spaceFromKey()` (`lib/planner.js:7-11`) is `SHA-256(passphrase)`, and
that hash *is* `planner_days.space`. There is no server-side length check anywhere —
`spaceFromRequest` accepts any non-empty `X-Planner-Key`. At 12+ characters the
passphrase is not brute-forceable over HTTP in any realistic timeframe, which is why
this is deferred rather than blocking. But "the passphrase is not authentication" is
a sentence the README now says out loud, and this is what it would take to stop
saying it.

**Do NOT** try to fix this by raising the minimum length in `PassphraseGate.jsx`.
That check is client-side; an attacker never loads it. It was proposed and cut for
exactly this reason. See the design doc's Security section.

**Depends on:** nothing.

---

## Remove the dead `getVersion` export from `sync.js`

**What:** `sync.js:299` exports `getVersion` in the object returned by `createSync`.
Nothing calls it.

**Why:** Dead weight in the one module CLAUDE.md singles out as dangerous. It also
inflated the "19-member interface" the original demo plan was afraid of reproducing.

**Pros:** One less thing in the interface every future reader has to account for.

**Cons:** It is a change to `sync.js`, which is never free.

**Context:** Verified by grepping every consumer — `app.jsx`, `SearchDialog.jsx`,
`RecurringDialog.jsx`. Zero callers. `setVersion` (the internal one) is used heavily
and must stay; only the *exported* `getVersion` is dead.

**Blocked by:** the public-release branch requires zero diff on `sync.js`. Do this
afterwards, on its own, with `npm run test:e2e` running.

---

## ~~Reconcile the theme colour~~ — DONE

**Fixed 2026-07-15, folded into the band-colour change.** The band moved from cream
`#f7efdd` to soft legal-pad `#f5eec2`, and all three now agree on it: `--color-backdrop`,
`index.html`'s `theme-color`, and both manifests' `theme_color` (production was the grey
`#4a4a4a`; the demo already matched the band). The browser and installed-PWA frames no
longer contradict each other or the sheet.

**Original note —**

**What:** `index.html:7` sets `theme-color` to `#f7efdd` (the cream border).
`public/manifest.json` sets `theme_color` to `#4a4a4a` (grey). They disagree.

**Why:** These drive the browser chrome and the installed-PWA chrome respectively, so
the app renders two different colours of frame depending on how it was opened.

**Pros:** One line. The app stops contradicting itself.

**Cons:** Nobody has noticed in two major versions.

**Context:** Pre-existing, unrelated to the public release. Cream (`#f7efdd`) is almost
certainly correct — it matches `--border`, which is the band the app is built around.
Worth doing before strangers read the repo, because it is precisely the kind of detail
that undercuts a project whose pitch is taste.

**Depends on:** nothing. Note the demo build gets a distinct manifest `name` as part of
the public-release branch — fold this in there if the file is already open.

---

## ~~Design debt: accessibility, touch, and trust~~ — DONE

**Fixed by /design-review on `design-debt`, 2026-07-12.** All five items below were
confirmed in a real browser (not inferred from source) and fixed. 128/128 e2e, 19/19 demo.

The live audit also found **two things source review had missed entirely**:

- **The mobile layout was broken, not merely imperfect.** `Sheet.jsx` had an inline
  `flex` on each block sitting next to a `max-md:flex-none` class. Inline wins, so the
  mobile rule had *never applied*: at 390px the four time blocks collapsed to **16px each**
  (just the `<h2>`) and their 120px textareas spilled out and rendered on top of one
  another. An unreadable smear, on the platform this planner mostly lives on. Same bug,
  same file, twice — the sheet's inline `height` defeated `max-md:h-auto` too.
- **The passphrase gate looked like a void.** `App()` renders the gate *instead of* the
  planner, so nothing is behind it — yet it carried a `bg-black/35` scrim, darkening an
  empty cream page into a muddy mauve. Fixed, and its copy now says there is no password
  reset.

**One item was attempted and could not be delivered — see below.**

---

## Short viewports still clip the last checklist row

**What:** At 1280x720 (a very common laptop) the 17 checklist rows need 514px and the
container gives 488px, so the last row is sliced in half by the sheet's edge. It reads as
a rendering bug rather than as "scroll for more" — there is no visible scrollbar.

**Why it isn't fixed:** The agreed fix was `min-height: fit-content` on `.sheet`, so the
sheet would grow and the page would scroll instead of clipping. **It does nothing.**
`#todo-list` is an `overflow-y-auto` scroll container, and a scroll container's content
never propagates a size to its parent — so `fit-content` resolves small and the sheet
stays put. Verified in the browser, not assumed.

Delivering it means removing the checklist's internal scroll, which is precisely what
lets 17 rows shrink to fit one screen at normal heights. Removing it made the page scroll
at 900px and broke two e2e checks (`sheet fits one screen`, `cream border even on all
sides`). Reverted.

**Options for whoever picks this up:**
- Give the list a visible scroll affordance (a fade at the bottom edge, or a real
  scrollbar) so the half-row reads as "more below" rather than as clipping. Cheapest, and
  it fixes the *perception*, which is the actual complaint.
- Restructure so the sheet, not the list, owns the overflow. Bigger, and it puts the
  "fits one screen" design intent at risk — that intent is what the print layout mirrors.

**Do NOT** just set `min-height: fit-content` and assume it worked. It builds, it changes
nothing, and it looks like a fix in the diff.

---

## ~~Original design-debt list (all fixed)~~

**1. Focus is invisible across the entire sheet.** `Sheet.jsx:23` and `Sheet.jsx:110`
both set `outline-none` with no replacement, and the to-do row's bottom border is
identical focused and unfocused. Tabbing through 17 rows and 4 textareas changes
nothing on screen. This is strange rather than merely wrong: you implemented
arrow-key reordering and gave `.grip` a `:focus-visible` style (`styles.css:81`) —
you thought about keyboard users and then left every text field dark for them.
**Fix:** a paper-native focus state (the hairline thickens to `--color-ink`, the
focused block border does the same), not a browser default blue ring — that would be
the only un-designed pixel on the sheet.

**2. Touch targets are half the minimum.** `.grip` is 16px wide (`styles.css:72`),
`.tick` is 18px (`styles.css:88`). The floor is 44px. These are the two things a
phone user touches most, in an app whose own code comment says it "mostly lives on a
phone." The grip additionally sits at `opacity: 0.55` on `#9a9a9a` — about **1.9:1**
against white, under the 3:1 required for a non-text control. It is nearly invisible
*and* nearly untappable. **Fix:** keep the drawn size (the delicacy is the point) and
expand the hit area to 44px with padding or a pseudo-element. Lift the grip's opacity
to clear 3:1.

**3. `--color-muted` is doing two jobs it cannot both do.** `styles.css:19` defines it
for "borders, secondary text." As a hairline, `#9a9a9a` at 2.8:1 is fine. As **text** —
a completed to-do at `Sheet.jsx:112` — 2.8:1 fails WCAG AA badly. You cannot darken the
token without thickening every hairline in the app and wrecking the paper feel. This is
the root cause of the contrast failure, not a coincidence. **Fix:** split it. Keep
`#9a9a9a` for decorative borders (rename `--color-border`), add a separate
`--color-text-muted` dark enough to clear 4.5:1. Patching the one call site instead
leaves the contradictory token in place for the next person to trip over.

**4. There is no loading state, and it is indistinguishable from a wrong passphrase.**
`app.jsx:68-84` paints the local copy (or blank), then awaits the server. On a fresh
device there is no local copy, so you get a blank sheet. Now recall that `spaceFromKey()`
is `SHA-256(passphrase)` and *is* the `planner_days` primary key: **mistype the
passphrase on a new phone and the server returns an empty planner with no error, because
nothing is wrong from its point of view.** So "still loading" and "your entire life is
behind a different hash" render as the same pixels. **Fix, two halves:** give the sheet a
real loading state, and rewrite `PassphraseGate.jsx:18-22` to say what is actually true —
there is no password reset, and a mistyped passphrase does not error, it silently opens a
different, empty planner. Today the gate says the passphrase is a shared secret but never
that it is the primary key. This is the highest-stakes screen in the product.

**5. `max-md:h-auto` has never once applied.** `Sheet.jsx:208-209` carries that class
*and* an inline `style={{ height: "calc(100vh - var(--border) * 2)" }}`. Inline styles
beat classes, so the sheet is pinned to `100vh` on phones — exactly the case the class was
written to prevent — and `100vh` on mobile Safari includes the URL bar, putting the bottom
of the sheet below the fold. **Fix:** move the height out of the inline style, and use
`100dvh`. Then look at it in a real browser (`/design-review`); this is the class of bug
source review can find but only pixels can confirm. Dead code that reads as intent is worse
than no code — the next person to touch mobile layout will believe a rule is in force that
never has been.

**Depends on:** the public release landing first (it deliberately keeps its diff small and
`sync.js` at zero diff). Do item 3 before writing DESIGN.md, so the doc describes the fixed
system rather than the broken one.

---

## Write a DESIGN.md

**What:** Extract the design system into a `DESIGN.md`.

**Why:** It already exists — it is just only legible by reading CSS. The `@theme` tokens
in `styles.css:13-25`, "handwriting only on what you type, all chrome stays serif",
"buttons live in the cream border, never on the sheet", "landscape print, one page unless
there's genuinely more", "the font is self-hosted because a CDN font falls back to serif
exactly when the PWA is offline." Those are real, defended design rules. A stranger reading
the repo can see the tokens but not the reasoning that governs them.

**Pros:** The repo is about to be public and its design IS the differentiator. It also gives
future design reviews something to calibrate against instead of falling back on universal
principles.

**Cons:** Documentation for a project with no contributors. The comments in `styles.css` are
already unusually good.

**Context:** A design review on 2026-07-12 scored the aesthetic 10/10 and found no AI slop
whatsoever — this is a design worth writing down.

**Depends on:** do it *after* the `--color-muted` token split (design debt item 3), so the
doc describes the system as fixed rather than as broken.

---

## Clamp the SelectionPill on narrow viewports

**What:** `SelectionPill.jsx:16` computes
`left = Math.min(sel.rect.left + 8, window.innerWidth - width)` with **no lower bound**.
The recurring variant of the pill is 300px wide, so on a viewport narrower than that,
`left` goes negative and the pill runs off the left edge of the screen.

**Why:** This is the control that gates the entire recurring feature. If it renders
off-screen, the feature is simply unreachable.

**Also:** `top = Math.max(6, sel.rect.top - 38)` means a selection near the top of the
window gets a pill sitting on top of the field it belongs to.

**Pros:** Two-line fix.

**Cons:** A 320px viewport is rare in 2026, and this has never been reported.

**Context:** Surfaced during the 2026-07-12 design review. Consider folding it into the
release's D2 work (the visible affordance for recurring items), since that change opens
`SelectionPill.jsx` anyway.

---

## Fix the test-passphrase generator

**What:** `tests/e2e.mjs:16` and `tests/migration.mjs:15` build a passphrase with
`Math.random().toString(36).slice(2, 8)`. That yields fewer than 6 characters whenever
the random value has trailing zeros, so the length is not actually fixed.

**Why:** A latent flake in the suite that guards the real planner's data.

**Pros:** Deterministic test identities. Removes a source of "it failed once and I don't
know why."

**Cons:** Harmless today — the passphrase floor is staying at 4, so even a short draw
passes the gate.

**Context:** This would have become a real intermittent failure the moment any floor
above 5 landed. The floor raise to 12 was proposed, and cut, during the public-release
review — but the flake outlives that decision. Pad the suffix or assert the length
rather than slicing a random base-36 string.

**Depends on:** nothing.
