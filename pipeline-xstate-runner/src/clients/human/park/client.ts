import type { HumanClient, HumanReply } from '../human.types.js';

/** Nobody to ask: every question parks the run, and `answer <runDir> <step> <EVENT>` resumes it. */
export const createParkHuman = (): HumanClient => ({
  mode: 'park',
  ask: () => async (): Promise<HumanReply> => ({ kind: 'parked' }),
});
