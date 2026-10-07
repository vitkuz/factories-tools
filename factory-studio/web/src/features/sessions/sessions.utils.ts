import { formatIssues, type ApiError } from '../../adapters/http/api-error.utils';
import type { FactorySession, SessionNotice, StartedSession } from './sessions.types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** `details.sessions[].session` of a 409, or `details.running[].session` of a 404. */
const sessionNames = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((v: unknown): string[] =>
        isRecord(v) && typeof v.session === 'string' ? [v.session] : [],
      )
    : [];

/** An API refusal on the Sessions screen, as a readable notice — never only in the console. */
export const describeRefusal = (error: ApiError): SessionNotice => {
  if (error.kind === 'network')
    return { tone: 'refusal', title: 'The API is not answering', lines: [error.message] };
  if (error.kind === 'invalid')
    return { tone: 'refusal', title: error.message, lines: error.issues };
  const details: Record<string, unknown> = isRecord(error.details) ? error.details : {};
  switch (error.status) {
    case 400:
      return {
        tone: 'refusal',
        title: `Refused: ${error.message}`,
        lines: formatIssues(error.details),
      };
    case 404: {
      const available: string[] = stringList(details.available);
      const running: string[] = sessionNames(details.running);
      return {
        tone: 'refusal',
        title: `Refused: ${error.message}`,
        lines: [
          ...(available.length > 0 ? [`Available: ${available.join(', ')}`] : []),
          ...(running.length > 0 ? [`Running: ${running.join(', ')}`] : []),
        ],
      };
    }
    case 409:
      return {
        tone: 'refusal',
        title: `Refused: ${error.message}`,
        lines: sessionNames(details.sessions).map((s: string): string => `Session: ${s}`),
      };
    case 502:
      return {
        tone: 'refusal',
        title: error.message,
        lines: [
          typeof details.session === 'string' ? `Session: ${details.session}` : '',
          typeof details.harness === 'string' ? `Harness: ${details.harness}` : '',
          'Start the API from a shell whose PATH holds the harness binary.',
        ].filter(Boolean),
      };
    default:
      return { tone: 'refusal', title: `HTTP ${error.status}: ${error.message}`, lines: [] };
  }
};

export const describeStarted = (started: StartedSession): SessionNotice => ({
  tone: 'ok',
  title: `Started ${started.session}`,
  lines: [
    `Factory: ${started.factoryId} · harness: ${started.harness}`,
    `Prompt file: ${started.promptFile}`,
    `Attach with: tmux attach -t ${started.session}`,
  ],
});

/** The API sorts oldest first; kept here so the list never depends on it. */
export const sortOldestFirst = (sessions: FactorySession[]): FactorySession[] =>
  [...sessions].sort((a: FactorySession, b: FactorySession): number => b.ageSeconds - a.ageSeconds);

/** What the list shows for a session just started from this screen, until the next refresh replaces it. */
export const provisionalSession = (started: StartedSession, now: number): FactorySession => ({
  session: started.session,
  factoryId: started.factoryId,
  harness: started.harness,
  startedAt: new Date(now).toISOString(),
  ageSeconds: 0,
  age: '0s',
});
