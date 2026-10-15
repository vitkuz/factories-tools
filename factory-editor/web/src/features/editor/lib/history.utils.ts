import type { History } from './pipeline.types';

/** How many edits can be undone. Each entry is a whole pipeline, and they are small. */
const LIMIT = 200;

export const historyOf = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** Record a new state. Anything that was redoable is gone. */
export const push = <T>(history: History<T>, next: T): History<T> => ({
  past: [...history.past, history.present].slice(-LIMIT),
  present: next,
  future: [],
});

/** Replace the present without recording it — for a load or a reset. */
export const reset = <T>(next: T): History<T> => historyOf(next);

export const undo = <T>(history: History<T>): History<T> => {
  if (history.past.length === 0) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
  };
};

export const redo = <T>(history: History<T>): History<T> => {
  if (history.future.length === 0) return history;
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
  };
};
