import {
  createContext,
  useContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { DocScope } from './docs.types';

/**
 * Opens a document: a knowledge file of the factory (`knowledge`), or an input/output path of
 * a pipeline definition (`artifact`, which the editor answers with a notice).
 */
export type OpenDoc = (scope: DocScope, path: string) => void;

export const DocOpenContext = createContext<OpenDoc>(() => {});

export const useOpenDoc = (): OpenDoc => useContext(DocOpenContext);

interface Props {
  scope: DocScope;
  path: string;
  className?: string;
  children: ReactNode;
}

/**
 * A doc path as a button that opens the document modal. It lives inside React Flow
 * cards, so it carries `nodrag`/`nopan` and keeps its click and Enter/Space from reaching
 * the node (which would select the step instead of opening the file).
 */
export default function DocLink({ scope, path, className, children }: Props) {
  const open: OpenDoc = useContext(DocOpenContext);
  const onClick = (e: MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    open(scope, path);
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
