import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatItem, MapContext, TranscriptRecord } from '../src/features/chat/chat.types.js';
import {
  DEFAULT_LIMITS,
  byTime,
  capItems,
  formatDuration,
  isTranscriptPath,
  parseRecord,
  parseRef,
  projectDirName,
  recordToItems,
  splitLines,
  subagentIdOf,
  summarizeInput,
  toolUsesOf,
  transcriptFiles,
  transcriptPathFor,
  truncate,
} from '../src/features/chat/chat.utils.js';

/** Cut from a real ask-questions-test-factory session, paths and long text scrubbed. */
const FIXTURE: string = path.join(import.meta.dirname, 'fixtures', 'transcript', 'session.jsonl');

const ctx = (overrides: Partial<MapContext> = {}): MapContext => ({
  toolNames: new Map(),
  limits: DEFAULT_LIMITS,
  line: { source: 'main', start: 0, end: 10 },
  ...overrides,
});

/** Every item of the fixture, mapped the way the tailer does it: tool names carried forward. */
const mapFixture = (): ChatItem[] => {
  const names: Map<string, string> = new Map();
  return readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line: string): ChatItem[] => {
      const record: TranscriptRecord | null = parseRecord(line);
      if (record === null) return [];
      for (const [id, name] of toolUsesOf(record)) names.set(id, name);
      return recordToItems(record, ctx({ toolNames: names }));
    });
};

describe('splitLines', () => {
  it('cuts complete lines with byte positions and carries the unfinished tail', () => {
    const first = splitLines(Buffer.alloc(0), 0, Buffer.from('{"a":1}\n{"b":"é"}\n{"c"'));
    expect(first.lines.map((l) => [l.text, l.start, l.end])).toEqual([
      ['{"a":1}', 0, 7],
      // `é` is two bytes: positions are bytes, not characters.
      ['{"b":"é"}', 8, 18],
    ]);
    expect(first.rest.toString()).toBe('{"c"');
    expect(first.restStart).toBe(19);
    const second = splitLines(first.rest, first.restStart, Buffer.from(':3}\n'));
    expect(second.lines).toEqual([{ text: '{"c":3}', start: 19, end: 26 }]);
    expect(second.rest.length).toBe(0);
    expect(second.restStart).toBe(27);
  });

  it('skips blank lines and keeps everything when no newline came yet', () => {
    expect(splitLines(Buffer.alloc(0), 0, Buffer.from('\n\n')).lines).toEqual([]);
    const none = splitLines(Buffer.alloc(0), 5, Buffer.from('{"half'));
    expect(none.lines).toEqual([]);
    expect(none.restStart).toBe(5);
  });
});

describe('parseRecord', () => {
  it('reads any record with a type and refuses what is not one', () => {
    expect(parseRecord('{"type":"brand-new-kind","x":1}')).toMatchObject({
      type: 'brand-new-kind',
    });
    expect(parseRecord('not json')).toBeNull();
    expect(parseRecord('{"no":"type"}')).toBeNull();
  });
});

describe('recordToItems on a real transcript', () => {
  const items: ChatItem[] = mapFixture();

  it('turns the session into a readable chat and drops the bookkeeping records', () => {
    const kinds: string[] = items.map((item: ChatItem): string => item.kind);
    expect(kinds[0]).toBe('user');
    expect(items[0]?.text).toBe('/ask-questions-test-factory label=run-page-ask-test');
    // Attachments, api requests, mode switches, snapshots: none of them is a chat row.
    expect(new Set(kinds)).toEqual(
      new Set(['user', 'tool_call', 'tool_result', 'thinking', 'assistant', 'system']),
    );
    expect(items.filter((item: ChatItem): boolean => item.kind === 'assistant')).toHaveLength(2);
  });

  it('summarises tool calls and labels their results with the tool name', () => {
    const ask: ChatItem | undefined = items.find(
      (item: ChatItem): boolean => item.kind === 'tool_call' && item.tool === 'AskUserQuestion',
    );
    expect(ask?.text).toBe('Which colour do you like most? (+2 more)');
    expect(ask?.input).toContain('"questions"');
    const result: ChatItem | undefined = items.find(
      (item: ChatItem): boolean => item.kind === 'tool_result' && item.toolUseId === ask?.toolUseId,
    );
    expect(result?.tool).toBe('AskUserQuestion');
    expect(result?.output).toContain('The user answered');
    const agent: ChatItem | undefined = items.find(
      (item: ChatItem): boolean => item.tool === 'Agent' && item.kind === 'tool_call',
    );
    expect(agent?.text).toBe('Record all answers');
  });

  it('shows the background task notice and the turn time as system lines', () => {
    const system: string[] = items
      .filter((item: ChatItem): boolean => item.kind === 'system')
      .map((item: ChatItem): string => item.text);
    expect(system).toContain('Agent "Record all answers" finished (completed)');
    expect(system).toContain('Turn finished · 1m 55s');
  });

  it('gives every item a unique id', () => {
    expect(new Set(items.map((item: ChatItem): string => item.id)).size).toBe(items.length);
  });
});

describe('recordToItems edge cases', () => {
  const assistant = (content: unknown[]): TranscriptRecord => ({
    type: 'assistant',
    uuid: 'u1',
    timestamp: '2026-10-23T10:00:00.000Z',
    message: { role: 'assistant', content },
  });

  it('cuts a long output and leaves a ref to the whole line', () => {
    const record: TranscriptRecord = {
      type: 'user',
      uuid: 'u2',
      timestamp: 't',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: 'x'.repeat(5000) }],
      },
    };
    const [item] = recordToItems(record, ctx({ line: { source: 'main', start: 100, end: 5200 } }));
    expect(item?.output?.length).toBeLessThan(2100);
    expect(item?.output).toContain('3,000 more characters');
    expect(item?.ref).toBe('main:100:5200');
  });

  it('marks items of a subagent with its id and the call that started it', () => {
    const [item] = recordToItems(
      assistant([{ type: 'text', text: 'done' }]),
      ctx({ agent: { agentId: 'a1', parentToolUseId: 'toolu_1' } }),
    );
    expect(item).toMatchObject({
      id: 'a1.u1.0',
      kind: 'assistant',
      agentId: 'a1',
      parentToolUseId: 'toolu_1',
    });
  });

  it('keeps the subagent prompt out: the call already shows it', () => {
    const prompt: TranscriptRecord = {
      type: 'user',
      uuid: 'u3',
      message: { role: 'user', content: 'You are a clerk…' },
    };
    expect(recordToItems(prompt, ctx({ agent: { agentId: 'a1' } }))).toEqual([]);
    expect(recordToItems(prompt, ctx())).toHaveLength(1);
  });

  it('skips meta records and reads a compaction summary as a system line', () => {
    expect(
      recordToItems(
        { type: 'user', isMeta: true, message: { role: 'user', content: 'skill body' } },
        ctx(),
      ),
    ).toEqual([]);
    const [summary] = recordToItems(
      {
        type: 'user',
        uuid: 'u4',
        isCompactSummary: true,
        message: { role: 'user', content: 'This session is being continued…' },
      },
      ctx(),
    );
    expect(summary).toMatchObject({ kind: 'system', text: 'Conversation compacted' });
  });

  it('carries thinking time and drops unknown block types', () => {
    const items: ChatItem[] = recordToItems(
      {
        ...assistant([{ type: 'thinking', thinking: 'hmm' }, { type: 'mystery' }]),
        thinkingDurationMs: 3200,
      },
      ctx(),
    );
    expect(items).toEqual([expect.objectContaining({ kind: 'thinking', durationMs: 3200 })]);
  });
});

describe('small helpers', () => {
  it('summarises inputs by the field that says what the call does', () => {
    expect(summarizeInput('Bash', { command: 'ls -la', description: 'List files' })).toBe(
      'List files',
    );
    expect(summarizeInput('Read', { file_path: '/a/b.ts' })).toBe('/a/b.ts');
    expect(summarizeInput('X', { other: 'first  text\nhere' })).toBe('first text here');
    expect(summarizeInput('X', null)).toBe('');
  });

  it('truncates, formats durations, caps item lists', () => {
    expect(truncate('abc', 5)).toEqual({ text: 'abc', cut: false });
    expect(truncate('abcdef', 3).cut).toBe(true);
    expect(formatDuration(850)).toBe('850ms');
    expect(formatDuration(115_081)).toBe('1m 55s');
    const items: ChatItem[] = [1, 2, 3].map((n: number): ChatItem => ({
      id: String(n),
      kind: 'user',
      text: '',
      ts: '',
    }));
    expect(capItems(items, 2)).toEqual({ items: items.slice(1), dropped: 1 });
  });

  it('orders items of several files by time, stably, carrying a missing time forward', () => {
    const at = (id: string, ts: string): ChatItem => ({ id, kind: 'system', text: '', ts });
    expect(
      byTime([at('m1', 't1'), at('m2', 't3'), at('m3', ''), at('a1', 't2'), at('a2', 't2')]).map(
        (item: ChatItem): string => item.id,
      ),
    ).toEqual(['m1', 'a1', 'a2', 'm2', 'm3']);
  });

  it('parses refs and refuses junk', () => {
    expect(parseRef('main:10:20')).toEqual({ source: 'main', start: 10, end: 20 });
    expect(parseRef('a1:20:10')).toBeNull();
    expect(parseRef('../x:1:2')).toBeNull();
  });

  it('maps a working directory to its project folder and transcript files', () => {
    expect(projectDirName('/home/u/smekalka-test_pipline')).toBe('-home-u-smekalka-test-pipline');
    const main: string = transcriptPathFor('/p', '/home/u/w', 'c-1');
    expect(main).toBe('/p/-home-u-w/c-1.jsonl');
    expect(transcriptFiles(main).subagentsDir).toBe('/p/-home-u-w/c-1/subagents');
    expect(subagentIdOf('agent-a27458932f1ad0ea7.jsonl')).toBe('a27458932f1ad0ea7');
    expect(subagentIdOf('agent-a1.meta.json')).toBeNull();
  });

  it('reads transcripts only inside the projects folder', () => {
    expect(isTranscriptPath('/p', '/p/-w/c.jsonl')).toBe(true);
    expect(isTranscriptPath('/p', '/p/../etc/passwd.jsonl')).toBe(false);
    expect(isTranscriptPath('/p', '/p/-w/c.json')).toBe(false);
  });
});
