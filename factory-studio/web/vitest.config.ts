import { defineConfig } from 'vitest/config';

// Pure functions only (the layout, the focus overlay, the run decoration): no DOM, no React
// rendering, so the node environment is enough.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
