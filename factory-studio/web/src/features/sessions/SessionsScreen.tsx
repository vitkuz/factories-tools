import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { navigate } from '../../shared/lib/route';
import { ChatDrawer } from '../chat';
import { describeApiError, isApiError } from '../../adapters/http/api-error.utils';
import { listPipelines } from '../../adapters/http/studio-api.adapter';
import { useNow } from '../../shared/lib/polling';
import { FeedBar } from '../../shared/components/FeedBar';
import { TopbarContent } from '../../shared/components/TopbarContent';
import { formatRelative } from '../runs/lib/format';
import type {
  FactorySession,
  ListState,
  PipelineList,
  PipelineListEntry,
  StartRequest,
} from './sessions.types';
import { REFRESH_LIVE_MS, REFRESH_MS, useSessions, type Sessions } from './hooks/use-sessions';
import type { SessionQuestions } from './hooks/use-session-questions';
import { useQuestions } from './hooks/use-questions';
import { useChime } from '../../shared/lib/use-chime';
import questionChime from '../../assets/question-chime.wav';
import { sessionsNeedingReply, titleWithCount } from './sessions.utils';
import { StartForm } from './components/StartForm';
import { SessionBoard } from './components/SessionBoard';
import { SessionNotice } from './components/SessionNotice';

const APP_NAME = 'Factory Studio';

interface SessionsScreenProps {
  /** The session whose live chat is open over the board (`/sessions/<session>`), or `null`. */
  chat: string | null;
}

/**
 * The Sessions screen: the start form across the top, then every herdr session on a board by
 * what it needs, and a session's live chat over it when the route names one.
 */
export const SessionsScreen = ({ chat }: SessionsScreenProps): ReactNode => {
  const questions: SessionQuestions = useQuestions();
  // The socket carries the live news; the list is polled fast only while the socket is down.
  const sessions: Sessions = useSessions(
    questions.connection === 'open' ? REFRESH_LIVE_MS : REFRESH_MS,
  );
  const terminalWaits: number = sessionsNeedingReply(
    sessions.state.sessions,
    questions.state,
  ).length;
  const waiting: number = questions.state.pending.length + terminalWaits;
  const live: boolean = questions.connection === 'open' && !sessions.state.error;
  const [entries, setEntries] = useState<PipelineListEntry[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [starting, setStarting] = useState<boolean>(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const now: number = useNow(1000);

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
            detail={
              sessions.state.error
                ? `Can't reach the API (${sessions.state.error})`
                : `Updated ${formatRelative(sessions.state.updatedAt, now)}`
            }
            word={live ? 'Live' : questions.connection === 'connecting' ? 'Connecting' : 'Offline'}
            tone={live ? 'live' : 'unreachable'}
            refreshing={sessions.state.refreshing}
            onRefresh={sessions.refresh}
          />
        </div>
      </TopbarContent>
      <div className="sessions">
        <StartForm entries={entries} listState={listState} busy={starting} onStart={onStart} />
        <SessionNotice notice={sessions.state.notice} onDismiss={sessions.dismiss} />
        <SessionBoard
          sessions={sessions.state.sessions}
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
          session={
            sessions.state.sessions.find((s: FactorySession): boolean => s.session === chat) ?? null
          }
          onClose={closeChat}
        />
      ) : null}
    </div>
  );
};
