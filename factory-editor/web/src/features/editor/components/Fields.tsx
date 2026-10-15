import type { ChangeEvent, ReactNode } from 'react';
import type { ScalarValue } from '../lib/pipeline.types';

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

export const Field = ({ label, hint, children }: FieldProps): ReactNode => (
  <label className="field">
    <span className="field-label">
      {label}
      {hint ? <em className="field-hint">{hint}</em> : null}
    </span>
    {children}
  </label>
);

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  monospace?: boolean;
}

export const TextInput = ({
  value,
  onChange,
  placeholder,
  monospace,
}: TextInputProps): ReactNode => (
  <input
    className={monospace ? 'input mono' : 'input'}
    value={value}
    placeholder={placeholder}
    onChange={(event: ChangeEvent<HTMLInputElement>): void => onChange(event.target.value)}
  />
);

interface TextAreaProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}

export const TextArea = ({ value, onChange, rows = 6, placeholder }: TextAreaProps): ReactNode => (
  <textarea
    className="input textarea"
    rows={rows}
    value={value}
    placeholder={placeholder}
    onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => onChange(event.target.value)}
  />
);

interface StringListEditorProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}

/** An ordered list of paths — `input`, `output`, `knowledge`, `onMax`. */
export const StringListEditor = ({
  values,
  onChange,
  placeholder,
  addLabel = 'Add',
}: StringListEditorProps): ReactNode => (
  <div className="list-editor">
    {values.map((value: string, index: number) => (
      // eslint-disable-next-line react/no-array-index-key -- positional list, values may repeat
      <div className="list-row" key={index}>
        <input
          className="input mono"
          value={value}
          placeholder={placeholder}
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            onChange(
              values.map((entry: string, i: number) => (i === index ? event.target.value : entry)),
            )
          }
        />
        <button
          type="button"
          className="icon-button"
          title="Remove"
          onClick={(): void => onChange(values.filter((_: string, i: number) => i !== index))}
        >
          ×
        </button>
      </div>
    ))}
    <button type="button" className="ghost-button" onClick={(): void => onChange([...values, ''])}>
      + {addLabel}
    </button>
  </div>
);

interface KeyValueEditorProps {
  entries: Record<string, ScalarValue>;
  onChange: (entries: Record<string, ScalarValue>) => void;
  lockedKeys?: string[];
}

/** `params` and `constants`: an ordered map of names to scalar values. */
export const KeyValueEditor = ({
  entries,
  onChange,
  lockedKeys = [],
}: KeyValueEditorProps): ReactNode => {
  const rows: [string, ScalarValue][] = Object.entries(entries);

  const replace = (index: number, key: string, value: ScalarValue): void =>
    onChange(
      Object.fromEntries(
        rows.map((row: [string, ScalarValue], i: number): [string, ScalarValue] =>
          i === index ? [key, value] : row,
        ),
      ),
    );

  return (
    <div className="list-editor">
      {rows.map(([key, value]: [string, ScalarValue], index: number) => (
        // eslint-disable-next-line react/no-array-index-key -- keys are edited in place
        <div className="list-row" key={index}>
          <input
            className="input mono key-input"
            value={key}
            disabled={lockedKeys.includes(key)}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              replace(index, event.target.value, value)
            }
          />
          <input
            className="input mono"
            value={String(value)}
            placeholder="(no default)"
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              const next: string = event.target.value;
              const asNumber = Number(next);
              const useNumber: boolean =
                typeof value === 'number' && next.trim() !== '' && !Number.isNaN(asNumber);
              replace(index, key, useNumber ? asNumber : next);
            }}
          />
          <button
            type="button"
            className="icon-button"
            title={lockedKeys.includes(key) ? 'required — cannot be removed' : 'Remove'}
            disabled={lockedKeys.includes(key)}
            onClick={(): void =>
              onChange(
                Object.fromEntries(
                  rows.filter((_: [string, ScalarValue], i: number) => i !== index),
                ),
              )
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ghost-button"
        onClick={(): void => {
          const base = 'new_key';
          const key: string = entries[base] === undefined ? base : `${base}_${rows.length + 1}`;
          onChange({ ...entries, [key]: '' });
        }}
      >
        + Add
      </button>
    </div>
  );
};
