import { useEffect, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Pipeline, PipelineEdge, Selection } from '../lib/pipeline.types';
import { END } from '../lib/pipeline.types';
import { deleteEvent, renameEvent, stepNames, updateEdge } from '../lib/pipeline.utils';
import { Field, StringListEditor, TextInput } from './Fields';

interface EdgeInspectorProps {
  pipeline: Pipeline;
  source: string;
  event: string;
  onChange: (pipeline: Pipeline) => void;
  onSelect: (selection: Selection | null) => void;
}

export const EdgeInspector = ({
  pipeline,
  source,
  event,
  onChange,
  onSelect,
}: EdgeInspectorProps): ReactNode => {
  const edge: PipelineEdge | undefined = pipeline.steps[source]?.transitions[event];
  const [draftEvent, setDraftEvent] = useState<string>(event);

  useEffect((): void => setDraftEvent(event), [event]);

  if (!edge) return <p className="empty">This edge no longer exists.</p>;

  const targets: string[] = [...stepNames(pipeline), END];
  const patch = (values: Partial<PipelineEdge>): void =>
    onChange(updateEdge(pipeline, source, event, values));

  const commitEvent = (): void => {
    const next: string = draftEvent.trim();
    if (next === '' || next === event || pipeline.steps[source].transitions[next]) {
      setDraftEvent(event);
      return;
    }
    onChange(renameEvent(pipeline, source, event, next));
    onSelect({ kind: 'edge', source, event: next });
  };

  const toggleTarget = (name: string): void => {
    const next: string[] = edge.target.includes(name)
      ? edge.target.filter((entry: string): boolean => entry !== name)
      : [...edge.target, name];
    if (next.length > 0) patch({ target: next });
  };

  return (
    <div className="inspector-body">
      <p className="inspector-context">
        out of{' '}
        <button
          type="button"
          className="link-button"
          onClick={(): void => onSelect({ kind: 'step', name: source })}
        >
          {source}
        </button>
      </p>

      <Field label="event" hint="UPPER_SNAKE_CASE; name it in the prompt too">
        <input
          className="input mono"
          value={draftEvent}
          onChange={(e: ChangeEvent<HTMLInputElement>): void => setDraftEvent(e.target.value)}
          onBlur={commitEvent}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>): void => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setDraftEvent(event);
          }}
        />
      </Field>

      <div className="field">
        <span className="field-label">
          target<em className="field-hint">several targets fan out in parallel</em>
        </span>
        <div className="checkbox-list">
          {targets.map((name: string) => (
            <label className="checkbox-row" key={name}>
              <input
                type="checkbox"
                checked={edge.target.includes(name)}
                onChange={(): void => toggleTarget(name)}
              />
              <span className="mono">{name}</span>
            </label>
          ))}
        </div>
      </div>

      <Field label="max" hint="how often this edge may be taken — every loop needs one">
        <input
          className="input"
          type="number"
          min={1}
          step={1}
          value={edge.max ?? ''}
          placeholder="uncapped"
          onChange={(e: ChangeEvent<HTMLInputElement>): void => {
            const raw: string = e.target.value;
            patch({ max: raw === '' ? undefined : Math.max(1, Math.floor(Number(raw))) });
          }}
        />
      </Field>

      <Field label="onMax" hint="where to go once max is used up">
        <StringListEditor
          values={edge.onMax ?? []}
          placeholder="END"
          addLabel="fallback target"
          onChange={(values: string[]): void =>
            patch({ onMax: values.length > 0 ? values : undefined })
          }
        />
      </Field>

      <Field label="condition" hint='the escape hatch, not the default — e.g. "findings > 1"'>
        <TextInput
          value={edge.condition ?? ''}
          placeholder="score >= 8"
          monospace
          onChange={(value: string): void => patch({ condition: value === '' ? undefined : value })}
        />
      </Field>

      <button
        type="button"
        className="danger-button"
        onClick={(): void => {
          onChange(deleteEvent(pipeline, source, event));
          onSelect({ kind: 'step', name: source });
        }}
      >
        Delete event
      </button>
    </div>
  );
};
