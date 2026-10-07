import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is only ever served at `/` by the Factory Studio API, and its deep links are
// paths (`/runs/<pipelineId>/<runId>`), so `base` is `/`: relative asset URLs would break
// under a nested path. Nothing here matters at runtime except `base` and the chunk groups.
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    // Dev only: the API answers on 3100, so the dev server proxies `/api` to it and the
    // browser sees one origin. `npm run dev:api` must be running.
    port: 5175,
    proxy: { '/api': 'http://127.0.0.1:3100' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // Vendor code in its own chunks: each stays under Vite's 500 kB note and is cached
        // across deploys while the app chunk changes.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'flow', test: /node_modules[\\/](@xyflow|d3-|zustand|classcat)/ },
            { name: 'zod', test: /node_modules[\\/]zod[\\/]/ },
            // The markdown renderer is only ever imported by the lazy document modal.
            {
              name: 'markdown',
              test: /node_modules[\\/](react-markdown|remark-|rehype-|mdast-|micromark|unified|unist-|vfile|hast-|hastscript|property-information|space-separated-tokens|comma-separated-tokens|html-url-attributes|estree-|devlop|bail|trough|is-plain-obj|extend|ccount|markdown-table|longest-streak|zwitch|character-|decode-named-character-reference|parse-entities|escape-string-regexp|trim-lines|@ungap|inline-style-parser|style-to-)/,
            },
          ],
        },
      },
    },
  },
});
