import { describe, expect, it } from 'vitest';
import type { ResolvedStep } from '../../src/features/pipeline/pipeline.types.js';
import {
  buildRetryPrompt,
  buildStepPrompt,
} from '../../src/features/prompt/services/build-step-prompt.service.js';
import { decisionText } from '../../src/features/prompt/services/write-decision.service.js';

const step: ResolvedStep = {
  name: 'write',
  agent: 'general-purpose',
  isHuman: false,
  prompt: 'Write the report.',
  input: ['/run/1-a/notes.md', '/run/2-b/*.md'],
  output: ['/run/3-write/report.md'],
  knowledge: ['/repo/k/style.md'],
  workDir: '/run',
  transitions: { DONE: { target: ['END'] }, STUCK: { target: ['END'] } },
};

describe('buildStepPrompt', () => {
  it('follows the task-message order of runner.md', () => {
    const text = buildStepPrompt(
      step,
      {
        knowledge: [{ file: '/repo/k/style.md', text: 'Be brief.' }],
        missingKnowledge: ['/repo/k/missing.md'],
        inputs: [
          { declared: '/run/1-a/notes.md', files: ['/run/1-a/notes.md'] },
          { declared: '/run/2-b/*.md', files: [] },
        ],
        notes: [],
      },
      {
        pass: 2,
        enteredBy: { from: 'review', event: 'REVISE' },
        feedbackFiles: ['/run/4-review/review.md'],
        revisionNote: 'recount',
      },
    );
    const order = [
      'Write the report.',
      '## Revision pass 2',
      'Note from "review": recount',
      '## Knowledge',
      '<knowledge file="style.md">',
      '## Knowledge not available',
      '## Input files',
      'not present on this pass',
      '## Output files',
      '## Working directory',
      '## Events',
      '`DONE`, `STUCK`',
    ];
    const positions = order.map((part) => text.indexOf(part));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('has no revision section on a first pass', () => {
    const text = buildStepPrompt(
      step,
      { knowledge: [], missingKnowledge: [], inputs: [], notes: [] },
      { pass: 1, feedbackFiles: [] },
    );
    expect(text).not.toContain('## Revision pass');
    expect(text).not.toContain('## Knowledge');
  });

  it('asks once more for the event only', () => {
    expect(buildRetryPrompt('FINISHED', ['DONE'])).toContain(
      '"FINISHED" is not an event of this step. Return exactly one of: DONE.',
    );
    expect(buildRetryPrompt(undefined, ['DONE'])).toContain('Your answer named no event.');
  });

  it('writes a decision file a later step can read', () => {
    expect(
      decisionText(step, { event: 'REJECT', note: 'recount', at: '2026-10-07T12:00:00Z' }),
    ).toContain('- **Answer:** REJECT');
    expect(decisionText(step, { event: 'APPROVE', note: '', at: 'x' })).toContain('_none_');
  });
});
