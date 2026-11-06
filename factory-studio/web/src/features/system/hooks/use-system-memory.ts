import { useEffect, useState } from 'react';
import { useLiveTopics } from '../../sessions/hooks/use-live-topics';
import { useQuestions } from '../../sessions/hooks/use-questions';
import type { SessionQuestions } from '../../sessions/hooks/use-session-questions';
import type { ServerMessage } from '../../sessions/sessions.types';
import type { SystemMemory } from '../system.types';

/**
 * The memory reading as the server pushes it (`system.memory`, every few seconds while this
 * hook is mounted). `null` until the first frame and whenever the socket is down: the meter
 * then says "—" rather than a stale number.
 */
export const useSystemMemory = (): SystemMemory | null => {
  const { channel, connection }: SessionQuestions = useQuestions();
  const [memory, setMemory] = useState<SystemMemory | null>(null);
  useLiveTopics(['system']);

  useEffect(
    (): (() => void) =>
      channel.listen((message: ServerMessage): void => {
        if (message.type !== 'system.memory') return;
        const { type: _type, ...reading }: Extract<ServerMessage, { type: 'system.memory' }> =
          message;
        setMemory(reading);
      }),
    [channel],
  );

  useEffect((): void => {
    if (connection !== 'open') setMemory(null);
  }, [connection]);

  return memory;
};
