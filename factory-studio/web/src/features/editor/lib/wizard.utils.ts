import type { Issue, Pipeline, WizardScreen } from './pipeline.types';
import { END } from './pipeline.types';
import { freeName, insertStep } from './pipeline.utils';

/** The screens of the wizard, in order. */
export const WIZARD_SCREENS: readonly WizardScreen[] = ['pipeline', 'steps', 'wiring', 'review'];

export const SCREEN_TITLES: Record<WizardScreen, string> = {
  pipeline: 'Pipeline',
  steps: 'Steps',
  wiring: 'Wiring',
  review: 'Review',
};

export const SCREEN_GUIDES: Record<WizardScreen, string> = {
  pipeline:
    'Name the pipeline and say where a run writes its files. Constants are baked in (rootPath, skillPath and homePath are fixed anchors; factoryPath names the factory folder factories/<id>); params are asked for on every run when their default is empty.',
  steps:
    'Add the steps one by one: which agent runs, what it is told, and which files it reads and writes. Wiring comes next — leave the events for now.',
  wiring:
    'Tick the step(s) START fans out to, then walk each step: every event it can return, where that event goes, how often a loop may run, and where it goes once the cap is spent.',
  review:
    'The same checks the editor runs on every keystroke. Errors will make the validator (factories-tools/bin/validate.mjs) reject the file; warnings are worth a look. Finish lands you in the editor, and Save creates factories/<id>/pipeline.json in the kit with its wrapper skill (factories-skills/<id>, linked into .claude/skills).',
};

/**
 * The smallest pipeline the schema accepts, laid out like every factory on disk: the shared
 * schema for editor autocomplete, the three anchors and `factoryPath`, and the `before` hook
 * that copies the graph into the run folder (the snapshot the Runs screen draws); one step
 * that goes straight to END. Save creates `factories/<id>/pipeline.json` and its wrapper skill.
 */
export const blankPipeline = (): Pipeline =>
  insertStep(
    {
      $schema: '../pipeline.schema.json',
      id: 'my-factory',
      constants: {
        rootPath: 'cwd',
        skillPath: '.',
        homePath: '~',
        factoryPath: '{{rootPath}}/factories/{{id}}',
      },
      params: {},
      outputDir: '{{rootPath}}/run/{{id}}/{{slug}}-{{date}}',
      START: ['first-step'],
      steps: {},
      keyOrder: [
        '$schema',
        'id',
        'description',
        'constants',
        'params',
        'outputDir',
        'hooks',
        'START',
        'steps',
      ],
      extras: {
        hooks: { before: ['cp {{factoryPath}}/pipeline.json {{outputDir}}/pipeline.json'] },
      },
    },
    'first-step',
    null,
    '',
  );

/** The current pipeline with one more step in it, unwired, ready to fill in. */
export const withNewStep = (pipeline: Pipeline): [Pipeline, string] => {
  const name: string = freeName(pipeline, 'new-step');
  return [insertStep(pipeline, name, null, ''), name];
};

const isWiring = (issue: Issue): boolean =>
  issue.where.includes('.transitions') ||
  issue.where === '<root>.START' ||
  issue.where === '<root>.steps' ||
  issue.message.includes('unreachable') ||
  issue.message.includes('END is not reachable') ||
  issue.message.includes('loop back');

/** The issues a screen is responsible for. Review shows all of them. */
export const issuesForScreen = (issues: Issue[], screen: WizardScreen): Issue[] => {
  switch (screen) {
    case 'pipeline':
      return issues.filter(
        (issue: Issue): boolean => issue.where.startsWith('<root>') && !isWiring(issue),
      );
    case 'steps':
      return issues.filter(
        (issue: Issue): boolean => issue.where.startsWith('steps.') && !isWiring(issue),
      );
    case 'wiring':
      return issues.filter(isWiring);
    default:
      return issues;
  }
};

/** How many edges a pipeline draws, `target` and `onMax` alike. */
export const edgeCount = (pipeline: Pipeline): number =>
  Object.values(pipeline.steps).reduce(
    (sum: number, step): number =>
      sum +
      Object.values(step.transitions).reduce(
        (inner: number, edge): number => inner + edge.target.length + (edge.onMax ?? []).length,
        0,
      ),
    0,
  );

/** Steps that nothing points at and START does not name: they would never run. */
export const orphanSteps = (pipeline: Pipeline): string[] => {
  const targeted = new Set<string>(pipeline.START);
  for (const step of Object.values(pipeline.steps)) {
    for (const edge of Object.values(step.transitions)) {
      for (const target of [...edge.target, ...(edge.onMax ?? [])]) {
        if (target !== END) targeted.add(target);
      }
    }
  }
  return Object.keys(pipeline.steps).filter((name: string): boolean => !targeted.has(name));
};
