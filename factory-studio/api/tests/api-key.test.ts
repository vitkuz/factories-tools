import { describe, expect, it } from 'vitest';
import { keysMatch } from '../src/shared/middleware/api-key.js';

describe('keysMatch', () => {
  it('accepts the exact key and nothing near it', () => {
    expect(keysMatch('abc123', 'abc123')).toBe(true);
    expect(keysMatch('abc12', 'abc123')).toBe(false);
    expect(keysMatch('abc1234', 'abc123')).toBe(false);
    expect(keysMatch('', 'abc123')).toBe(false);
  });
});
