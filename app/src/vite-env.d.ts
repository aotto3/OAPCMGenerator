/// <reference types="vite/client" />

// Enables typed `import url from './asset.pdf?url'` (Vite bundles the file and
// yields its URL). Used by documents/pdfAssets.ts to load the official UIL
// ballot PDFs as static, service-worker-cacheable assets.

interface ImportMetaEnv {
  /** Origin of the API service (Slice 13 server). Better Auth lives at /api/auth
   *  there. Set per-environment; see app/.env.example. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
