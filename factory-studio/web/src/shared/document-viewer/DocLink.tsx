import {
  createContext,
  useContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { DocScope } from './docs.types';

/** How the document opens: `editable` gives the modal its Edit button (human-step inputs). */
export interface OpenDocOptions {
  editable?: boolean;
}

/**
 * Opens a document: of the run on screen (`run`), of its factory (`knowledge`), or an
 * input/output path of a pipeline definition (`artifact`, which the editor answers with a notice).
 */
export type OpenDoc = (scope: DocScope, path: string, options?: OpenDocOptions) => void;

export const DocOpenContext = createContext<OpenDoc>(() => {});

export const useOpenDoc = (): OpenDoc => useContext(DocOpenContext);

interface Props {
  scope: DocScope;
  path: string;
  /** A person may rewrite this document from the modal (an input doc of a human step). */
  editable?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A doc path as a button that opens the document modal. It lives inside React Flow
 * cards, so it carries `nodrag`/`nopan` and keeps its click and Enter/Space from reaching
 * the node (which would select the step instead of opening the file).
 */
export default function DocLink({ scope, path, editable = false, className, children }: Props) {
  const open: OpenDoc = useContext(DocOpenContext);
  const onClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    open(scope, path, { editable });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
  };
  return (
    <button
      type="button"
      className={`doc-link nodrag nopan${className ? ` ${className}` : ''}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      title={`Open ${path}`}
    >
      {children}
    </button>
  );
}
