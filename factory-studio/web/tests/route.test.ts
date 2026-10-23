import { describe, expect, it } from 'vitest';
import { buildHash, buildSearch, readRunTab, readView } from '../src/shared/lib/route';

describe('readRunTab', () => {
  it('reads the tab the query names', () => {
    expect(readRunTab('?view=timeline')).toBe('timeline');
    expect(readRunTab('?view=graph')).toBe('graph');
    expect(readRunTab('view=timeline')).toBe('timeline');
  });

  it('is null for no tab or one it does not know', () => {
    expect(readRunTab('')).toBeNull();
    expect(readRunTab('?')).toBeNull();
    expect(readRunTab('?view=detailed')).toBeNull();
    expect(readRunTab('?other=1')).toBeNull();
  });
});

describe('buildSearch', () => {
  it('sets the tab and keeps other keys', () => {
    expect(buildSearch('', 'timeline')).toBe('?view=timeline');
    expect(buildSearch('?view=timeline', 'graph')).toBe('?view=graph');
    expect(buildSearch('?a=1', 'timeline')).toBe('?a=1&view=timeline');
  });

  it('round-trips through readRunTab', () => {
    expect(readRunTab(buildSearch('?a=1', 'timeline'))).toBe('timeline');
  });
});

describe('card mode in the hash', () => {
  it('writes #cards=detailed and reads it back', () => {
    expect(buildHash('detailed')).toBe('#cards=detailed');
    expect(buildHash('compact')).toBe('');
    expect(readView(buildHash('detailed'))).toBe('detailed');
  });

  it("still reads an old link's #view=detailed", () => {
    expect(readView('#view=detailed')).toBe('detailed');
    expect(readView('')).toBe('compact');
    expect(readView('#cards=compact')).toBe('compact');
  });

  it('does not take the query tab for a card mode', () => {
    expect(readView('?view=timeline')).toBe('compact');
  });
});
