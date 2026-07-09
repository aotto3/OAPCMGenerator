/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/react" />

// Enables typed `import url from './asset.pdf?url'` (Vite bundles the file and
// yields its URL). Used by documents/pdfAssets.ts to load the official UIL
// ballot PDFs as static, service-worker-cacheable assets.
//
// The vite-plugin-pwa references type the `virtual:pwa-register/react` module
// (useRegisterSW) that ui/UpdatePrompt imports for the update flow.

interface ImportMetaEnv {
  /** Origin of the API service (Slice 13 server). Better Auth lives at /api/auth
   *  there. Set per-environment; see app/.env.example. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** App version stamped in at build time (Vite `define`; see vite.config.ts). */
declare const __APP_VERSION__: string;
