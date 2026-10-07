import type { AnyEventObject, InspectionEvent } from 'xstate';

/** The id an actor was created with, when it has one; its session id otherwise. */
export const actorNameOf = (ref: { id?: string; sessionId: string }): string =>
  ref.id ?? ref.sessionId;

/** The state value of a machine snapshot as a short path (`running`, `step.running`). */
export const stateValueOf = (snapshot: unknown): string => {
  const value: unknown = (snapshot as { value?: unknown } | undefined)?.value;
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return '';
};

/** One short line per inspection event, for a terminal. */
export const describeInspection = (event: InspectionEvent): string | undefined => {
  if (event.type === '@xstate.event') {
    const sent: AnyEventObject = event.event;
    if (sent.type.startsWith('xstate.init')) return undefined;
    return `event  ${actorNameOf(event.actorRef).padEnd(28)} ${sent.type}${stepOf(sent)}`;
  }
  if (event.type === '@xstate.snapshot') {
    const value: string = stateValueOf(event.snapshot);
    return value === '' ? undefined : `state  ${actorNameOf(event.actorRef).padEnd(28)} ${value}`;
  }
  return undefined;
};

const stepOf = (event: AnyEventObject): string => {
  const step: unknown = (event as Record<string, unknown>)['step'];
  const name: unknown = (event as Record<string, unknown>)['event'];
  return typeof step === 'string' ? ` ${step}${typeof name === 'string' ? ` → ${name}` : ''}` : '';
};

/** What events.jsonl keeps of an inspection event: the plain data, never an actor reference. */
export const inspectionLineOf = (event: InspectionEvent): Record<string, unknown> => ({
  type: event.type,
  actor: actorNameOf(event.actorRef),
  ...(event.type === '@xstate.event' ? { event: event.event } : {}),
  ...(event.type === '@xstate.snapshot' ? { state: stateValueOf(event.snapshot) } : {}),
});
