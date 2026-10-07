import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';

/** This repository (factories-tools): the tool lives at <tools>/validation. */
export const TOOLS_ROOT: string = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
/**
 * The kit (vitkuz/factories) as a project mounts it beside this repository: `<project>/factories`.
 * Present when this repository is itself mounted in a project at `<project>/factories-tools`.
 */
export const FACTORIES_ROOT: string = path.resolve(TOOLS_ROOT, '..', 'factories');
/** The skills (vitkuz/factories-skills), mounted beside it at `<project>/factories-skills`. */
export const SKILLS_ROOT: string = path.resolve(TOOLS_ROOT, '..', 'factories-skills');

/** True when the sibling kit is there: the tests that check every real factory need it. */
export const hasSiblingKit = (): boolean =>
  existsSync(path.join(FACTORIES_ROOT, 'pipeline.schema.json'));

/** A suite that needs the sibling kit: one skipped placeholder when it is not mounted. */
export const describeWithKit = (name: string, body: () => void): void => {
  describe(name, () => {
    if (hasSiblingKit()) {
      body();
      return;
    }
    it.skip(`needs the kit mounted beside this repository at ${FACTORIES_ROOT}`, () => {});
  });
};

/** The ids the sibling skills repository wraps: every folder holding a SKILL.md. */
export const kitSkillIds = (): string[] =>
  existsSync(SKILLS_ROOT)
    ? readdirSync(SKILLS_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .filter((name: string): boolean => existsSync(path.join(SKILLS_ROOT, name, 'SKILL.md')))
    : [];

export interface FixtureProject {
  root: string;
  remove: () => void;
}

/**
 * A throwaway project the way a consumer has it: `factories`, `factories-tools` and
 * `factories-skills` link to the three mounts (as the submodules would), `.claude/skills/<id>`
 * links to the wrapper skills, and `factories.local/<id>` holds what `local` lists. Every real
 * pipeline is checked against this, never against the kit's own folder.
 */
export const fixtureProject = (local: Readonly<Record<string, string>> = {}): FixtureProject => {
  const root: string = mkdtempSync(path.join(os.tmpdir(), 'factory-kit-project-'));
  mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  symlinkSync(FACTORIES_ROOT, path.join(root, 'factories'), 'dir');
  symlinkSync(TOOLS_ROOT, path.join(root, 'factories-tools'), 'dir');
  symlinkSync(SKILLS_ROOT, path.join(root, 'factories-skills'), 'dir');
  for (const [id, pipelineText] of Object.entries(local)) {
    mkdirSync(path.join(root, 'factories.local', id, 'knowledge'), { recursive: true });
    writeFileSync(path.join(root, 'factories.local', id, 'pipeline.json'), pipelineText);
    mkdirSync(path.join(root, '.claude', 'skills', id), { recursive: true });
  }
  return { root, remove: (): void => rmSync(root, { recursive: true, force: true }) };
};

/** Link every wrapper skill into the fixture's .claude/skills, as factories-skills/install.sh does. */
export const installSkills = (root: string, ids: readonly string[]): void => {
  for (const id of ids) {
    const link: string = path.join(root, '.claude', 'skills', id);
    try {
      symlinkSync(path.join('..', '..', 'factories-skills', id), link, 'dir');
    } catch {
      // a local factory already has a real folder there
    }
  }
};
