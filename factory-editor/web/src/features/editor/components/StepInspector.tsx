import { useEffect, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Pipeline, PipelineEdge, PipelineStep, Selection } from '../lib/pipeline.types';
import { deleteStep, joinLines, renameStep, splitLines, updateStep } from '../lib/pipeline.utils';
import { ALL_AGENTS, isKnownAgent } from '../lib/agents.utils';
import { Field, StringListEditor, TextArea, TextInput } from './Fields';

interface StepInspectorProps {
  pipeline: Pipeline;
  name: string;
  onChange: (pipeline: Pipeline) => void;
  onSelect: (selection: Selection | null) => void;
  /** What the delete button does; the default removes the step from the pipeline. */
  onDelete?: () => void;
}

export const StepInspector = ({
  pipeline,
  name,
  onChange,
  onSelect,
  onDelete,
}: StepInspectorProps): ReactNode => {
  const step: PipelineStep | undefined = pipeline.steps[name];
  const [draftName, setDraftName] = useState<string>(name);

  useEffect((): void => setDraftName(name), [name]);

  if (!step) return <p className="empty">This step no longer exists.</p>;

  const patch = (values: Partial<PipelineStep>): void =>
    onChange(updateStep(pipeline, name, values));

  const commitName = (): void => {
    const next: string = draftName.trim();
    if (next === '' || next === name) {
      setDraftName(name);
      return;
    }
    if (pipeline.steps[next]) {
      setDraftName(name);
      return;
    }
    onChange(renameStep(pipeline, name, next));
    onSelect({ kind: 'step', name: next });
  };

  const isHuman: boolean = step.agent === 'human';

  return (
    <div className="inspector-body">
      <Field label="Step name" hint="kebab-case; names the output folder">
        <input
          className="input mono"
          value={draftName}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            setDraftName(event.target.value)
          }
          onBlur={commitName}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>): void => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') setDraftName(name);
          }}
        />
      </Field>

      <Field
        label="Agent"
        hint={ALL_AGENTS.find((agent): boolean => agent.name === step.agent)?.description}
      >
        <select
          className="input"
          value={isKnownAgent(step.agent) ? step.agent : '__custom__'}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
            patch({ agent: event.target.value === '__custom__' ? step.agent : event.target.value })
          }
        >
          {ALL_AGENTS.map((agent) => (
            <option key={agent.name} value={agent.name}>
              {agent.name}
            </option>
          ))}
          <option value="__custom__">custom…</option>
        </select>
      </Field>

      {isKnownAgent(step.agent) ? null : (
        <Field label="Custom agent type">
          <TextInput
            value={step.agent}
            onChange={(value: string): void => patch({ agent: value })}
            monospace
          />
        </Field>
      )}

      <Field
        label="system"
        hint={isHuman ? 'ignored on a human step' : 'who the subagent is — a few sentences'}
      >
        <TextArea
          rows={4}
          value={joinLines(step.system)}
          placeholder="You are an investigator who proves a cause before naming it."
          onChange={(value: string): void =>
            patch({ system: value === '' ? undefined : splitLines(value) })
          }
        />
      </Field>

      <Field label="prompt" hint={isHuman ? 'the question — must name every event' : 'the task'}>
        <TextArea
          rows={12}
          value={joinLines(step.prompt)}
          onChange={(value: string): void => patch({ prompt: splitLines(value) })}
        />
      </Field>

      <Field label="knowledge" hint="files under {{factoryPath}}/knowledge/, next to the pipeline">
        <StringListEditor
          values={step.knowledge ?? []}
          placeholder="{{factoryPath}}/knowledge/topic.md"
          addLabel="knowledge file"
          onChange={(values: string[]): void =>
            patch({ knowledge: values.length > 0 ? values : undefined })
          }
        />
      </Field>

      <Field label="workDir" hint="a directory this step may modify">
        <TextInput
          value={step.workDir ?? ''}
          placeholder="{{rootPath}}"
          monospace
          onChange={(value: string): void => patch({ workDir: value === '' ? undefined : value })}
        />
      </Field>

      <Field label="input" hint="must match an earlier step's output">
        <StringListEditor
          values={step.input ?? []}
          placeholder="1-scout/report.md"
          addLabel="input"
          onChange={(values: string[]): void => patch({ input: values })}
        />
      </Field>

      <Field label="output" hint="{n}-{step-name}/file.md">
        <StringListEditor
          values={step.output ?? []}
          placeholder="2-write/draft.md"
          addLabel="output"
          onChange={(values: string[]): void => patch({ output: values })}
        />
      </Field>

      <div className="field">
        <span className="field-label">
          events<em className="field-hint">click one to edit its edge</em>
        </span>
        <div className="event-list">
          {Object.entries(step.transitions).map(([event, edge]: [string, PipelineEdge]) => (
            <button
              type="button"
              className="event-row"
              key={event}
              onClick={(): void => onSelect({ kind: 'edge', source: name, event })}
            >
              <span className="event-name">{event}</span>
              <span className="event-target">→ {edge.target.join(', ')}</span>
              {edge.max !== undefined ? <span className="chip">max {edge.max}</span> : null}
              {edge.condition !== undefined ? <span className="chip">if</span> : null}
            </button>
          ))}
          {Object.keys(step.transitions).length === 0 ? (
            <p className="empty">No events. Drag from this node's bottom handle to add one.</p>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        className="danger-button"
        onClick={(): void => {
          if (onDelete) {
            onDelete();
            return;
          }
          onChange(deleteStep(pipeline, name));
          onSelect(null);
        }}
      >
        Delete step
      </button>
    </div>
  );
};
