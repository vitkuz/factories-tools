import type { InspectionEvent } from 'xstate';

export type InspectMode = 'terminal' | 'jsonl';

/** Where the live stream of machine events goes. The run writes events.jsonl whatever the sink. */
export type InspectSink = (event: InspectionEvent) => void;
