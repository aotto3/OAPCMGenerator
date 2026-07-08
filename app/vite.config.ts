import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `vite build` emits the static app shell (all document generation and storage
// stay client-side). It is served in production by serve.mjs, a thin host that
// also reverse-proxies /api/* to the API so app and API share one origin
// (Slice 17, #46). In dev, the proxy below gives `vite dev` the same same-origin
// shape, so the app calls relative /api paths everywhere.
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_URL || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    // PWA / offline hardening (Slice 15, issue #28). Workbox precaches the app
    // shell, the hashed JS chunks (JSZip / pdf-lib / xlsx generation libs), and
    // the bundled UIL ballot PDFs, so a cold-loaded app works fully offline:
    // view, edit, and generate the complete ZIP incl. adjudicator packets.
    //
    // Update flow is `prompt`, not autoUpdate: a new deploy does NOT silently
    // reload the page (that could interrupt an in-progress Generate on contest
    // day). Instead the new service worker installs and waits; ui/UpdatePrompt
    // surfaces a subtle "Update" banner and calls updateServiceWorker() only
    // when the user clicks. Precache entries are content-revisioned by Workbox
    // and cleanupOutdatedCaches drops old ones, so users never get stuck on a
    // stale bundle — the AC that mattered most here.
    VitePWA({
      registerType: 'prompt',
      // We register via the React hook in ui/UpdatePrompt (virtual:pwa-register/
      // react); don't also auto-inject a registration script.
      injectRegister: false,
      workbox: {
        // Precache everything the offline contest-day flow needs. The PDFs are
        // emitted by `?url` imports (documents/pdfAssets.ts); eval.pdf is ~780KB
        // so raise the per-file cap above Workbox's 2 MiB default with headroom.
        globPatterns: ['**/*.{js,css,html,ico,svg,png,webmanifest,pdf,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // SPA: serve index.html for navigations so deep links work offline.
        // Never fall back for the auth API — those must hit the network/fail
        // honestly rather than resolve to the app shell.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'OAP Contest Manager',
        short_name: 'OAP CM',
        description:
          'Generate UIL One-Act Play contest documents. Works fully offline on contest day.',
        theme_color: '#1565c0',
        background_color: '#eef2f7',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  test: {
    // Contest-model tests are pure Node — no DOM environment needed.
    // If a future slice needs DOM tests, scope `environment: 'jsdom'` to
    // those files with a `// @vitest-environment jsdom` comment instead of
    // changing this default.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
