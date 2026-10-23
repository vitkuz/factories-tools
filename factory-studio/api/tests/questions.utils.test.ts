import { describe, expect, it } from 'vitest';
import type { Answer, Question } from '../src/features/questions/questions.types.js';
import {
  answerToValue,
  buildAnswersMap,
  validateAnswers,
} from '../src/features/questions/questions.utils.js';

const QUESTIONS: Question[] = [
  {
    header: 'Size',
    question: 'Size?',
    multiSelect: false,
    options: [
      { label: 'S', description: '' },
      { label: 'M', description: '' },
    ],
  },
  {
    header: 'Toppings',
    question: 'Which toppings?',
    multiSelect: true,
    options: [
      { label: 'Ham', description: '' },
      { label: 'Olives', description: '' },
    ],
  },
];

describe('answer values', () => {
  it('joins multi-select labels with ", ", appends text, or uses the text alone', () => {
    expect(answerToValue({ question: 'q', selected: ['Ham', 'Olives'] })).toBe('Ham, Olives');
    expect(answerToValue({ question: 'q', selected: ['Ham'], text: ' extra ' })).toBe('Ham, extra');
    expect(answerToValue({ question: 'q', selected: [], text: 'my own' })).toBe('my own');
  });

  it('keys the map by the exact question text', () => {
    expect(
      buildAnswersMap([
        { question: 'Size?', selected: ['M'] },
        { question: 'Which toppings?', selected: ['Ham', 'Olives'] },
      ]),
    ).toEqual({ 'Size?': 'M', 'Which toppings?': 'Ham, Olives' });
  });
});

describe('validateAnswers', () => {
  const ok: Answer[] = [
    { question: 'Size?', selected: ['M'] },
    { question: 'Which toppings?', selected: ['Ham', 'Olives'] },
  ];

  it('accepts answers that cover every question with real options', () => {
    expect(validateAnswers(QUESTIONS, ok)).toBeNull();
  });

  it('accepts free text in place of an option', () => {
    expect(
      validateAnswers(QUESTIONS, [
        { question: 'Size?', selected: [], text: 'XXL' },
        ok[1] as Answer,
      ]),
    ).toBeNull();
  });

  it('names the problem for a missing, unknown, stray or too-many answer', () => {
    expect(validateAnswers(QUESTIONS, [ok[0] as Answer])).toContain('not answered');
    expect(validateAnswers(QUESTIONS, [...ok, { question: 'Other?', selected: ['x'] }])).toContain(
      'unknown question',
    );
    expect(
      validateAnswers(QUESTIONS, [{ question: 'Size?', selected: ['XL'] }, ok[1] as Answer]),
    ).toContain('not an option');
    expect(
      validateAnswers(QUESTIONS, [{ question: 'Size?', selected: ['S', 'M'] }, ok[1] as Answer]),
    ).toContain('takes one option');
  });
});
