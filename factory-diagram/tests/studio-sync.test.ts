import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, TOOL_DIR } from './helpers.js';

const STUDIO: string = path.join(ROOT, 'factories-tools/factory-studio/web/src/shared/graph');
const COPY: string = path.join(TOOL_DIR, 'src/shared/studio-graph');
const FILES: readonly string[] = ['rank.ts', 'layout.ts', 'text.ts', 'graph.types.ts'];

/** The copy minus what the copy script changes: the header and the `.js` import extensions. */
const normalizeCopy = (text: string): string =>
  text
    .split('\n')
    .filter(
      (line: string, i: number): boolean => !(i < 4 && (line.startsWith('//') || line === '')),
    )
    .join('\n')
    .replace(/from '(\.\/[a-z.-]+)\.js';/g, "from '$1';")
    .replace("from './xyflow.types';", "from '@xyflow/react';");

describe('the ported Studio layout', () => {
  it.each(FILES)(
    '%s is byte-for-byte the Studio file (modulo header and import extensions)',
    (file: string) => {
      const studio: string = fs.readFileSync(path.join(STUDIO, file), 'utf8');
      const copy: string = fs.readFileSync(path.join(COPY, file), 'utf8');
      expect(normalizeCopy(copy)).toBe(studio);
    },
  );
});
