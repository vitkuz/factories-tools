import {
  createContext,
  useContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { runSitePath, runZipPath } from '../../../adapters/http/api-paths';
import type { RunRef } from '../../../shared/lib/route';
import { stepFolderOf } from '../runs.utils';

/** The run on screen, for the step folder links; null outside a run view (the icons then draw nothing). */
export const RunRefContext = createContext<RunRef | null>(null);

export const useRunRef = (): RunRef | null => useContext(RunRefContext);

interface FolderActionsProps {
  /** The step's output paths; the folder is their shared first segment. */
  outputs: readonly string[];
  /** The step has started (or recorded its outputs): the folder is there to open. */
  ready: boolean;
}

/** Box with an arrow leaving its top-right corner. */
const OpenIcon = (): ReactNode => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <path
      d="M5 2.5H2.5v7h7V7M7 2h3v3M10 2 5.5 6.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** An arrow down into a tray. */
const DownloadIcon = (): ReactNode => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <path
      d="M6 1.5v6M3.5 5 6 7.5 8.5 5M2 8.5v2h8v-2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Inside a React Flow card or a clickable Timeline row, the click must not select the step. */
const stopClick = (e: MouseEvent<HTMLElement>): void => e.stopPropagation();

const stopKeys = (e: KeyboardEvent<HTMLElement>): void => {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
};

/**
 * Two icons after a step's `output` label: open the step's folder as a site in a new tab, and
 * download it as a `.zip`. Plain links, no adapter call: a navigation carries no headers, and
 * the API applies to them the same rule it applies to everything else. Muted until the step
 * has started.
 */
export const FolderActions = ({ outputs, ready }: FolderActionsProps): ReactNode => {
  const run: RunRef | null = useRunRef();
  const folder: string | null = run === null ? null : stepFolderOf(run, outputs);
  if (run === null || folder === null) return null;

  if (!ready) {
    return (
      <span className="folder-actions" title="no output folder yet">
        <span className="folder-action is-disabled" aria-disabled="true" aria-label="Open folder">
          <OpenIcon />
        </span>
        <span
          className="folder-action is-disabled"
          aria-disabled="true"
          aria-label="Download folder"
        >
          <DownloadIcon />
        </span>
      </span>
    );
  }

  const openTitle: string = `Open ${folder} as a site`;
  const downloadTitle: string = `Download ${folder} as .zip`;
  return (
    <span className="folder-actions">
      <a
        className="folder-action nodrag nopan"
        href={runSitePath(run.pipelineId, run.runId, folder)}
        target="_blank"
        rel="noopener noreferrer"
        title={openTitle}
        aria-label={openTitle}
        onClick={stopClick}
        onKeyDown={stopKeys}
      >
        <OpenIcon />
      </a>
      <a
        className="folder-action nodrag nopan"
        href={runZipPath(run.pipelineId, run.runId, folder)}
        download
        title={downloadTitle}
        aria-label={downloadTitle}
        onClick={stopClick}
        onKeyDown={stopKeys}
      >
        <DownloadIcon />
      </a>
    </span>
  );
};
