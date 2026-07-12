import { render } from "preact";
import { registerSW } from "virtual:pwa-register";
import { App } from "./app.jsx";
import "./styles.css";

registerSW({ immediate: true });

// Demo builds only. `import.meta.env.VITE_DEMO` is statically replaced by Vite, so in a
// production build this whole branch folds to `if (false)` and Rollup drops the dynamic
// import entirely — the demo's fetch patch never reaches the real planner's bundle.
// scripts/check-bundle.mjs proves it did, rather than trusting that it should have.
//
// The import MUST be dynamic. A static top-level `import "./lib/demo-api.js"` is a
// side-effecting module and Rollup keeps it, flag or no flag.
async function boot() {
  if (import.meta.env.VITE_DEMO) {
    const { installDemoApi, seedDemo, DEMO_KEY } = await import("./lib/demo-api.js");

    // Order is load-bearing. All three of these must complete BEFORE render().
    //
    // If App mounts first, app.jsx:56 (getRecurring) and app.jsx:86 (load) fire real
    // fetches at a host with no functions/ directory — and both failure paths are
    // silent: sync.js:247 swallows it and returns [], sync.js:181 returns {ok:false}
    // and the sheet just stays blank. You would get an empty demo with no error
    // anywhere, and nothing to tell you why.
    installDemoApi();
    localStorage.setItem("planner:key", DEMO_KEY);   // app.jsx:17-21 then skips the gate
    seedDemo();
  }

  render(<App />, document.getElementById("app"));
}

boot();
