import { createContext, useContext } from 'react';

/** What a node can ask the editor to do to its step. Provided by App. */
export interface EditorActions {
  editing: boolean;
  duplicate: (name: string) => void;
  remove: (name: string) => void;
  rename: (from: string, to: string) => void;
  addEdge: (name: string) => void;
}

const noop = (): void => undefined;

export const EditorContext = createContext<EditorActions>({
  editing: false,
  duplicate: noop,
  remove: noop,
  rename: noop,
  addEdge: noop,
});

export const useEditor = (): EditorActions => useContext(EditorContext);
