import type { WsClient } from '../../../shared/ws/ws.types.js';
import type { LiveServerMessage, LiveTopic, SubscriptionRegistry } from '../live.types.js';

interface Entry {
  client: WsClient;
  topics: ReadonlySet<LiveTopic>;
}

/**
 * Who hears what: a map of client id to its socket handle and topics, replaced on every change.
 * `publish` reaches only the subscribers of one topic, so a client on the Sessions screen is not
 * sent every run's state.
 */
export const createSubscriptionRegistry = (): SubscriptionRegistry => {
  let entries: ReadonlyMap<string, Entry> = new Map();

  const put = (clientId: string, entry: Entry | null): void => {
    const next: Map<string, Entry> = new Map(entries);
    if (entry === null) next.delete(clientId);
    else next.set(clientId, entry);
    entries = next;
  };

  return {
    subscribe: (client: WsClient, topics: readonly LiveTopic[]): void => {
      const current: Entry | undefined = entries.get(client.id);
      put(client.id, { client, topics: new Set([...(current?.topics ?? []), ...topics]) });
    },
    unsubscribe: (clientId: string, topics: readonly LiveTopic[]): void => {
      const current: Entry | undefined = entries.get(clientId);
      if (current === undefined) return;
      const left: Set<LiveTopic> = new Set(
        [...current.topics].filter((t: LiveTopic): boolean => !topics.includes(t)),
      );
      put(clientId, left.size === 0 ? null : { client: current.client, topics: left });
    },
    drop: (clientId: string): void => put(clientId, null),
    publish: (topic: LiveTopic, message: LiveServerMessage): void => {
      for (const entry of entries.values()) {
        if (entry.topics.has(topic)) entry.client.send(message);
      }
    },
    count: (topic: LiveTopic): number =>
      [...entries.values()].filter((entry: Entry): boolean => entry.topics.has(topic)).length,
  };
};
