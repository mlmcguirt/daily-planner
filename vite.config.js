import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  // `vite build --mode demo` reads .env.demo, which sets VITE_DEMO=1.
  // NOT `VITE_DEMO=1 npm run build` — that is bash syntax, and npm shells scripts
  // through cmd.exe on Windows, where it fails outright.
  const isDemo = mode === "demo";

  return {
    plugins: [
      preact(),
      tailwindcss(),

      // The demo must not install as a second, indistinguishable "Daily Planner" on the
      // owner's own phone. It points at its own manifest — a separate file rather than a
      // patched one, so Workbox still precaches both with correct revision hashes.
      {
        name: "demo-identity",
        transformIndexHtml(html) {
          if (!isDemo) return html;
          return html
            .replace('href="/manifest.json"', 'href="/manifest-demo.json"')
            .replace("<title>Daily Planner</title>", "<title>Daily Planner — live demo</title>");
        },
        generateBundle() {
          if (!isDemo) return;

          // Make "the demo has no API" observable rather than merely argued.
          //
          // The demo ships no functions/ and no bindings, so there is genuinely no backend.
          // But Cloudflare Pages answers an unmatched path with the SPA shell — so
          // GET /api/day returns 200 text/html, not 404. Harmless (it is a static file, not
          // a backend) but it means the property can only be confirmed by reading a response
          // body, and it leaves one real failure mode: if the fetch shim ever failed to
          // install, sync.js would fetch /api/day, get HTML, and choke on r.json().
          //
          // A 404 closes both. Demo builds only — production's /api/* must reach the real
          // Pages Functions, and nothing here is emitted into that build.
          this.emitFile({
            type: "asset",
            fileName: "_redirects",
            source: "/api/* /404.html 404\n"
          });
          this.emitFile({
            type: "asset",
            fileName: "404.html",
            source: [
              "<!doctype html>",
              '<meta charset="utf-8">',
              "<title>No API here</title>",
              "<p>This is the demo. It has no backend, no database, and no API.",
              "<p>Everything you type lives in your own browser.",
              ""
            ].join("\n")
          });
        }
      },

      VitePWA({
        registerType: "autoUpdate",
        // public/manifest.json is already correct — don't let the plugin invent another.
        manifest: false,
        includeAssets: ["fonts/caveat.woff2", "icons/icon-192.png", "icons/icon-512.png"],
        workbox: {
          // Vite hashes filenames, so the shell is precached from the generated manifest
          // rather than a hand-written list (which would silently go stale).
          globPatterns: ["**/*.{js,css,html,woff2,png,json}"],
          navigateFallback: "index.html",
          // HARD RULE: /api/ must never be served from cache, or sync goes stale.
          // No runtime caching is registered for it, and it's excluded from the SPA
          // navigation fallback so an API request can never resolve to index.html.
          //
          // Irrelevant in the demo: demo-api.js synthesises a Response and never calls
          // through, so no fetch event ever reaches the service worker.
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: []
        },
        devOptions: { enabled: false }
      })
    ],
    build: {
      outDir: "dist",
      emptyOutDir: true
    }
  };
});
