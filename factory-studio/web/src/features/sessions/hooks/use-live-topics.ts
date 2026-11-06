import { useCallback, useEffect } from 'react';
import type { LiveTopic } from '../sessions.types';
import { useQuestions } from './use-questions';
import type { SessionQuestions } from './use-session-questions';

/**
 * Subscribes the app's socket to `topics` while the caller is mounted: sent on every open (so a
 * reconnect resubscribes and the server answers with fresh snapshots), unsubscribed on unmount.
 * Returns `resync`, which asks for the snapshots again without reopening anything.
 */
export const useLiveTopics = (topics: readonly LiveTopic[]): (() => void) => {
  const { channel, connection }: SessionQuestions = useQuestions();
  // Topics are a short constant list; the joined key keeps the effect off a new array identity.
  const key: string = topics.join(',');

  useEffect((): (() => void) | void => {
    if (connection !== 'open') return;
    const list: LiveTopic[] = key.split(',') as LiveTopic[];
    channel.send({ type: 'live.subscribe', topics: list });
    return (): void => {
      channel.send({ type: 'live.unsubscribe', topics: list });
    };
  }, [channel, connection, key]);

  return useCallback((): void => {
    channel.send({ type: 'live.subscribe', topics: key.split(',') as LiveTopic[] });
  }, [channel, key]);
};
