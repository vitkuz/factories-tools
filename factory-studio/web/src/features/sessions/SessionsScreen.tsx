import { useEffect, useState, type ReactNode } from 'react';
import { describeApiError, isApiError } from '../../adapters/http/api-error.utils';
import { listPipelines } from '../../adapters/http/studio-api.adapter';
import { useNow } from '../../shared/lib/polling';
import { formatRelative } from '../runs/lib/format';
import type { ListState, PipelineList, PipelineListEntry } from '../editor/editor.types';
import { useSessions, type Sessions } from './hooks/use-sessions';
import { StartForm } from './components/StartForm';
import { SessionList } from './components/SessionList';
import { SessionNotice } from './components/SessionNotice';

const APP_NAME = 'Factory Studio';

/** The Sessions screen: a prompt and a factory in, a tmux session out; the running ones listed and stoppable. */
export const SessionsScreen = (): ReactNode => {
  const sessions: Sessions = useSessions();
  const [entries, setEntries] = useState<PipelineListEntry[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [starting, setStarting] = useState<boolean>(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const now: number = useNow(1000);

  useEffect((): void => {
    document.title = `Sessions — ${APP_NAME}`;
  }, []);

  // The factory picker needs only the ids; one fetch of the list on mount.
  useEffect((): (() => void) => {
    const controller: AbortController = new AbortController();
    listPipelines(controller.signal)
      .then((list: PipelineList): void => {
        if (controller.signal.aborted) return;
        setEntries(list.pipelines);
        setListState('ready');
      })
      .catch((error: unknown): void => {
        if (controller.signal.aborted) return;
        console.error('[sessions] pipelines', isApiError(error) ? describeApiError(error) : error);
        setListState('failed');
      });
    return (): void => controller.abort();
  }, []);

  const onStart = (id: string, prompt: string): void => {
    setStarting(true);
    void sessions.start(id, prompt).finally((): void => setStarting(false));
  };

  const onStop = (session: string): void => {
    setStopping(session);
    void sessions.stop(session).finally((): void => setStopping(null));
  };

  return (
    <div className="screen screen-sessions">
      <div className="subbar">
        <h2 className="subbar-title">Sessions</h2>
        <span className="muted subbar-note">
          {sessions.state.error
            ? `Can't reach the API (${sessions.state.error})`
            : `Updated ${formatRelative(sessions.state.updatedAt, now)}`}
        </span>
        <button
          type="button"
          className="feed-refresh"
          onClick={sessions.refresh}
          disabled={sessions.state.refreshing}
        >
          {sessions.state.refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div className="sessions">
        <section className="sessions-pane" aria-label="Start a session">
          <h3 className="panel-title">Start</h3>
          <StartForm entries={entries} listState={listState} busy={starting} onStart={onStart} />
        </section>
        <section className="sessions-pane sessions-running" aria-label="Running sessions">
          <h3 className="panel-title">
            Running
            {sessions.state.sessions.length > 0 ? ` · ${sessions.state.sessions.length}` : ''}
          </h3>
          <SessionNotice notice={sessions.state.notice} onDismiss={sessions.dismiss} />
          <SessionList sessions={sessions.state.sessions} stopping={stopping} onStop={onStop} />
        </section>
      </div>
    </div>
  );
};
