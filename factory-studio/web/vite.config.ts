import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The ports are per project: every project that carries this submodule can run its own copy at
// the same time. The dev server reads the same git-ignored `api/.env` the API reads (and the
// shell, which wins): `PORT` is where the API answers, `STUDIO_WEB_PORT` is the dev server's own
// port. Neither has to be set; the defaults are 3100 and 5175.
const API_DIR: string = fileURLToPath(new URL('../api', import.meta.url));

const toPort = (value: string | undefined, fallback: number): number => {
  const port: number = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback;
};

// The app is only ever served at `/` by the Factory Studio API, and its deep links are
// paths (`/runs/<pipelineId>/<runId>`), so `base` is `/`: relative asset URLs would break
// under a nested path. Nothing here matters at runtime except `base` and the chunk groups.
export default defineConfig(({ mode }: { mode: string }): UserConfig => {
  const env: Record<string, string> = loadEnv(mode, API_DIR, '');
  const apiPort: number = toPort(env.PORT, 3100);
  const webPort: number = toPort(env.STUDIO_WEB_PORT, 5175);

  return {
    plugins: [react()],
    base: '/',
    server: {
      // Dev only: the dev server proxies `/api` to the API on `apiPort`, so the browser sees one
      // origin. `npm run dev:api` must be running. `strictPort`: never drift onto another
      // project's port.
      port: webPort,
      strictPort: true,
      proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, ws: true } },
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
  };
});
