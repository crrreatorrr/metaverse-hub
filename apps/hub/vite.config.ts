import { defineConfig } from 'vite';

// The hub is served at <domain>/hub. Hash routes such as #from=sproto stay client-side.
export default defineConfig({
  base: '/hub/',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
