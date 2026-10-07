import { NodeToolbar, Position, type NodeProps } from '@xyflow/react';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { StepFlowNode, StepNodeData } from '../lib/pipeline.types';
import { useEditor, type EditorActions } from './EditorContext';
import { DocGroup, StepCard } from '../../../shared/graph';

/**
 * A step on the editor canvas: the card the Runs screen draws (same box, lines and
 * footer), with the editor's tools on top of it — the toolbar of the selected step in
 * Edit mode, a rename field on double-click, and the count of checks that flag the step
 * where the Runs card shows its status dot. The footer reads from the definition:
 * how many documents go in and out, and the retry cap when the step has one.
 */
export const StepNode = ({ data, selected }: NodeProps<StepFlowNode>): ReactNode => {
  const { slug: name, issueCount, inputs, outputs, max, detailed }: StepNodeData = data;
  const editor: EditorActions = useEditor();
  const [renaming, setRenaming] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>(name);
  const input = useRef<HTMLInputElement>(null);

  useEffect((): void => {
    if (renaming) input.current?.select();
  }, [renaming]);

  const commitRename = (): void => {
    setRenaming(false);
    const next: string = draft.trim();
    if (next !== '' && next !== name) editor.rename(name, next);
  };

  const startRename = (): void => {
    setDraft(name);
    setRenaming(true);
  };

  const slug: ReactNode = renaming ? (
    <input
      ref={input}
      className="step-rename nodrag"
      value={draft}
      onChange={(event: ChangeEvent<HTMLInputElement>): void => setDraft(event.target.value)}
      onBlur={commitRename}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>): void => {
        event.stopPropagation();
        if (event.key === 'Enter') commitRename();
        if (event.key === 'Escape') setRenaming(false);
      }}
    />
  ) : (
    <span onDoubleClick={editor.editing ? startRename : undefined}>{name}</span>
  );

  const issues: ReactNode =
    issueCount > 0 ? (
      <span className="step-issues" title={`${issueCount} issue(s)`}>
        {issueCount}
      </span>
    ) : undefined;

  return (
    <>
      <NodeToolbar isVisible={selected && editor.editing && !renaming} position={Position.Top}>
        <div className="node-toolbar">
          <button type="button" onClick={startRename} title="rename this step (F2)">
            Rename
          </button>
          <button
            type="button"
            onClick={(): void => editor.addEdge(name)}
            title="add an outgoing event, aimed at END until you retarget it"
          >
            + Edge
          </button>
          <button
            type="button"
            onClick={(): void => editor.duplicate(name)}
            title="copy this step right after it (Ctrl+D)"
          >
            Duplicate
          </button>
          <button
            type="button"
            className="is-danger"
            onClick={(): void => editor.remove(name)}
            title="delete this step and every edge into it (Delete)"
          >
            Delete
          </button>
        </div>
      </NodeToolbar>

      <StepCard
        slug={slug}
        headEnd={issues}
        agent={data.agent}
        model={data.model}
        human={data.human}
        detailed={detailed}
      >
        {detailed && (
          <div className="step-docs">
            <DocGroup label="input" docs={inputs} expected={false} scope="artifact" />
            <DocGroup label="output" docs={outputs} expected={false} scope="artifact" />
            {data.knowledge.length > 0 && (
              <DocGroup
                label="knowledge"
                docs={data.knowledge}
                expected={false}
                scope="knowledge"
              />
            )}
          </div>
        )}
        <div className="step-foot">
          <span className="step-result step-result--result">
            {`${inputs.length} in · ${outputs.length} out`}
          </span>
          <span className="step-attempts">{max !== undefined ? `max ${max}` : ''}</span>
        </div>
      </StepCard>
    </>
  );
};
