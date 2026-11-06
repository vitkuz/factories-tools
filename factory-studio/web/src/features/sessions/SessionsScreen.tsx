import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { navigate } from '../../shared/lib/route';
import { ChatDrawer } from '../chat';
import { describeApiError, isApiError } from '../../adapters/http/api-error.utils';
import { listPipelines } from '../../adapters/http/studio-api.adapter';
import { useNow } from '../../shared/lib/polling';
import { FeedBar } from '../../shared/components/FeedBar';
import { TopbarContent } from '../../shared/components/TopbarContent';
import { WorkspacePicker } from '../workspaces';
import { useWorkspacesContext } from '../workspaces/hooks/use-workspaces';
import { inWorkspace } from '../workspaces/workspaces.utils';
import type { Workspace } from '../workspaces/workspaces.types';
import type { DashboardData } from '../runs/runs.types';
import type {
  FactorySession,
  ListState,
  PipelineList,
  PipelineListEntry,
  StartRequest,
} from './sessions.types';
import { useSessions, type Sessions } from './hooks/use-sessions';
import type { SessionQuestions } from './hooks/use-session-questions';
import { useQuestions } from './hooks/use-questions';
import { useChime } from '../../shared/lib/use-chime';
import questionChime from '../../assets/question-chime.wav';
import { sessionsLine, sessionsNeedingReply, titleWithCount, withLiveAge } from './sessions.utils';
import { StartForm } from './components/StartForm';
import { SessionBoard } from './components/SessionBoard';
import { SessionNotice } from './components/SessionNotice';

const APP_NAME = 'Factory Studio';

interface SessionsScreenProps {
  /** The session whose live chat is open over the board (`/sessions/<session>`), or `null`. */
  chat: string | null;
  /** The run list's data: the workspace dialog in the factory bar offers every factory in it. */
  data: DashboardData;
}

/**
 * The Sessions screen, laid out like the Runs home: the factory bar (workspace and Manage, the
 * session counts), the start form as a panel, then every herdr session on a board by what it
 * needs, and a session's live chat over it when the route names one.
 */
export const SessionsScreen = ({ chat, data }: SessionsScreenProps): ReactNode => {
  const questions: SessionQuestions = useQuestions();
  // The socket carries the list and every change to it; nothing on this screen polls.
  const sessions: Sessions = useSessions();
  const terminalWaits: number = sessionsNeedingReply(
    sessions.state.sessions,
    questions.state,
  ).length;
  const waiting: number = questions.state.pending.length + terminalWaits;
  const live: boolean = questions.connection === 'open' && questions.state.sessionsSettled;
  const [entries, setEntries] = useState<PipelineListEntry[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [starting, setStarting] = useState<boolean>(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const now: number = useNow(1000);
  // The list is pushed only when it changes: the ages are counted here, from `startedAt`.
  const shown: FactorySession[] = useMemo(
    (): FactorySession[] => sessions.state.sessions.map(withLiveAge(now)),
    [sessions.state.sessions, now],
  );
  // The start form offers the chosen workspace's factories only.
  const workspace: Workspace | null = useWorkspacesContext().selected;
  const offered: PipelineListEntry[] = useMemo(
    (): PipelineListEntry[] =>
      entries.filter((entry: PipelineListEntry): boolean => inWorkspace(workspace)(entry.id)),
    [entries, workspace],
  );

  useEffect((): void => {
    document.title = titleWithCount(`Sessions — ${APP_NAME}`, waiting);
  }, [waiting]);
  // The app chimes for Claude's questions (QuestionsProvider); this screen adds the sessions
  // whose dialog is open in the terminal, which only its session list knows about.
  useChime(questionChime, terminalWaits);

  // The factory picker and its param fields; one fetch of the list on mount.
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

  const onStart = (request: StartRequest): void => {
    setStarting(true);
    void sessions.start(request).finally((): void => setStarting(false));
  };

  const openChat = useCallback(
    (session: string): void => navigate({ screen: 'sessions', chat: session }),
    [],
  );
  const closeChat = useCallback((): void => navigate({ screen: 'sessions', chat: null }), []);

  const onStop = (session: string): void => {
    setStopping(session);
    void sessions.stop(session).finally((): void => setStopping(null));
  };

  return (
    <div className="screen screen-sessions">
      <TopbarContent>
        <div className="subbar">
          {waiting > 0 ? (
            <span className="count-badge" role="status">
              {waiting} waiting for you
            </span>
          ) : null}
          <FeedBar
            word={live ? 'Live' : questions.connection === 'closed' ? 'Offline' : 'Connecting'}
            tone={live ? 'live' : 'unreachable'}
            title={
              questions.connection === 'closed'
                ? 'Disconnected, reconnecting…'
                : live
                  ? 'The session list arrives over the socket as it changes.'
                  : 'Waiting for the session list…'
            }
          />
        </div>
      </TopbarContent>
      <div className="page sessions">
        <section className="bar factory-bar" aria-label="Factory">
          <WorkspacePicker data={data} label="Factory" className="workspace-picker--bar" />
          <span className="bar-fill" />
          {shown.length > 0 ? (
            <span className="bar-note">{sessionsLine(shown.length, waiting)}</span>
          ) : null}
        </section>
        <StartForm
          entries={offered}
          outsideWorkspace={offered.length === 0 && entries.length > 0}
          listState={listState}
          busy={starting}
          onStart={onStart}
        />
        <SessionNotice notice={sessions.state.notice} onDismiss={sessions.dismiss} />
        <SessionBoard
          sessions={shown}
          state={questions.state}
          connection={questions.connection}
          stopping={stopping}
          now={now}
          onAnswer={questions.answer}
          onClearError={questions.clearError}
          onStop={onStop}
          onOpenChat={openChat}
        />
      </div>
      {chat !== null ? (
        <ChatDrawer
          sessionId={chat}
          session={shown.find((s: FactorySession): boolean => s.session === chat) ?? null}
          onClose={closeChat}
        />
      ) : null}
    </div>
  );
};
