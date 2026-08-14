import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Lock the packaged page down to its own files. It is only applied to the
 * build: the dev server needs eval for hot reloading, and nothing but this
 * machine can reach it anyway.
 */
const csp = (): Plugin => ({
  name: 'djtree-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; `
      + `script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; `
      + `font-src 'self'; connect-src 'self'">`,
    ),
});

export default defineConfig({
  plugins: [react(), csp()],
  // The packaged app loads dist/index.html off disk, where absolute asset paths
  // would resolve against the filesystem root and 404.
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    // Electron ships its own Chromium, so there is no old browser to support.
    target: 'chrome130',
  },
});
