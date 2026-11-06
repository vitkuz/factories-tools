import { describe, expect, it } from 'vitest';
import { clientMessageSchema, serverMessageSchema } from '../src/features/sessions/sessions.schema';
import type { ChatItem, ChatRow, ChatState } from '../src/features/chat/chat.types';
import {
  MAX_ITEMS,
  buildRows,
  composerGate,
  findRunSession,
  initialChatState,
  isNearBottom,
  isPending,
  isSendKey,
  pendingItem,
  reduceChat,
  runClaudeSessionId,
  sameRow,
} from '../src/features/chat/chat.utils';
import { buildPath, parseRoute } from '../src/shared/lib/route';

const item = (id: string, kind: ChatItem['kind'], extra: Partial<ChatItem> = {}): ChatItem => ({
  id,
  kind,
  text: id,
  ts: '2026-10-23T10:00:00.000Z',
  ...extra,
});

describe('chat protocol', () => {
  it('accepts the chat frames in the sessions socket union', () => {
    expect(
      serverMessageSchema.parse({
        type: 'session.chat.backlog',
        sessionId: 's',
        claudeSessionId: 'c',
        items: [item('a', 'user')],
        dropped: 0,
      }).type,
    ).toBe('session.chat.backlog');
    expect(
      serverMessageSchema.safeParse({
        type: 'session.chat.unavailable',
        sessionId: 's',
        reason: 'x',
      }).success,
    ).toBe(false);
    expect(clientMessageSchema.parse({ type: 'session.chat.subscribe', sessionId: 's' })).toEqual({
      type: 'session.chat.subscribe',
      sessionId: 's',
    });
  });
});

describe('reduceChat', () => {
  it('takes the backlog, appends live items once, and keeps at most MAX_ITEMS', () => {
    const live: ChatState = reduceChat(initialChatState, {
      kind: 'backlog',
      items: [item('a', 'user')],
      dropped: 4,
    });
    expect(live).toMatchObject({ phase: 'live', dropped: 4 });
    const more: ChatState = reduceChat(live, {
      kind: 'items',
      items: [item('a', 'user'), item('b', 'assistant')],
    });
    expect(more.items.map((i: ChatItem): string => i.id)).toEqual(['a', 'b']);
    const many: ChatItem[] = Array.from({ length: MAX_ITEMS + 5 }, (_v, i) =>
      item(`x${i}`, 'system'),
    );
    const capped: ChatState = reduceChat(more, { kind: 'items', items: many });
    expect(capped.items).toHaveLength(MAX_ITEMS);
    expect(capped.dropped).toBe(4 + 7);
  });

  it('says why an empty chat is empty, keeps rows already shown, and ends', () => {
    expect(
      reduceChat(initialChatState, { kind: 'unavailable', reason: 'no-transcript' }).phase,
    ).toBe('unavailable');
    const shown: ChatState = reduceChat(initialChatState, {
      kind: 'backlog',
      items: [item('a', 'user')],
      dropped: 0,
    });
    expect(reduceChat(shown, { kind: 'unavailable', reason: 'no-transcript' }).phase).toBe('live');
    const ended: ChatState = reduceChat(shown, { kind: 'ended' });
    expect(reduceChat(ended, { kind: 'reconnecting' }).phase).toBe('ended');
  });

  it('puts an uncut item in place of the cut one', () => {
    const shown: ChatState = reduceChat(initialChatState, {
      kind: 'backlog',
      items: [item('a', 'assistant', { text: 'short…', ref: 'main:0:9' })],
      dropped: 0,
    });
    const full: ChatState = reduceChat(shown, {
      kind: 'expanded',
      item: item('a', 'assistant', { text: 'the whole text', ref: 'main:0:9' }),
    });
    expect(full.items[0]).toMatchObject({ text: 'the whole text', ref: undefined });
  });
});

describe('buildRows', () => {
  it('pairs calls with results and folds a subagent under the call that started it', () => {
    const rows: ChatRow[] = buildRows([
      item('u', 'user'),
      item('c1', 'tool_call', { tool: 'Agent', toolUseId: 't1' }),
      item('s', 'subagent', { agentId: 'a1', parentToolUseId: 't1', tool: 'general-purpose' }),
      item('c2', 'tool_call', {
        tool: 'Read',
        toolUseId: 't2',
        agentId: 'a1',
        parentToolUseId: 't1',
      }),
      item('r2', 'tool_result', { toolUseId: 't2', agentId: 'a1', parentToolUseId: 't1' }),
      item('r1', 'tool_result', { toolUseId: 't1' }),
      item('done', 'assistant'),
    ]);
    expect(rows.map((row: ChatRow): string => row.kind)).toEqual(['message', 'tool', 'message']);
    const agent = rows[1];
    if (agent?.kind !== 'tool') throw new Error('expected a tool row');
    expect(agent.result?.id).toBe('r1');
    expect(agent.subagent?.id).toBe('s');
    expect(agent.children).toHaveLength(1);
    expect(agent.children[0]).toMatchObject({
      kind: 'tool',
      call: { id: 'c2' },
      result: { id: 'r2' },
    });
  });

  it('keeps a result whose call fell off, and groups a subagent whose call is unknown', () => {
    const rows: ChatRow[] = buildRows([
      item('r0', 'tool_result', { toolUseId: 'gone' }),
      item('x', 'assistant', { agentId: 'a9', parentToolUseId: 'gone-too' }),
    ]);
    expect(rows[0]).toMatchObject({ kind: 'tool', call: null, result: { id: 'r0' } });
    expect(rows[1]).toMatchObject({ kind: 'agent', key: 'agent-a9' });
  });

  it('marks a call without a result as still running (no result)', () => {
    const [row] = buildRows([item('c', 'tool_call', { tool: 'Bash', toolUseId: 't' })]);
    expect(row).toMatchObject({ kind: 'tool', result: null });
  });

  it('sees rebuilt rows over the same items as the same', () => {
    const items: ChatItem[] = [
      item('c', 'tool_call', { toolUseId: 't' }),
      item('r', 'tool_result', { toolUseId: 't' }),
    ];
    const [a] = buildRows(items);
    const [b] = buildRows([...items]);
    expect(sameRow(a as ChatRow, b as ChatRow)).toBe(true);
    const [c] = buildRows([items[0] as ChatItem]);
    expect(sameRow(a as ChatRow, c as ChatRow)).toBe(false);
  });
});

describe('run <-> session', () => {
  const sessions = [
    { session: 'factory-a-1', claudeSessionId: 'c-a' },
    { session: 'factory-b-2', claudeSessionId: 'c-b' },
  ];
  const run = { pipelineId: 'p', runId: 'r' };

  it('reads the Claude session id a run was stamped with', () => {
    expect(runClaudeSessionId({ sessionId: 'own' })).toBe('own');
    expect(
      runClaudeSessionId({
        history: [{ type: 'STEP' }, { type: 'PIPELINE_INIT', details: { sessionId: 'init' } }],
      }),
    ).toBe('init');
    expect(runClaudeSessionId(null)).toBe('');
  });

  it('finds the session by Claude session id, else by a question tied to the run', () => {
    expect(findRunSession(sessions, 'c-b', [], run)?.session).toBe('factory-b-2');
    expect(findRunSession(sessions, '', [{ sessionId: 'factory-a-1', run }], run)?.session).toBe(
      'factory-a-1',
    );
    expect(findRunSession(sessions, 'nope', [], run)).toBeNull();
  });
});

describe('chat route and scrolling', () => {
  it('opens a session chat at /sessions/<session>', () => {
    expect(parseRoute('/sessions/factory-a-1')).toEqual({
      screen: 'sessions',
      chat: 'factory-a-1',
    });
    expect(parseRoute('/sessions')).toEqual({ screen: 'sessions', chat: null });
    expect(buildPath({ screen: 'sessions', chat: 'factory-a-1' })).toBe('/sessions/factory-a-1');
    expect(buildPath({ screen: 'sessions' })).toBe('/sessions');
  });

  it('follows only near the bottom', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 560, clientHeight: 400 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 400 })).toBe(false);
  });
});

describe('message box', () => {
  const base = {
    status: 'idle' as const,
    phase: 'live' as const,
    asked: false,
    connected: true,
    sending: false,
  };

  it('opens only for an idle or done session on a live socket with no question waiting', () => {
    expect(composerGate(base)).toEqual({ enabled: true, reason: null });
    expect(composerGate({ ...base, status: 'done' })).toEqual({ enabled: true, reason: null });
    expect(composerGate({ ...base, status: 'working' }).enabled).toBe(false);
    expect(composerGate({ ...base, status: 'blocked' }).reason).toMatch(/terminal/);
    expect(composerGate({ ...base, status: 'unknown' }).enabled).toBe(false);
    expect(composerGate({ ...base, status: null }).enabled).toBe(false);
  });

  it('says the most important reason first: ended, then no socket, then a question, then sending', () => {
    expect(composerGate({ ...base, phase: 'ended', connected: false }).reason).toMatch(/ended/);
    expect(composerGate({ ...base, connected: false, asked: true }).reason).toMatch(/connection/);
    expect(composerGate({ ...base, asked: true, sending: true }).reason).toMatch(/question card/);
    expect(composerGate({ ...base, sending: true })).toEqual({
      enabled: false,
      reason: 'Sending…',
    });
    // No transcript yet is not a reason to refuse: the session may still be idle.
    expect(composerGate({ ...base, phase: 'unavailable' }).enabled).toBe(true);
  });

  it('Enter sends; Shift/Ctrl/Alt/Meta+Enter, a composing Enter and other keys do not', () => {
    const enter = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      isComposing: false,
    };
    expect(isSendKey(enter)).toBe(true);
    expect(isSendKey({ ...enter, shiftKey: true })).toBe(false);
    expect(isSendKey({ ...enter, ctrlKey: true })).toBe(false);
    expect(isSendKey({ ...enter, altKey: true })).toBe(false);
    expect(isSendKey({ ...enter, metaKey: true })).toBe(false);
    expect(isSendKey({ ...enter, isComposing: true })).toBe(false);
    expect(isSendKey({ ...enter, key: 'a' })).toBe(false);
  });

  it('a pending bubble shows at once and is replaced by the transcript copy of the same words', () => {
    const at: Date = new Date('2026-11-02T10:00:00.000Z');
    const mine: ChatItem = pendingItem('p1', 'Строка один\r\nLine two  ', at);
    expect(isPending(mine)).toBe(true);
    expect(mine).toMatchObject({ kind: 'user', text: 'Строка один\r\nLine two  ' });
    const live: ChatState = reduceChat(
      reduceChat(initialChatState, {
        kind: 'backlog',
        items: [item('a', 'assistant')],
        dropped: 0,
      }),
      { kind: 'pending', item: mine },
    );
    expect(live.items.map((i: ChatItem): string => i.id)).toEqual(['a', 'pending:p1']);
    // Claude Code writes the message down: same words, its own id and newline style.
    const echoed: ChatState = reduceChat(live, {
      kind: 'items',
      items: [item('u1', 'user', { text: 'Строка один\nLine two' })],
    });
    expect(echoed.items.map((i: ChatItem): string => i.id)).toEqual(['a', 'u1']);
  });

  it('other words keep the bubble, after the live rows; a refusal removes it', () => {
    const mine: ChatItem = pendingItem('p2', 'one', new Date());
    const held: ChatState = reduceChat(initialChatState, { kind: 'pending', item: mine });
    const later: ChatState = reduceChat(held, {
      kind: 'items',
      items: [item('u2', 'user', { text: 'something else' }), item('b', 'assistant')],
    });
    expect(later.items.map((i: ChatItem): string => i.id)).toEqual(['u2', 'b', 'pending:p2']);
    expect(reduceChat(later, { kind: 'unsent', id: 'pending:p2' }).items.map((i) => i.id)).toEqual([
      'u2',
      'b',
    ]);
  });

  it('a reconnect backlog keeps an unechoed bubble and settles an echoed one', () => {
    const held: ChatState = reduceChat(initialChatState, {
      kind: 'pending',
      item: pendingItem('p3', 'go on', new Date()),
    });
    const kept: ChatState = reduceChat(held, {
      kind: 'backlog',
      items: [item('a', 'assistant')],
      dropped: 0,
    });
    expect(kept.items.map((i: ChatItem): string => i.id)).toEqual(['a', 'pending:p3']);
    const settled: ChatState = reduceChat(held, {
      kind: 'backlog',
      items: [item('u3', 'user', { text: 'go on\n' })],
      dropped: 0,
    });
    expect(settled.items.map((i: ChatItem): string => i.id)).toEqual(['u3']);
  });
});
