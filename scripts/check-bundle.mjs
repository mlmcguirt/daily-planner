// Guards the PRODUCTION bundle against the demo's fetch interceptor.
//
// The demo works by patching globalThis.fetch. That is fine in a demo and genuinely
// bad in the real planner: a module that intercepts every network call, sitting in the
// bundle of the app that holds your life, dormant and one flag-evaluation away from
// active. It must be ABSENT from the production build, not merely inactive in it.
//
// main.jsx guards the import inside `if (import.meta.env.VITE_DEMO)`. Vite folds that
// to `false` in a production build and Rollup drops the dynamic import. This script is
// what turns "it should have been dropped" into "it was dropped".
//
// TWO THINGS THIS GETS RIGHT, BOTH OF WHICH ARE EASY TO GET WRONG:
//
//  * It greps for a STRING LITERAL, not an identifier. Minification renames
//    `installDemoApi` to something like `f`. Grepping for the function name finds
//    nothing and the gate goes green while the code ships. String literals survive.
//
//  * It scans ALL of dist/, not just dist/assets/. Workbox writes the service worker
//    and its precache manifest to dist/sw.js — at the root. A demo chunk named there
//    would be invisible to a scan of dist/assets/ alone.
//
// Runs as part of `npm run build`, so Cloudflare's production deploy runs it too.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Must match DEMO_MARKER in src/lib/demo-api.js, character for character.
const MARKER = "gstack-demo-api/v1";
const DIST = resolve(import.meta.dirname, "..", "dist");

const walk = dir =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const hits = walk(DIST).filter(path => {
  try {
    return readFileSync(path, "utf8").includes(MARKER);
  } catch {
    return false;                            // a binary (font, icon) — not our concern
  }
});

if (hits.length) {
  console.error(`
FAIL: the demo's fetch interceptor is in the production bundle.

Found "${MARKER}" in:
${hits.map(h => "  " + h).join("\n")}

This means Rollup did not drop the demo import. The usual cause is that
src/main.jsx uses a static \`import\` instead of a dynamic \`await import()\`
inside the \`if (import.meta.env.VITE_DEMO)\` branch — a static import is
side-effecting and is always kept.

Do NOT ship this. It would put a global fetch patch in the real planner.
`);
  process.exit(1);
}

console.log(`✓ production bundle is clean — no "${MARKER}" anywhere in dist/`);
