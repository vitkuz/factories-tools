import type { ReactNode } from 'react';
import { DocLink, type DocScope } from '../document-viewer';
import { MONO_COLS } from './layout';
import { displayDocPath, splitPathLines, type PathLine } from './text';

/**
 * A path broken after each `/` (matches `wrapPath`, so the card height is exact); the
 * directory is dimmed and the file name carries the ink. Continuation lines hang 1 ch in.
 * The whole path is one link that opens the document; a knowledge file shows its path
 * without the `{{skillPath}}` template (the link keeps the original for the fetch).
 */
const PathLines = ({
  path,
  scope,
  editable,
}: {
  path: string;
  scope: DocScope;
  editable: boolean;
}): ReactNode => (
  <li className="step-doc-path">
    <DocLink scope={scope} path={path} editable={editable}>
      {splitPathLines(displayDocPath(path), MONO_COLS).map((line: PathLine, i: number) => (
        <span key={i} className="step-doc-line">
          {line.dir && <span className="step-doc-dir">{line.dir}</span>}
          {line.base}
        </span>
      ))}
    </DocLink>
  </li>
);

export interface DocGroupProps {
  label: string;
  docs: string[];
  /** The list comes from the definition, not from what a run wrote: drawn muted. */
  expected: boolean;
  scope: DocScope;
  /** The docs of this group open with the modal's editor (a human step's inputs). */
  editable?: boolean;
}

/** `input` / `output` / `knowledge` on a detailed card — the label, then the paths under it. */
export const DocGroup = ({
  label,
  docs,
  expected,
  scope,
  editable = false,
}: DocGroupProps): ReactNode => (
  <div className="step-doc-group">
    <div className="step-doc-label">{docs.length === 0 ? `no ${label}` : label}</div>
    {docs.length > 0 && (
      <ul className={`step-doc-list${expected ? ' is-expected' : ''}`}>
        {docs.map((d: string) => (
          <PathLines key={d} path={d} scope={scope} editable={editable} />
        ))}
      </ul>
    )}
  </div>
);
