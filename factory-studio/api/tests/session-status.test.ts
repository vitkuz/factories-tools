import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/features/questions/questions.types.js';
import {
  changedStatuses,
  pollSessionStatusFactory,
} from '../src/features/sessions/services/poll-session-status.service.js';
import type { FactorySession, SessionStatus } from '../src/features/sessions/sessions.types.js';

const session = (name: string, status: SessionStatus): FactorySession => ({
  session: name,
  factoryId: 'a-factory',
  harness: 'claude',
  startedAt: '',
  ageSeconds: 0,
  age: '0s',
  status,
});

describe('session status poller', () => {
  it('lists only the sessions that are new or changed', () => {
    const previous: Map<string, SessionStatus> = new Map([
      ['a', 'idle'],
      ['b', 'working'],
    ]);
    expect(
      changedStatuses(previous, [
        session('a', 'idle'),
        session('b', 'blocked'),
        session('c', 'idle'),
      ]).map((s: FactorySession): string => s.session),
    ).toEqual(['b', 'c']);
  });

  it('broadcasts session.status once per change', async () => {
    let current: FactorySession[] = [session('a', 'working')];
    const sent: ServerMessage[] = [];
    const poller = pollSessionStatusFactory({
      listSessions: async (): Promise<FactorySession[]> => current,
      broadcast: (m: ServerMessage): void => void sent.push(m),
    });
    await poller.tick();
    await poller.tick();
    current = [session('a', 'blocked')];
    await poller.tick();
    expect(sent).toEqual([
      { type: 'session.status', sessionId: 'a', status: 'working' },
      { type: 'session.status', sessionId: 'a', status: 'blocked' },
    ]);
  });
});
