import { describe, expect, it } from 'vitest';
import {
  answerFromText,
  answerSchemaFor,
  modelFor,
  withReportBlock,
  withRole,
} from '../src/adapters/agent-shared/index.js';

const EVENTS: string[] = ['APPROVE', 'REVISE'];

describe('shared answer parsing', () => {
  it('puts the role at the very top and says it holds for the whole task', () => {
    const prompt: string = withRole('You are strict.', 'Review it.');

    expect(prompt.startsWith('## Role\nYou are strict.')).toBe(true);
    expect(prompt).toContain('applies for the whole task');
    expect(prompt.endsWith('Review it.')).toBe(true);
    expect(withRole(undefined, 'Review it.')).toBe('Review it.');
    expect(withRole('  ', 'Review it.')).toBe('Review it.');
  });

  it('reads the event and the scalar report from a final fenced json block', () => {
    const text = [
      'Three problems found.',
      '',
      '```json',
      '{"event": "REVISE", "report": {"findings": 3, "clean": false, "nested": {"no": 1}}}',
      '```',
    ].join('\n');

    expect(answerFromText(text, EVENTS)).toEqual({
      event: 'REVISE',
      reported: { findings: 3, clean: false },
    });
  });

  it('takes the last block that is an answer, whatever other json the text quotes', () => {
    const text =
      'Config was:\n```json\n{"port": 1}\n```\nFirst thought:\n```json\n{"event":"REVISE"}\n```\nFinal:\n```json\n{"event":"APPROVE","report":{"n":2}}\n```\n';

    expect(answerFromText(text, EVENTS)).toEqual({ event: 'APPROVE', reported: { n: 2 } });
  });

  it('falls back to the last line — before or after a block that names no event', () => {
    expect(answerFromText('All good.\n\n**APPROVE**', EVENTS)).toEqual({
      event: 'APPROVE',
      reported: {},
    });
    expect(answerFromText('APPROVE\n```json\n{"port": 1}\n```', EVENTS).event).toBe('APPROVE');
    expect(answerFromText('```json\n{not json}\n```\nREVISE', EVENTS).event).toBe('REVISE');
  });

  it('names no event when the text holds none — that is asked again, not thrown', () => {
    expect(answerFromText('I approve of this.', EVENTS)).toEqual({ reported: {} });
    expect(answerFromText('', EVENTS)).toEqual({ reported: {} });
  });

  it('hands back an event the step does not know, so the retry can name it', () => {
    expect(answerFromText('```json\n{"event":"MAYBE"}\n```', EVENTS).event).toBe('MAYBE');
  });

  it('adds the report-block instruction after the task, with the events in it', () => {
    const prompt: string = withReportBlock('Review it.', EVENTS);

    expect(prompt.startsWith('Review it.')).toBe(true);
    expect(prompt).toContain('```json\n{"event": "<APPROVE | REVISE>", "report": {}}\n```');
  });

  it('keeps the answer schema an enum of the events', () => {
    expect(JSON.parse(answerSchemaFor(EVENTS)).properties.event.enum).toEqual(EVENTS);
  });

  it('maps a tier through the harness map, and a step with no model to the default', () => {
    const pick = modelFor({ models: { opus: 'gpt-6-astra' }, defaultModel: 'gpt-5.6-luna' });

    expect(pick('opus')).toBe('gpt-6-astra');
    expect(pick('haiku')).toBeUndefined();
    expect(pick(undefined)).toBe('gpt-5.6-luna');
    expect(modelFor({})(undefined)).toBeUndefined();
  });
});
