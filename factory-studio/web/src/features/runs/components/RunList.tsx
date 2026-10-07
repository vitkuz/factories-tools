import type { ReactNode } from 'react';
import type { RunGroup, RunRecord } from '../runs.types';
import type { RunRef } from '../../../shared/lib/route';
import { RunMeta } from './RunMeta';

interface RunListProps {
  groups: RunGroup[];
  onOpen: (run: RunRef) => void;
}

/** Every run of every pipeline, grouped, as the run picker lists them — but static and always open. */
export const RunList = ({ groups, onOpen }: RunListProps): ReactNode => (
  <div className="run-list">
    {groups.map((group: RunGroup) => (
      <section key={group.pipelineId} className="run-list-group" aria-label={group.pipelineId}>
        <h3 className="run-list-label mono">{group.pipelineId}</h3>
        <ul className="run-list-rows">
          {group.runs.map((run: RunRecord) => (
            <li key={run.runId}>
              <button
                type="button"
                className="run-list-row"
                onClick={(): void => onOpen({ pipelineId: run.pipelineId, runId: run.runId })}
              >
                <span className="run-list-id mono">{run.runId}</span>
                <RunMeta run={run} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    ))}
  </div>
);
