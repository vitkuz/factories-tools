import type { ReactNode } from 'react';
import type { Pipeline, ScalarValue } from '../lib/pipeline.types';
import { setStart, stepNames } from '../lib/pipeline.utils';
import { Field, KeyValueEditor, TextInput } from './Fields';

interface PipelineInspectorProps {
  pipeline: Pipeline;
  onChange: (pipeline: Pipeline) => void;
  /** Which parts to show; the wizard splits them across screens. */
  sections?: ('meta' | 'start')[];
}

export const PipelineInspector = ({
  pipeline,
  onChange,
  sections = ['meta', 'start'],
}: PipelineInspectorProps): ReactNode => {
  const names: string[] = stepNames(pipeline);
  const show = (section: 'meta' | 'start'): boolean => sections.includes(section);

  const toggleStart = (name: string): void => {
    const next: string[] = pipeline.START.includes(name)
      ? pipeline.START.filter((entry: string): boolean => entry !== name)
      : [...pipeline.START, name];
    onChange(setStart(pipeline, next));
  };

  return (
    <div className="inspector-body">
      {show('meta') ? (
        <>
          <Field label="id" hint="the directory and the /command">
            <TextInput
              value={pipeline.id}
              monospace
              onChange={(value: string): void => onChange({ ...pipeline, id: value })}
            />
          </Field>

          <Field label="description" hint="one line, optional">
            <TextInput
              value={pipeline.description ?? ''}
              onChange={(value: string): void =>
                onChange({ ...pipeline, description: value === '' ? undefined : value })
              }
            />
          </Field>

          <Field label="outputDir" hint="{{id}}, {{slug}} and {{date}} are built in">
            <TextInput
              value={pipeline.outputDir}
              monospace
              onChange={(value: string): void => onChange({ ...pipeline, outputDir: value })}
            />
          </Field>

          <Field
            label="constants"
            hint="baked in; rootPath, skillPath and homePath are fixed anchors, factoryPath is the factory folder"
          >
            <KeyValueEditor
              entries={pipeline.constants}
              lockedKeys={['rootPath', 'skillPath', 'homePath', 'factoryPath']}
              onChange={(entries: Record<string, ScalarValue>): void =>
                onChange({ ...pipeline, constants: entries })
              }
            />
          </Field>

          <Field label="params" hint="change per run; an empty default means 'ask me'">
            <KeyValueEditor
              entries={pipeline.params}
              onChange={(entries: Record<string, ScalarValue>): void =>
                onChange({ ...pipeline, params: entries })
              }
            />
          </Field>
        </>
      ) : null}

      {show('start') ? (
        <div className="field">
          <span className="field-label">
            START<em className="field-hint">several entries fan out in parallel</em>
          </span>
          <div className="checkbox-list">
            {names.map((name: string) => (
              <label className="checkbox-row" key={name}>
                <input
                  type="checkbox"
                  checked={pipeline.START.includes(name)}
                  onChange={(): void => toggleStart(name)}
                />
                <span className="mono">{name}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
