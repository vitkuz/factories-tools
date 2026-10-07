import type { ChangeEvent, ReactNode } from 'react';
import type { PipelineListEntry } from '../editor.types';

interface PipelinePickerProps {
  entries: PipelineListEntry[];
  /** The id on screen, or `null` before the first pipeline has loaded. */
  value: string | null;
  loading: boolean;
  onChange: (id: string) => void;
}

/** The pipelines the API lists, as a native select in the editor's segmented style. */
export const PipelinePicker = ({
  entries,
  value,
  loading,
  onChange,
}: PipelinePickerProps): ReactNode => (
  <label className="picker" title="the pipelines found under factories/">
    <span className="picker-label">pipeline</span>
    <select
      className="input select picker-select"
      value={value ?? ''}
      disabled={loading || entries.length === 0}
      aria-label="Pipeline"
      onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
        if (event.target.value !== '') onChange(event.target.value);
      }}
    >
      {loading || value === null ? (
        <option value="">{loading ? 'loading…' : entries.length === 0 ? 'none' : 'choose…'}</option>
      ) : null}
      {entries.map((entry: PipelineListEntry) => (
        <option key={entry.id} value={entry.id}>
          {entry.id}
        </option>
      ))}
    </select>
  </label>
);
