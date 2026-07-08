/**
 * Production host for the frontend (Slice 17, #46).
 *
 * The app and API used to live on two separate *.up.railway.app hosts. Because
 * up.railway.app is on the Public Suffix List, those are DIFFERENT sites, which
 * forced the Better Auth session cookie to SameSite=None — and mobile Safari and
 * Chrome block that as a third-party cookie, breaking sign-in on phones.
 *
 * This tiny host collapses everything onto ONE origin: it serves the built SPA
 * AND reverse-proxies /api/* to the API service. The browser now only ever talks
 * to this origin, so the session cookie is first-party (SameSite=Lax) and mobile
 * sign-in works. Google OAuth callbacks and magic-link verifies come back to
 * this origin under /api/auth/* and are forwarded to the API unchanged.
 *
 * Runtime config (Railway → frontend service → Variables; NOT VITE_ build vars):
 *   API_URL  required — origin of the API service to forward /api/* to
 *            (e.g. https://oapcmgenerator-production.up.railway.app).
 *   PORT     provided by Railway.
 */
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API_URL = process.env.API_URL;
if (!API_URL) {
  console.error('Missing required environment variable: API_URL (origin of the API service to proxy /api/* to)');
  process.exit(1);
}

const distDir = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const app = express();
app.disable('x-powered-by');

// Reverse-proxy the whole /api surface (Better Auth at /api/auth/*, contest CRUD
// at /api/contests) to the API service. We mount at the ROOT and select with
// pathFilter — NOT app.use('/api', …) — because mounting on a path makes Express
// strip that path before the proxy sees it, so the API would receive /auth/*
// instead of /api/auth/* and 404 every auth call. At root, req.url keeps the
// full /api prefix and is forwarded verbatim. xfwd forwards X-Forwarded-* so the
// API sees the original https origin; changeOrigin rewrites Host so TLS to the
// target resolves. No body parser runs before this, so request bodies stream
// through untouched.
app.use(
  createProxyMiddleware({
    target: API_URL,
    changeOrigin: true,
    xfwd: true,
    pathFilter: (path) => path.startsWith('/api'),
  }),
);

// Static app shell + content-hashed assets (JS chunks, ballot PDFs, PWA files).
app.use(express.static(distDir));

// SPA fallback: any remaining route serves index.html so client-side routing and
// deep links resolve. /api is already handled above and never reaches here.
app.use((_req, res) => {
  res.sendFile(join(distDir, 'index.html'));
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`OAP Contest Manager frontend on :${port} — proxying /api → ${API_URL}`);
});
