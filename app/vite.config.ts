import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Plain static build — no server component anywhere in this app.
// `vite build` emits static files; `vite dev` is only a local dev convenience.
export default defineConfig({
  plugins: [react()],
  test: {
    // Contest-model tests are pure Node — no DOM environment needed.
    // If a future slice needs DOM tests, scope `environment: 'jsdom'` to
    // those files with a `// @vitest-environment jsdom` comment instead of
    // changing this default.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
