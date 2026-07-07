/**
 * Loader for the official UIL ballot PDF assets.
 *
 * The three ballots live as real `.pdf` files under ./assets (PRD: static
 * assets, no base64-in-source). This module yields their bytes in BOTH
 * environments the document engine runs in:
 *
 *   • Browser (Vite bundle): `?url` imports make Vite emit each PDF as a hashed,
 *     fetchable asset — bundled and service-worker-cacheable, so generation works
 *     offline once cached (PRD user story 8; verified in the PWA slice).
 *   • Node (Vitest): there is no server to fetch from, so the bytes are read off
 *     disk relative to this module. Lets the golden tests and the "build every
 *     document" pipeline test run under Node.
 *
 * The builder itself (adjPackets.ts) stays pure and DOM-free — it receives the
 * bytes; only this loader knows about the environment. Templates are loaded once
 * and cached (they never change within a session).
 */

import evalUrl from './assets/eval.pdf?url';
import rankingUrl from './assets/ranking.pdf?url';
import awardsUrl from './assets/awards.pdf?url';
import type { AdjudicatorPdfTemplates } from './adjPackets';

/** Bundled asset URLs (browser) keyed by template. */
const ASSET_URLS: Record<keyof AdjudicatorPdfTemplates, string> = {
  evaluation: evalUrl,
  ranking: rankingUrl,
  awards: awardsUrl,
};

/** Filenames under ./assets (Node fallback), keyed by template. */
const ASSET_FILES: Record<keyof AdjudicatorPdfTemplates, string> = {
  evaluation: 'eval.pdf',
  ranking: 'ranking.pdf',
  awards: 'awards.pdf',
};

/** True in a browser (has a real fetch server); false under Node/Vitest. */
function inBrowser(): boolean {
  return typeof window !== 'undefined' && typeof fetch === 'function';
}

async function loadTemplateBytes(key: keyof AdjudicatorPdfTemplates): Promise<Uint8Array> {
  if (inBrowser()) {
    const res = await fetch(ASSET_URLS[key]);
    if (!res.ok) {
      throw new Error(`Failed to load PDF asset ${ASSET_URLS[key]}: ${res.status} ${res.statusText}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
  // Node: resolve the file next to this module and read it directly.
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const path = fileURLToPath(new URL(`./assets/${ASSET_FILES[key]}`, import.meta.url));
  return new Uint8Array(await readFile(path));
}

let cache: Promise<AdjudicatorPdfTemplates> | null = null;

/** Loads (once, cached) the three ballot templates for the current environment. */
export function loadAdjudicatorTemplates(): Promise<AdjudicatorPdfTemplates> {
  if (!cache) {
    cache = (async () => {
      const [evaluation, ranking, awards] = await Promise.all([
        loadTemplateBytes('evaluation'),
        loadTemplateBytes('ranking'),
        loadTemplateBytes('awards'),
      ]);
      return { evaluation, ranking, awards };
    })();
  }
  return cache;
}
