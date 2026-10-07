import path from 'node:path';
import type { FileSystemAdapter } from '../src/adapters/file-system/index.js';
import { parsePipeline } from '../src/features/pipeline/services/index.js';
import type { LoadedPipeline, ResolveContext } from '../src/features/pipeline/index.js';

export const ROOT = '/repo';
/** Where the demo pipeline.json lives: what `{{factoryPath}}` stands for. */
export const FACTORY = '/repo/factories/demo-factory';
/** The demo factory's wrapper skill folder: what `{{skillPath}}` stands for. */
export const SKILL = '/repo/.claude/skills/demo-factory';

export const context = (overrides: Partial<ResolveContext> = {}): ResolveContext => ({
  anchors: { rootPath: ROOT, skillPath: SKILL, homePath: '/home/me' },
  date: '2026-09-17',
  suppliedParams: { topic: 'How to Build an AI Dark Factory' },
  ...overrides,
});

/** plan + design fan in to build; review loops back to build at most twice. */
export const demoDefinition = (): Record<string, unknown> => ({
  id: 'demo-factory',
  constants: {
    rootPath: 'cwd',
    skillPath: '.',
    homePath: '~',
    sites: 'websites',
    sitePath: '{{rootPath}}/{{sites}}/{{slug}}',
  },
  params: { topic: '', depth: 2 },
  outputDir: '{{rootPath}}/run/{{id}}/{{slug}}-{{date}}',
  hooks: { before: ['echo before {{outputDir}}'], after: ['echo after {{outputDir}}'] },
  START: ['plan', 'design'],
  steps: {
    plan: {
      agent: 'general-purpose',
      model: 'opus',
      prompt: ['Plan {{topic}} at depth {{depth}}.'],
      output: ['1-plan/outline.md'],
      knowledge: ['{{rootPath}}/knowledge/outline.md'],
      transitions: { DONE: { target: ['build'] } },
    },
    design: {
      agent: 'general-purpose',
      prompt: ['Design {{topic}}.'],
      output: ['2-design/spec.md'],
      transitions: { DONE: { target: ['build'] } },
    },
    build: {
      agent: 'general-purpose',
      system: ['You build {{id}}.'],
      prompt: ['Build at {{sitePath}}.'],
      workDir: '{{sitePath}}',
      input: ['1-plan/outline.md', '2-design/spec.md', '4-review/feedback.md'],
      output: ['3-build/changes.md'],
      transitions: { DONE: { target: ['review'] } },
    },
    review: {
      agent: 'general-purpose',
      prompt: ['Review.', 'Return APPROVE or REVISE.'],
      input: ['3-build/*.md'],
      output: ['4-review/review.md', '4-review/feedback.md'],
      transitions: {
        APPROVE: { target: ['END'] },
        REVISE: { target: ['build'], max: 2, onMax: ['END'] },
      },
    },
  },
});

export const load = (definition: Record<string, unknown> = demoDefinition()): LoadedPipeline =>
  parsePipeline(path.join(FACTORY, 'pipeline.json'), JSON.stringify(definition));

/** A file system that is a plain record of path → text. Directories are implied by their files. */
export const memoryFileSystem = (
  initial: Record<string, string> = {},
): FileSystemAdapter & {
  files: Map<string, string>;
} => {
  const files: Map<string, string> = new Map(Object.entries(initial));
  const dirs: Set<string> = new Set();
  const isDir = (target: string): boolean =>
    dirs.has(target) ||
    [...files.keys()].some((file: string): boolean => file.startsWith(`${target}/`));
  const toRegExp = (pattern: string): RegExp =>
    new RegExp(`^${pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
  return {
    files,
    readText: async (file: string): Promise<string> => {
      const text: string | undefined = files.get(file);
      if (text === undefined) throw new Error(`ENOENT: ${file}`);
      return text;
    },
    writeText: async (file: string, text: string): Promise<void> => void files.set(file, text),
    writeJsonAtomic: async (file: string, value: unknown): Promise<void> =>
      void files.set(file, JSON.stringify(value, null, 2)),
    exists: async (target: string): Promise<boolean> => files.has(target) || isDir(target),
    isDirectory: async (target: string): Promise<boolean> => isDir(target),
    makeDir: async (directory: string): Promise<void> => void dirs.add(directory),
    glob: async (pattern: string): Promise<string[]> =>
      [...files.keys()].filter((file: string): boolean => toRegExp(pattern).test(file)).sort(),
  };
};
