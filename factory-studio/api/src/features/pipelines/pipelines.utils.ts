import path from 'node:path';
import { pipelineIdParamSchema } from './pipelines.schema.js';

/** Where the shared factory graphs live: `factories/<id>/pipeline.json` (+ per-factory extras) — the kit, a git submodule. */
export const FACTORIES_DIR = 'factories';
/** The project's own factories, same layout; an id here shadows the shared one. */
export const LOCAL_FACTORIES_DIR = 'factories.local';
/** Where an id is looked up, in order. */
export const FACTORY_DIRS: readonly string[] = [LOCAL_FACTORIES_DIR, FACTORIES_DIR];
/** Where the wrapper skills live: `.claude/skills/<id>/SKILL.md` hands off to `any-factory`. */
export const SKILLS_DIR = '.claude/skills';
/** Where the skills repository keeps the wrapper skills (`factories-skills/<id>/SKILL.md`); `.claude/skills/<id>` links there. */
export const KIT_SKILLS_DIR = 'factories-skills';
export const PIPELINE_FILE = 'pipeline.json';
export const SKILL_FILE = 'SKILL.md';
/** Where a factory keeps its own knowledge: `factories/<id>/knowledge/`. */
export const KNOWLEDGE_DIR = 'knowledge';

export const isPipelineId = (id: string): boolean => pipelineIdParamSchema.safeParse(id).success;

export const factoriesRoot = (workDir: string): string => path.join(workDir, FACTORIES_DIR);

/** The folder holding `<id>`'s `pipeline.json` under `<dir>` (`factories` or `factories.local`). */
export const factoryDirIn =
  (dir: string) =>
  (workDir: string, id: string): string =>
    path.join(workDir, dir, id);

/** The shared folder holding `<id>`'s `pipeline.json` — what the `{{factoryPath}}` constant resolves to. */
export const factoryDir = (workDir: string, id: string): string =>
  factoryDirIn(FACTORIES_DIR)(workDir, id);

export const pipelineFileIn =
  (dir: string) =>
  (workDir: string, id: string): string =>
    path.join(factoryDirIn(dir)(workDir, id), PIPELINE_FILE);

export const pipelineFile = (workDir: string, id: string): string =>
  pipelineFileIn(FACTORIES_DIR)(workDir, id);

/** `pipeline.json` relative to `WORK_DIR` with `/` separators, under `<dir>`. */
export const pipelineRelativePathIn =
  (dir: string) =>
  (id: string): string =>
    `${dir}/${id}/${PIPELINE_FILE}`;

/** `<id>`'s wrapper skill in the skills repository: `factories-skills/<id>/SKILL.md`. */
export const kitSkillFile = (workDir: string, id: string): string =>
  path.join(workDir, KIT_SKILLS_DIR, id, SKILL_FILE);

export const kitSkillRelativePath = (id: string): string => `${KIT_SKILLS_DIR}/${id}/${SKILL_FILE}`;

/** What `.claude/skills/<id>` links to, as install.sh writes it: relative, so the project moves. */
export const kitSkillLinkTarget = (id: string): string => `../../${KIT_SKILLS_DIR}/${id}`;

/** The knowledge folder of the factory whose `pipeline.json` sits in `dir`. */
export const knowledgeDirOf = (dir: string): string => path.join(dir, KNOWLEDGE_DIR);

/**
 * Where a knowledge path from before the factory layout may live today. Old run snapshots
 * still name `{{rootPath}}/knowledge/<topic>/x.md` or `{{skillPath}}/knowledge/x.md`; those
 * folders are gone and the files sit under `factories/<id>/knowledge/`, with or without the
 * old sub-folder. Every suffix of the segments, longest first, to try under that folder:
 * `knowledge/frameworks/x.md` → `knowledge/frameworks/x.md`, `frameworks/x.md`, `x.md`. Pure.
 */
export const legacyKnowledgeCandidates = (segments: readonly string[]): string[][] =>
  segments.map((_: string, index: number): string[] => segments.slice(index));

/** The shared `pipeline.json` relative to `WORK_DIR` with `/` separators, whatever the platform. */
export const pipelineRelativePath = (id: string): string =>
  pipelineRelativePathIn(FACTORIES_DIR)(id);

/** `<id>`'s wrapper skill folder `.claude/skills/<id>` — what `{{skillPath}}` resolves to. */
export const wrapperSkillDir = (workDir: string, id: string): string =>
  path.join(workDir, SKILLS_DIR, id);

/** The wrapper skill `/<id>` a session starts with. */
export const wrapperSkillFile = (workDir: string, id: string): string =>
  path.join(workDir, SKILLS_DIR, id, SKILL_FILE);

/** `SKILL.md` relative to `WORK_DIR` with `/` separators, whatever the platform. */
export const wrapperSkillRelativePath = (id: string): string => `${SKILLS_DIR}/${id}/${SKILL_FILE}`;

/** The one line the wrapper's frontmatter quotes: no newline, no unescaped `"`. */
const frontmatterText = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * The wrapper skill a new factory gets, modelled on `.claude/skills/quick-research-factory/
 * SKILL.md`: the pipeline's description (with the standing "only when invoked" clause) in the
 * frontmatter, and a body that hands `/<id> <args>` to `any-factory`. Pure.
 */
export const wrapperSkillText = (id: string, description: string | undefined): string => {
  const summary: string = description?.trim() ? description : `Runs the ${id} pipeline.`;
  const clause = 'Only run it when the user invokes it by name, never on your own initiative.';
  return [
    '---',
    `name: ${id}`,
    `description: "${frontmatterText(`${summary} ${clause}`)}"`,
    'allowed-tools: Read, Write, Glob, Task, AskUserQuestion, Bash, Skill',
    '---',
    '',
    `# ${id}`,
    '',
    'This factory is a decoration of the universal `any-factory` skill. Its graph',
    `lives at \`${FACTORIES_DIR}/${id}/${PIPELINE_FILE}\`; nothing here is run`,
    'directly.',
    '',
    'Invoke the `any-factory` skill (Skill tool) with args:',
    '',
    `    ${id} $ARGUMENTS`,
    '',
    'If the Skill tool is unavailable, read `.claude/skills/any-factory/SKILL.md`',
    `and follow it with pipeline id \`${id}\`.`,
    '',
  ].join('\n');
};

export interface KnowledgeContext {
  /** The folder holding `pipeline.json`: the base of a path with no template. */
  pipelineDir: string;
  workDir: string;
  pipeline: unknown;
}

export interface KnowledgeBase {
  base: string;
  /** The untemplated remainder of the path. */
  rest: string;
}

interface PathConstants {
  rootPath?: unknown;
  skillPath?: unknown;
  [name: string]: unknown;
}

/** The anchors stay templates: `knowledgeBase` turns them into a base folder. */
const ANCHORS: readonly string[] = ['rootPath', 'skillPath'];
/** Constants may reference constants; this bounds the passes (and any cycle). */
const MAX_EXPANSIONS = 10;

/** The pipeline's `id`, else the name of the folder holding it. */
const idOf = (pipeline: unknown, pipelineDir: string): string => {
  const id: unknown =
    typeof pipeline === 'object' && pipeline !== null
      ? (pipeline as { id?: unknown }).id
      : undefined;
  return typeof id === 'string' && id !== '' ? id : path.basename(pipelineDir);
};

const constantsOf = (pipeline: unknown): PathConstants => {
  if (typeof pipeline !== 'object' || pipeline === null) return {};
  const holder = pipeline as { constants?: unknown; const?: unknown };
  const c: unknown = holder.constants ?? holder.const ?? {};
  return typeof c === 'object' && c !== null ? (c as PathConstants) : {};
};

/**
 * Replace every `{{name}}` naming a string constant (other than the anchors) with its value,
 * pass after pass, so `{{knowledgePath}}/x.md` with `knowledgePath: "{{rootPath}}/knowledge"`
 * becomes `{{rootPath}}/knowledge/x.md`. Unknown names are left as they are. Pure.
 */
export const expandConstants = (docPath: string, constants: PathConstants): string => {
  const expandOnce = (text: string): string =>
    text.replace(/\{\{(\w+)\}\}/g, (match: string, name: string): string => {
      const value: unknown = constants[name];
      return !ANCHORS.includes(name) && typeof value === 'string' ? value : match;
    });
  const step = (text: string, left: number): string => {
    const next: string = expandOnce(text);
    return next === text || left <= 1 ? next : step(next, left - 1);
  };
  return step(docPath, MAX_EXPANSIONS);
};

/**
 * Expand the knowledge templates: `{{rootPath}}/…` points at `WORK_DIR`, `{{skillPath}}/…` at
 * the wrapper skill folder `.claude/skills/<id>`, no prefix at the folder holding
 * `pipeline.json` — `constants.rootPath` (`cwd` or `.` = `WORK_DIR`) and `constants.skillPath`
 * move those bases; other string constants (`{{knowledgePath}}`, and `{{factoryPath}}` =
 * `{{rootPath}}/factories/{{id}}`) are expanded first, with the built-in `{{id}}` alongside them;
 * `const` is read when `constants` is absent. Pure.
 */
export const knowledgeBase = (rawDocPath: string, ctx: KnowledgeContext): KnowledgeBase => {
  const c: PathConstants = constantsOf(ctx.pipeline);
  const rootValue: string =
    typeof c.rootPath === 'string' && c.rootPath !== 'cwd' ? c.rootPath : '.';
  const skillValue: string = typeof c.skillPath === 'string' ? c.skillPath : '.';
  const id: string = idOf(ctx.pipeline, ctx.pipelineDir);
  const root: string = path.resolve(ctx.workDir, rootValue);
  const skill: string = path.resolve(wrapperSkillDir(root, id), skillValue);
  const docPath: string = expandConstants(rawDocPath, { ...c, id });
  if (docPath.startsWith('{{rootPath}}/')) {
    return { base: root, rest: docPath.slice('{{rootPath}}/'.length) };
  }
  if (docPath.startsWith('{{skillPath}}/')) {
    return { base: skill, rest: docPath.slice('{{skillPath}}/'.length) };
  }
  return { base: ctx.pipelineDir, rest: docPath };
};

/** The bytes a save writes: two-space JSON, trailing newline, keys in the order received. */
export const serialisePipelineFile = (raw: unknown): string => `${JSON.stringify(raw, null, 2)}\n`;
