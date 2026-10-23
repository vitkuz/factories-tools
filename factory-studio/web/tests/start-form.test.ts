import { describe, expect, it } from 'vitest';
import {
  pipelineListEntrySchema,
  startSessionPayloadSchema,
} from '../src/features/sessions/sessions.schema';
import type {
  FactoryParam,
  ParamDraft,
  PipelineListEntry,
} from '../src/features/sessions/sessions.types';
import {
  buildStartRequest,
  initialParamDraft,
  invalidParams,
  missingParams,
  paramWidget,
  serializeParams,
  startBlocker,
} from '../src/features/sessions/sessions.utils';

const param = (
  name: string,
  value: string | number | boolean,
  main: boolean = false,
): FactoryParam => ({
  name,
  type: typeof value as FactoryParam['type'],
  default: value,
  required: value === '',
  main,
});

const PARAMS: FactoryParam[] = [
  param('topic', '', true),
  param('sub_questions', 5),
  param('ratio', 0.5),
  param('deep', false),
  param('language', 'English'),
];

const entry = (params: FactoryParam[]): PipelineListEntry => ({
  id: 'sample-factory',
  path: 'factories/sample-factory/pipeline.json',
  pipeline: { id: 'sample-factory' },
  params,
});

describe('paramWidget', () => {
  it('a checkbox for a boolean, a number input for a number', () => {
    expect(paramWidget(param('deep', false))).toBe('checkbox');
    expect(paramWidget(param('words', 1500))).toBe('number');
  });

  it('text: a textarea only for a long default or one with a newline, whatever the name', () => {
    expect(paramWidget(param('topic', ''))).toBe('text');
    expect(paramWidget(param('question', 'short'))).toBe('text');
    expect(paramWidget(param('x', 'a'.repeat(41)))).toBe('textarea');
    expect(paramWidget(param('x', 'a'.repeat(40)))).toBe('text');
    expect(paramWidget(param('x', 'one\ntwo'))).toBe('textarea');
  });
});

describe('a param set no code knows about', () => {
  // Invented: as if someone added these to a pipeline.json today, with no code change.
  const invented: FactoryParam[] = pipelineListEntrySchema.parse({
    id: 'never-seen-factory',
    path: 'factories.local/never-seen-factory/pipeline.json',
    pipeline: { id: 'never-seen-factory' },
    params: [
      { name: 'zz_target', type: 'string', default: '', required: true, main: true },
      { name: 'retries_9', type: 'number', default: 3, required: false, main: false },
      { name: 'temperature', type: 'number', default: 0.7, required: false, main: false },
      { name: 'dry', type: 'boolean', default: true, required: false, main: false },
      {
        name: 'notes',
        type: 'string',
        default: 'line one\nline two',
        required: false,
        main: false,
      },
    ],
  }).params;

  it('every param gets a field, a default, a widget from its type, and goes out typed', () => {
    expect(invented.map(paramWidget)).toEqual(['text', 'number', 'number', 'checkbox', 'textarea']);
    const draft: ParamDraft = initialParamDraft(invented);
    expect(draft).toEqual({
      zz_target: '',
      retries_9: '3',
      temperature: '0.7',
      dry: true,
      notes: 'line one\nline two',
    });
    const e: PipelineListEntry = { ...entry(invented), id: 'never-seen-factory' };
    expect(startBlocker(e, draft, '')).toBe('Fill in zz_target');
    expect(
      buildStartRequest(e, { ...draft, zz_target: 'a b', retries_9: '4', dry: false }, '').params,
    ).toEqual({
      zz_target: 'a b',
      retries_9: 4,
      temperature: 0.7,
      dry: false,
      notes: 'line one\nline two',
    });
  });
});

describe('initialParamDraft', () => {
  it('every param at its default, numbers as their text, booleans as booleans', () => {
    expect(initialParamDraft(PARAMS)).toEqual({
      topic: '',
      sub_questions: '5',
      ratio: '0.5',
      deep: false,
      language: 'English',
    });
    expect(initialParamDraft([])).toEqual({});
  });
});

describe('missingParams / invalidParams', () => {
  it('a blank required text is missing, whitespace included', () => {
    expect(missingParams(PARAMS, initialParamDraft(PARAMS))).toEqual(['topic']);
    expect(missingParams(PARAMS, { ...initialParamDraft(PARAMS), topic: '  ' })).toEqual(['topic']);
    expect(missingParams(PARAMS, { ...initialParamDraft(PARAMS), topic: 'x' })).toEqual([]);
  });

  it('a number must be a number, and whole when the default is whole', () => {
    const draft: ParamDraft = { ...initialParamDraft(PARAMS), sub_questions: '2.5', ratio: 'x' };
    expect(invalidParams(PARAMS, draft)).toEqual(['sub_questions', 'ratio']);
    expect(invalidParams(PARAMS, { ...draft, sub_questions: '', ratio: '0.75' })).toEqual([
      'sub_questions',
    ]);
    expect(invalidParams(PARAMS, { ...draft, sub_questions: ' 3 ', ratio: '1' })).toEqual([]);
  });
});

describe('serializeParams', () => {
  it('numbers as numbers, booleans as booleans, text exactly as typed', () => {
    const draft: ParamDraft = {
      topic: `AI "dark" factories\nit's $(whoami)  `,
      sub_questions: ' 3 ',
      ratio: '0.25',
      deep: true,
      language: 'Русский',
    };
    expect(serializeParams(PARAMS, draft)).toEqual({
      topic: `AI "dark" factories\nit's $(whoami)  `,
      sub_questions: 3,
      ratio: 0.25,
      deep: true,
      language: 'Русский',
    });
  });

  it('a param the draft does not hold yet goes at its default', () => {
    expect(serializeParams(PARAMS, { topic: 't' })).toEqual({
      topic: 't',
      sub_questions: 5,
      ratio: 0.5,
      deep: false,
      language: 'English',
    });
  });
});

describe('startBlocker / buildStartRequest', () => {
  it('a factory with params waits for the required ones and valid numbers, not for the prompt', () => {
    const e: PipelineListEntry = entry(PARAMS);
    const draft: ParamDraft = initialParamDraft(PARAMS);
    expect(startBlocker(e, draft, '')).toBe('Fill in topic');
    expect(startBlocker(e, { ...draft, topic: 'x', sub_questions: 'many' }, '')).toBe(
      'sub_questions: not a valid number',
    );
    expect(startBlocker(e, { ...draft, topic: 'x' }, '')).toBeNull();
  });

  it('a factory without params falls back to the one prompt', () => {
    expect(startBlocker(entry([]), {}, '  ')).toBe('Write what the factory should do');
    expect(startBlocker(entry([]), {}, 'do it')).toBeNull();
    expect(startBlocker(undefined, {}, 'do it')).toBe('Pick a factory');
  });

  it('sends the params and the trimmed extra instructions, and passes the API rules', () => {
    const request = buildStartRequest(
      entry(PARAMS),
      { ...initialParamDraft(PARAMS), topic: 'agents' },
      '  Keep it short. ',
    );
    expect(request).toEqual({
      id: 'sample-factory',
      params: { topic: 'agents', sub_questions: 5, ratio: 0.5, deep: false, language: 'English' },
      prompt: 'Keep it short.',
    });
    expect(startSessionPayloadSchema.safeParse({ ...request, harness: 'claude' }).success).toBe(
      true,
    );
    const bare = buildStartRequest(entry([]), {}, 'do it');
    expect(bare).toEqual({ id: 'sample-factory', params: {}, prompt: 'do it' });
    expect(
      startSessionPayloadSchema.safeParse({
        id: 'x-factory',
        params: {},
        prompt: ' ',
        harness: 'claude',
      }).success,
    ).toBe(false);
  });
});

describe('pipelineListEntrySchema', () => {
  it('reads params and description, and an older API without params as none', () => {
    const parsed: PipelineListEntry = pipelineListEntrySchema.parse({
      id: 'a-factory',
      path: 'factories/a-factory/pipeline.json',
      pipeline: { id: 'a-factory' },
    });
    expect(parsed.params).toEqual([]);
    expect(parsed.description).toBeUndefined();
  });
});
