import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import type { PipelineListEntry, ListState } from '../../editor/editor.types';

interface StartFormProps {
  entries: PipelineListEntry[];
  listState: ListState;
  busy: boolean;
  onStart: (id: string, prompt: string) => void;
}

/** A prompt, a factory, and Start — disabled until both are there. */
export const StartForm = ({ entries, listState, busy, onStart }: StartFormProps): ReactNode => {
  const [prompt, setPrompt] = useState<string>('');
  const [id, setId] = useState<string>('');
  const chosen: string = id !== '' ? id : (entries[0]?.id ?? '');
  const canStart: boolean = prompt.trim() !== '' && chosen !== '' && !busy;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canStart) return;
    onStart(chosen, prompt);
  };

  return (
    <form className="sessions-form" onSubmit={submit} aria-label="Start a session">
      <label className="field">
        <span className="field-label">prompt</span>
        <textarea
          className="input textarea sessions-prompt"
          value={prompt}
          placeholder="What should the factory do?"
          rows={8}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
            setPrompt(event.target.value)
          }
        />
      </label>
      <label className="field">
        <span className="field-label">factory</span>
        <select
          className="input select"
          value={chosen}
          disabled={listState !== 'ready' || entries.length === 0}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void => setId(event.target.value)}
        >
          {listState === 'loading' ? <option value="">loading…</option> : null}
          {listState === 'failed' ? <option value="">could not list pipelines</option> : null}
          {listState === 'ready' && entries.length === 0 ? <option value="">none</option> : null}
          {entries.map((entry: PipelineListEntry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id}
            </option>
          ))}
        </select>
        <span className="field-hint">harness: claude</span>
      </label>
      <div className="sessions-actions">
        <button type="submit" className="primary-button" disabled={!canStart}>
          {busy ? 'Starting…' : 'Start'}
        </button>
      </div>
    </form>
  );
};
