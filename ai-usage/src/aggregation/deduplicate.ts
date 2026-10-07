import type { UsageEvent } from "../contract/usage-event.types.js";

/** Keeps the last occurrence of each eventKey (later records carry the final usage). Order preserved by first appearance. */
export const deduplicateUsageEvents = (events: UsageEvent[]): UsageEvent[] => {
  const byKey: Map<string, UsageEvent> = new Map<string, UsageEvent>();
  events.forEach((event: UsageEvent): void => {
    byKey.set(event.eventKey, event);
  });
  return Array.from(byKey.values());
};
