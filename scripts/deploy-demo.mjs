// Build and deploy the public demo. Run it with `npm run deploy:demo`.
//
// WHY THIS EXISTS, AND WHY IT IS NOT THREE LINES OF SHELL
//
// The obvious version is:
//
//     rm -rf functions wrangler.toml && VITE_DEMO=1 npm run build
//     wrangler pages deploy dist --project-name=daily-planner-demo
//
// Do not do that. Two reasons, both real:
//
//  1. It deletes the PRODUCTION API from the live working tree. If the build fails,
//     you Ctrl-C, the terminal dies, or the laptop sleeps, you are sitting in a repo
//     with functions/ gone — one `git commit -a` away from an outage, because
//     Cloudflare auto-deploys main on push.
//  2. `VITE_DEMO=1 npm run build` is bash syntax. npm shells scripts through cmd.exe
//     on Windows, where it simply fails.
//
// So: build in a throwaway git worktree, OUTSIDE the repo, and delete functions/ and
// wrangler.toml only in there. The live tree is never touched, so an interrupted
// deploy leaves production untouched and there is nothing to remember to restore.
//
// The worktree lives outside the repo deliberately. Cloudflare Pages auto-detects a
// functions/ directory and would happily compile the real API into the demo — and
// wrangler searches upward for wrangler.toml, which would hand the demo a live D1
// binding to the planner holding your actual life. Distance is the safety mechanism.

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const PROJECT = "daily-planner-demo";
const REPO = resolve(import.meta.dirname, "..");
const TREE = resolve(REPO, "..", "dp-demo-build");

const run = (cmd, args, cwd = REPO) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

const cleanup = () => {
  if (!existsSync(TREE)) return;
  try {
    run("git", ["worktree", "remove", "--force", TREE]);
  } catch {
    rmSync(TREE, { recursive: true, force: true });
    try { run("git", ["worktree", "prune"]); } catch { /* nothing to prune */ }
  }
};

process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

cleanup();                                   // a previous run may have died mid-flight

console.log(`\n→ worktree at ${TREE}`);
run("git", ["worktree", "add", "--detach", TREE, "HEAD"]);

// The two things that would let the demo reach the real database.
console.log("→ removing functions/ and wrangler.toml from the worktree (NOT the live tree)");
rmSync(join(TREE, "functions"), { recursive: true, force: true });
rmSync(join(TREE, "wrangler.toml"), { force: true });

// Vite resolves its plugins by walking up from the project root, and the worktree is a
// sibling of the repo rather than a child, so it finds nothing. It has to have its own
// node_modules.
//
// DO NOT symlink or junction the repo's node_modules in here. An earlier version of this
// script did, and it was a trap: `git worktree remove --force` deletes recursively, FOLLOWS
// the junction, and empties the REAL node_modules on the way out. It cost an `npm ci` to
// find out. Nothing irreplaceable, but the whole point of this script is that a demo deploy
// cannot reach back into the live repo, and a junction is a hole straight through that.
//
// So: a real, isolated install. It costs ~40s on a deploy you run occasionally by hand.
// That is the correct trade, and it is the same trade as building in a worktree at all.
console.log("→ installing dependencies in the worktree (isolated — never linked)");
run("npm", ["ci", "--no-audit", "--no-fund"], TREE);

// `--mode demo` reads .env.demo (tracked, so it exists in the worktree) for VITE_DEMO=1.
console.log("→ building the demo");
run("npx", ["vite", "build", "--mode", "demo"], TREE);

// Direct Upload. Bindings come only from the dashboard (there are none), repo config is
// ignored entirely, and the real project's Git integration is left alone.
//
// --branch=main is load-bearing: the worktree is a detached HEAD, so without it wrangler
// cannot work out which branch this is and publishes a PREVIEW deployment on a random
// subdomain, leaving daily-planner-demo.pages.dev empty. The README links to the
// production URL, so the production URL is what has to get the build.
//
// --commit-dirty silences a warning about the worktree being "dirty" — it is, on purpose:
// we just deleted functions/ and wrangler.toml from it.
console.log("→ deploying");
run("npx", [
  "wrangler", "pages", "deploy", "dist",
  `--project-name=${PROJECT}`,
  "--branch=main",
  "--commit-dirty=true"
], TREE);

console.log(`
Deployed. Now verify by hand — do not assume:
  1. The demo project's Cloudflare bindings list is EMPTY.
  2. curl https://${PROJECT}.pages.dev/api/day  ->  404
If /api/day answers anything else, the demo is talking to a real backend. Stop.
`);
