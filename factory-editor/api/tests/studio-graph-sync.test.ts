import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const EDITOR_WEB: string = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../web/src/shared/graph',
);
const STUDIO_WEB: string = path.resolve(
  EDITOR_WEB,
  '../../../../../factory-studio/web/src/shared/graph',
);

/** The shared graph files the Editor copies from the Studio byte for byte (`StepCard.tsx` differs on purpose). */
const FILES: readonly string[] = [
  'rank.ts',
  'layout.ts',
  'text.ts',
  'graph.types.ts',
  'focus.ts',
  'fit.ts',
  'FlowEdge.tsx',
  'index.ts',
];

describe('the copied Studio graph', () => {
  it.each(FILES)('%s is byte-for-byte the Studio file', (file: string) => {
    const studio: string = fs.readFileSync(path.join(STUDIO_WEB, file), 'utf8');
    const copy: string = fs.readFileSync(path.join(EDITOR_WEB, file), 'utf8');
    expect(copy).toBe(studio);
  });
});
