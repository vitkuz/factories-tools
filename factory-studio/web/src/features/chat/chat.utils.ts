import type { SessionRunLink } from '../sessions/sessions.types';
import type { ChatAction, ChatItem, ChatRow, ChatState } from './chat.types';

/** Items the app keeps per chat; a factory run writes thousands. */
export const MAX_ITEMS = 3000;
/** Rows drawn at first; "Show earlier" draws this many more. */
export const PAGE_ROWS = 150;

export const initialChatState: ChatState = {
  items: [],
  dropped: 0,
  phase: 'connecting',
  reason: null,
};

/** The newest `cap` items, and how many fell off the front. Pure. */
const capped = (
  items: readonly ChatItem[],
  cap: number,
): { items: ChatItem[]; dropped: number } => {
  const over: number = Math.max(0, items.length - cap);
  return { items: items.slice(over), dropped: over };
};

/** Live items after the held ones; an id already held (a re-sent frame) is not added twice. Pure. */
const appendItems = (held: readonly ChatItem[], fresh: readonly ChatItem[]): ChatItem[] => {
  const ids: Set<string> = new Set(held.map((item: ChatItem): string => item.id));
  return [...held, ...fresh.filter((item: ChatItem): boolean => !ids.has(item.id))];
};

/** Pure reducer of what the socket says about one session's chat. */
export const reduceChat = (state: ChatState, action: ChatAction): ChatState => {
  switch (action.kind) {
    case 'backlog': {
      const kept = capped(action.items, MAX_ITEMS);
      return {
        items: kept.items,
        dropped: action.dropped + kept.dropped,
        phase: 'live',
        reason: null,
      };
    }
    case 'items': {
      const kept = capped(appendItems(state.items, action.items), MAX_ITEMS);
      return { ...state, items: kept.items, dropped: state.dropped + kept.dropped };
    }
    case 'unavailable':
      // Rows already on screen stay; only an empty chat says why it is empty.
      return {
        ...state,
        phase: state.items.length > 0 ? state.phase : 'unavailable',
        reason: action.reason,
      };
    case 'ended':
      return { ...state, phase: 'ended' };
    case 'reconnecting':
      return state.phase === 'ended' ? state : { ...state, phase: 'connecting' };
    case 'expanded':
      return {
        ...state,
        items: state.items.map((item: ChatItem): ChatItem =>
          item.id === action.item.id ? { ...action.item, ref: undefined } : item,
        ),
      };
  }
};

const byParent = (items: readonly ChatItem[]): ReadonlyMap<string, ChatItem[]> =>
  items.reduce((acc: Map<string, ChatItem[]>, item: ChatItem): Map<string, ChatItem[]> => {
    if (item.parentToolUseId === undefined) return acc;
    acc.set(item.parentToolUseId, [...(acc.get(item.parentToolUseId) ?? []), item]);
    return acc;
  }, new Map());

/**
 * The flat items to the rows the chat draws: a tool call takes its result and, when it started
 * a subagent, that subagent's rows nested under it (and theirs under their calls). A result
 * whose call is not held stands alone. Items of a subagent whose call is not known form an
 * `agent` group of their own. Pure; linear in the number of items.
 */
export const buildRows = (items: readonly ChatItem[]): ChatRow[] => {
  const children: ReadonlyMap<string, ChatItem[]> = byParent(items);
  const calls: Set<string> = new Set(
    items
      .filter((item: ChatItem): boolean => item.kind === 'tool_call' && Boolean(item.toolUseId))
      .map((item: ChatItem): string => item.toolUseId as string),
  );

  const rowsOf = (level: readonly ChatItem[]): ChatRow[] => {
    const results: ReadonlyMap<string, ChatItem> = new Map(
      level
        .filter((item: ChatItem): boolean => item.kind === 'tool_result' && Boolean(item.toolUseId))
        .map((item: ChatItem): [string, ChatItem] => [item.toolUseId as string, item]),
    );
    const levelCalls: Set<string> = new Set(
      level
        .filter((item: ChatItem): boolean => item.kind === 'tool_call')
        .map((item: ChatItem): string => item.toolUseId ?? ''),
    );
    return level.flatMap((item: ChatItem): ChatRow[] => {
      if (item.kind === 'subagent') return [];
      if (item.kind === 'tool_result') {
        return item.toolUseId && levelCalls.has(item.toolUseId)
          ? []
          : [
              {
                kind: 'tool',
                key: item.id,
                call: null,
                result: item,
                subagent: null,
                children: [],
              },
            ];
      }
      if (item.kind === 'tool_call') {
        const nested: ChatItem[] = item.toolUseId ? (children.get(item.toolUseId) ?? []) : [];
        return [
          {
            kind: 'tool',
            key: item.id,
            call: item,
            result: item.toolUseId ? (results.get(item.toolUseId) ?? null) : null,
            subagent: nested.find((child: ChatItem): boolean => child.kind === 'subagent') ?? null,
            children: rowsOf(nested),
          },
        ];
      }
      return [{ kind: 'message', key: item.id, item }];
    });
  };

  // Top level: no parent call, or a parent call that is not held (an orphaned subagent).
  const top: ChatItem[] = items.filter(
    (item: ChatItem): boolean => item.parentToolUseId === undefined && item.agentId === undefined,
  );
  const orphans: Map<string, ChatItem[]> = items
    .filter(
      (item: ChatItem): boolean =>
        item.agentId !== undefined &&
        (item.parentToolUseId === undefined || !calls.has(item.parentToolUseId)),
    )
    .reduce((acc: Map<string, ChatItem[]>, item: ChatItem): Map<string, ChatItem[]> => {
      const agent: string = item.agentId as string;
      acc.set(agent, [...(acc.get(agent) ?? []), item]);
      return acc;
    }, new Map());
  const agentRows: ChatRow[] = [...orphans].map(
    ([agentId, own]: [string, ChatItem[]]): ChatRow => ({
      kind: 'agent',
      key: `agent-${agentId}`,
      subagent: own.find((item: ChatItem): boolean => item.kind === 'subagent') ?? null,
      children: rowsOf(own),
    }),
  );
  return [...rowsOf(top), ...agentRows];
};

/**
 * Do two rows show the same thing? Rows are rebuilt from the items on every update, but the
 * items themselves are kept by identity, so comparing them is enough. Pure.
 */
export const sameRow = (a: ChatRow, b: ChatRow): boolean => {
  if (a.kind !== b.kind || a.key !== b.key) return false;
  if (a.kind === 'message' && b.kind === 'message') return a.item === b.item;
  if (a.kind === 'message' || b.kind === 'message') return false;
  const sameChildren: boolean =
    a.children.length === b.children.length &&
    a.children.every((child: ChatRow, i: number): boolean =>
      sameRow(child, b.children[i] as ChatRow),
    );
  if (a.kind === 'tool' && b.kind === 'tool') {
    return a.call === b.call && a.result === b.result && a.subagent === b.subagent && sameChildren;
  }
  return a.subagent === b.subagent && sameChildren;
};

/** How many rows a group holds, itself included: what "N steps" on a subagent says. Pure. */
export const countSteps = (rows: readonly ChatRow[]): number =>
  rows.filter((row: ChatRow): boolean => row.kind === 'tool').length;

/** `850ms`, `12s`, `1m 5s`. Pure. */
export const formatMs = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds: number = Math.round(ms / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
};

/** `14:05:09` in the viewer's time, or nothing for a missing or bad stamp. Pure. */
export const clockTime = (ts: string): string => {
  const at: Date = new Date(ts);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/** Close enough to the bottom to keep following new rows. Pure. */
export const isNearBottom = (
  box: { scrollHeight: number; scrollTop: number; clientHeight: number },
  slack = 48,
): boolean => box.scrollHeight - box.scrollTop - box.clientHeight <= slack;

/* ---------------------------------------------------------------- run <-> session */

interface RunStateLike {
  sessionId?: unknown;
  history?: readonly { type?: unknown; details?: Record<string, unknown> }[];
}

/**
 * Claude's session id the recorder stamped on a run: the state's own `sessionId`, else the
 * one on its `PIPELINE_INIT` entry; `''` when there is none. The API's `runSessionId`, mirrored. Pure.
 */
export const runClaudeSessionId = (state: RunStateLike | null | undefined): string => {
  if (!state) return '';
  if (typeof state.sessionId === 'string' && state.sessionId !== '') return state.sessionId;
  const init = (state.history ?? []).find((entry): boolean => entry.type === 'PIPELINE_INIT');
  const id: unknown = init?.details?.sessionId;
  return typeof id === 'string' ? id : '';
};

/**
 * The studio session a run is live in: the one whose Claude session id the run carries, else
 * the one whose pending question the API tied to this run. `null` when neither. Pure.
 */
export const findRunSession = <S extends { session: string; claudeSessionId?: string }>(
  sessions: readonly S[],
  claudeSessionId: string,
  pending: readonly { sessionId: string; run?: Pick<SessionRunLink, 'pipelineId' | 'runId'> }[],
  run: Pick<SessionRunLink, 'pipelineId' | 'runId'>,
): S | null => {
  const stamped: S | undefined =
    claudeSessionId === ''
      ? undefined
      : sessions.find((session: S): boolean => session.claudeSessionId === claudeSessionId);
  if (stamped) return stamped;
  const asking = pending.find(
    (question): boolean =>
      question.run?.pipelineId === run.pipelineId && question.run.runId === run.runId,
  );
  return asking
    ? (sessions.find((session: S): boolean => session.session === asking.sessionId) ?? null)
    : null;
};
