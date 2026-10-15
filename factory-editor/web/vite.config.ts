import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is only ever served at `/` by the Factory Editor API, and its deep links are
// paths (`/editor/<pipelineId>`), so `base` is `/`: relative asset URLs would break
// under a nested path. Nothing here matters at runtime except `base` and the chunk groups.
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    // Dev only: the API answers on 3150 (its default PORT), so the dev server proxies `/api`
    // to it and the browser sees one origin. `npm run dev:api` must be running. 5185 and 3150
    // keep clear of the other local apps (Vite 5175-5178, APIs 3100-3103 and 3200).
    port: 5185,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3150' },
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
