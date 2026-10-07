import { describe, expect, it } from 'vitest';
import {
  buildFactoryPrompt,
  buildSessionName,
  formatAge,
  matchesFactoryId,
  shellQuote,
  stripFactorySuffix,
  toFactorySession,
} from '../src/features/sessions/sessions.utils.js';
import type { FactorySession } from '../src/features/sessions/sessions.types.js';

describe('session naming', () => {
  it('strips -factory and keeps eight hex chars of the uuid', () => {
    expect(buildSessionName('canonical-factory', '7f3a9c2b-1111-2222-3333-444444444444')).toBe(
      'factory-canonical-7f3a9c2b',
    );
  });

  it('leaves an id without the suffix alone', () => {
    expect(stripFactorySuffix('research')).toBe('research');
    expect(stripFactorySuffix('research-factory')).toBe('research');
  });

  it('builds the prompt as the skill invocation followed by the message', () => {
    expect(buildFactoryPrompt('research-factory', 'AI dark factories')).toBe(
      '/research-factory AI dark factories',
    );
  });
});

describe('formatAge', () => {
  it.each([
    [0, '0s'],
    [59, '59s'],
    [60, '1m'],
    [3_600, '1h'],
    [3_600 + 14 * 60, '1h 14m'],
    [86_400, '1d'],
    [86_400 + 3 * 3_600 + 5, '1d 3h'],
  ])('%d seconds -> %s', (seconds: number, expected: string) => {
    expect(formatAge(seconds)).toBe(expected);
  });
});

describe('toFactorySession', () => {
  const now: Date = new Date('2026-09-14T12:00:00Z');

  it('reads the labels when present', () => {
    const result: FactorySession = toFactorySession(
      {
        name: 'factory-research-7f3a9c2b',
        createdAt: new Date('2026-09-14T11:55:00Z'),
        labels: { harness: 'claude', factory_id: 'research-factory' },
      },
      now,
    );
    expect(result).toEqual({
      session: 'factory-research-7f3a9c2b',
      factoryId: 'research-factory',
      harness: 'claude',
      startedAt: '2026-09-14T11:55:00.000Z',
      ageSeconds: 300,
      age: '5m',
    });
  });

  it('falls back to the name when the labels are missing', () => {
    const result: FactorySession = toFactorySession(
      { name: 'factory-improve-frontend-0badf00d', createdAt: now, labels: {} },
      now,
    );
    expect(result.factoryId).toBe('improve-frontend-factory');
    expect(result.harness).toBe('unknown');
  });
});

describe('matchesFactoryId', () => {
  const s: FactorySession = {
    session: 'factory-research-7f3a9c2b',
    factoryId: 'research-factory',
    harness: 'copilot',
    startedAt: '',
    ageSeconds: 0,
    age: '0s',
  };
  it('matches the id with or without the suffix, and nothing else', () => {
    expect(matchesFactoryId(s, 'research-factory')).toBe(true);
    expect(matchesFactoryId(s, 'research')).toBe(true);
    expect(matchesFactoryId(s, 'canonical-factory')).toBe(false);
  });
});

describe('shellQuote', () => {
  it('wraps in single quotes and escapes embedded ones', () => {
    expect(shellQuote('/tmp/a b')).toBe(`'/tmp/a b'`);
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
  });
});
