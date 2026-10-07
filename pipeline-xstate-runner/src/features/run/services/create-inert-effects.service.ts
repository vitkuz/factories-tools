import type { RunEffects } from '../../machines/machines.types.js';

const never = <T>(): Promise<T> => new Promise<T>((): void => undefined);

/**
 * Effects that never settle: what `replay` builds the machine with. Every outcome then comes from
 * events.jsonl, re-fed in order, and nothing touches the disk, a harness, a shell or a person.
 */
export const createInertEffects = (): RunEffects => ({
  validate: never,
  makeRunDir: never,
  runHooks: never,
  collectMaterials: never,
  runStep: never,
  collectOutputs: never,
  ask: never,
  writeDecision: never,
  now: never,
});
