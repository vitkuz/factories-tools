import { memo, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatItem, ChatRow } from '../chat.types';
import { clockTime, countSteps, formatMs, sameRow } from '../chat.utils';

/** What every row needs besides its data: the means to fetch a cut item whole. */
export interface RowActions {
  onExpand: (item: ChatItem) => Promise<void>;
}

/** Links in Claude's words open beside the studio, never in place of it. */
const MARKDOWN: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

/** "Show all" on a cut item; it says "Loading…" while the whole of it is fetched. */
const ShowMore = ({ item, onExpand }: { item: ChatItem } & RowActions): ReactNode => {
  const [busy, setBusy] = useState<boolean>(false);
  if (!item.ref) return null;
  return (
    <button
      type="button"
      className="chat-more"
      disabled={busy}
      onClick={(): void => {
        setBusy(true);
        void onExpand(item).finally((): void => setBusy(false));
      }}
    >
      {busy ? 'Loading…' : 'Show all'}
    </button>
  );
};

const Time = ({ ts }: { ts: string }): ReactNode => {
  const label: string = clockTime(ts);
  return label === '' ? null : (
    <time className="chat-time" dateTime={ts} title={ts}>
      {label}
    </time>
  );
};

const MessageRow = ({ item, onExpand }: { item: ChatItem } & RowActions): ReactNode => {
  switch (item.kind) {
    case 'user':
      return (
        <div className="chat-row is-user">
          <div className="chat-bubble is-user">
            <p className="chat-plain">{item.text}</p>
            <ShowMore item={item} onExpand={onExpand} />
          </div>
          <Time ts={item.ts} />
        </div>
      );
    case 'assistant':
      return (
        <div className="chat-row is-assistant">
          <div className="chat-bubble is-assistant doc-prose">
            <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>
              {item.text}
            </Markdown>
            <ShowMore item={item} onExpand={onExpand} />
          </div>
          <Time ts={item.ts} />
        </div>
      );
    case 'thinking': {
      const took: string = item.durationMs !== undefined ? ` · ${formatMs(item.durationMs)}` : '';
      // Claude Code often keeps only the signature of a thought: then there is nothing to open.
      return item.text.trim() === '' ? (
        <div className="chat-row is-note">
          <span className="chat-thinking-empty">Thinking{took}</span>
        </div>
      ) : (
        <details className="chat-thinking">
          <summary>Thinking{took}</summary>
          <p className="chat-plain">{item.text}</p>
          <ShowMore item={item} onExpand={onExpand} />
        </details>
      );
    }
    default:
      return (
        <div className="chat-row is-note">
          <span className="chat-system">{item.text}</span>
          {item.output ? (
            <details className="chat-system-more">
              <summary>details</summary>
              <pre className="chat-pre">{item.output}</pre>
            </details>
          ) : null}
          <ShowMore item={item} onExpand={onExpand} />
        </div>
      );
  }
};

/** Where the call is: no result yet, failed, or done. */
const callState = (row: Extract<ChatRow, { kind: 'tool' }>): 'running' | 'error' | 'done' =>
  row.result === null ? 'running' : row.result.isError ? 'error' : 'done';

const STATE_LABEL: Record<'running' | 'error' | 'done', string> = {
  running: 'running',
  error: 'error',
  done: 'done',
};

const ToolRow = ({
  row,
  onExpand,
}: { row: Extract<ChatRow, { kind: 'tool' }> } & RowActions): ReactNode => {
  const head: ChatItem | null = row.call ?? row.result;
  const tool: string = head?.tool ?? 'tool';
  const state: 'running' | 'error' | 'done' = callState(row);
  const steps: number = countSteps(row.children);
  return (
    <details className={`chat-tool is-${state}${row.subagent ? ' is-agent' : ''}`}>
      <summary>
        <span className={`chat-tool-dot is-${state}`} aria-label={STATE_LABEL[state]} />
        <span className="mono chat-tool-name">{tool}</span>
        <span className="chat-tool-summary">{row.call?.text || (row.call ? '' : 'result')}</span>
        {row.subagent ? (
          <span className="chat-tool-agent">
            {row.subagent.tool ?? 'subagent'} · {steps} {steps === 1 ? 'step' : 'steps'}
          </span>
        ) : null}
        {head ? <Time ts={head.ts} /> : null}
      </summary>
      <div className="chat-tool-body">
        {row.call?.input ? (
          <section>
            <h4 className="chat-tool-label">Input</h4>
            <pre className="chat-pre">{row.call.input}</pre>
            <ShowMore item={row.call} onExpand={onExpand} />
          </section>
        ) : null}
        {row.children.length > 0 ? (
          <section className="chat-agent-rows" aria-label="What the subagent did">
            <h4 className="chat-tool-label">
              Subagent{row.subagent?.text ? `: ${row.subagent.text}` : ''}
            </h4>
            <Rows rows={row.children} onExpand={onExpand} />
          </section>
        ) : null}
        {row.result ? (
          <section>
            <h4 className="chat-tool-label">{row.result.isError ? 'Error' : 'Output'}</h4>
            <pre className="chat-pre">{row.result.output || '(empty)'}</pre>
            <ShowMore item={row.result} onExpand={onExpand} />
          </section>
        ) : (
          <p className="chat-tool-wait">Waiting for the result…</p>
        )}
      </div>
    </details>
  );
};

const AgentRow = ({
  row,
  onExpand,
}: { row: Extract<ChatRow, { kind: 'agent' }> } & RowActions): ReactNode => (
  <details className="chat-tool is-agent is-done">
    <summary>
      <span className="chat-tool-dot is-done" aria-hidden="true" />
      <span className="mono chat-tool-name">{row.subagent?.tool ?? 'subagent'}</span>
      <span className="chat-tool-summary">{row.subagent?.text ?? ''}</span>
      <span className="chat-tool-agent">{countSteps(row.children)} steps</span>
    </summary>
    <div className="chat-tool-body chat-agent-rows">
      <Rows rows={row.children} onExpand={onExpand} />
    </div>
  </details>
);

/** One drawn row. Memoised on what it shows: a new item re-renders the row it lands in, not the chat. */
export const ChatRowView = memo(
  function ChatRowView({ row, onExpand }: { row: ChatRow } & RowActions): ReactNode {
    switch (row.kind) {
      case 'message':
        return <MessageRow item={row.item} onExpand={onExpand} />;
      case 'tool':
        return <ToolRow row={row} onExpand={onExpand} />;
      case 'agent':
        return <AgentRow row={row} onExpand={onExpand} />;
    }
  },
  (a: { row: ChatRow } & RowActions, b: { row: ChatRow } & RowActions): boolean =>
    a.onExpand === b.onExpand && sameRow(a.row, b.row),
);

export const Rows = ({ rows, onExpand }: { rows: readonly ChatRow[] } & RowActions): ReactNode =>
  rows.map((row: ChatRow) => <ChatRowView key={row.key} row={row} onExpand={onExpand} />);
