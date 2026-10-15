import { useRef, type ChangeEvent, type ReactNode } from 'react';
import type { Mode } from '../lib/pipeline.types';
import type { SaveState } from '../editor.types';

interface ToolbarProps {
  /** The pipeline picker, rendered where the editor's brand used to be (the shell shows the brand). */
  picker: ReactNode;
  pipelineId: string;
  errorCount: number;
  warningCount: number;
  mode: Mode;
  focusPath: boolean;
  canUndo: boolean;
  canRedo: boolean;
  saveState: SaveState;
  canSave: boolean;
  onMode: (mode: Mode) => void;
  onFocusPath: (on: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddStep: () => void;
  onWizard: () => void;
  libraryOpen: boolean;
  onLibrary: () => void;
  onLoadText: (text: string, filename: string) => void;
  onSave: () => void;
  onExport: () => void;
  onExportPng: () => void;
  onCopy: () => void;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
}

const Segmented = <T extends string>({
  value,
  options,
  onChange,
}: SegmentedProps<T>): ReactNode => (
  <div className="segmented" role="group">
    {options.map((option: { value: T; label: string; title?: string }) => (
      <button
        type="button"
        key={option.value}
        title={option.title}
        className={option.value === value ? 'is-active' : undefined}
        onClick={(): void => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

/** The Save button's word, by where the pipeline stands against the file on disk. */
const saveLabel = (state: SaveState): string => {
  switch (state.status) {
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'failed':
      return state.issues.length > 0
        ? `Save (${state.issues.length} issue${state.issues.length === 1 ? '' : 's'})`
        : 'Save';
    case 'clean':
    case 'dirty':
      return 'Save';
  }
};

export const Toolbar = ({
  picker,
  pipelineId,
  errorCount,
  warningCount,
  mode,
  focusPath,
  canUndo,
  canRedo,
  saveState,
  canSave,
  onMode,
  onFocusPath,
  onUndo,
  onRedo,
  onAddStep,
  onWizard,
  libraryOpen,
  onLibrary,
  onLoadText,
  onSave,
  onExport,
  onExportPng,
  onCopy,
}: ToolbarProps): ReactNode => {
  const fileInput = useRef<HTMLInputElement>(null);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file: File | undefined = event.target.files?.[0];
    if (!file) return;
    onLoadText(await file.text(), file.name);
    event.target.value = '';
  };

  return (
    <header className="toolbar">
      {picker}

      <div className="toolbar-title">
        <strong className="mono">{pipelineId}</strong>
        <span className="toolbar-subtitle">
          {mode === 'view' ? 'viewing' : 'editing'}
          {saveState.status === 'dirty' ? ' · unsaved' : ''}
        </span>
      </div>

      <div className="toolbar-status">
        <span
          className={errorCount > 0 ? 'badge badge-error' : 'badge badge-ok'}
          title={`${errorCount} error${errorCount === 1 ? '' : 's'}`}
        >
          {errorCount} ✕
        </span>
        <span
          className={warningCount > 0 ? 'badge badge-warning' : 'badge badge-ok'}
          title={`${warningCount} warning${warningCount === 1 ? '' : 's'}`}
        >
          {warningCount} ⚠
        </span>
      </div>

      <div className="toolbar-view">
        <Segmented<Mode>
          value={mode}
          onChange={onMode}
          options={[
            { value: 'view', label: 'View', title: 'read-only: hover to trace, click to inspect' },
            { value: 'edit', label: 'Edit', title: 'drag, connect, rename, delete' },
          ]}
        />
        <button
          type="button"
          className={focusPath ? 'is-active' : undefined}
          title="grey out every retry, fallback and early exit"
          onClick={(): void => onFocusPath(!focusPath)}
        >
          Happy path
        </button>
      </div>

      <div className="toolbar-actions">
        {mode === 'edit' ? (
          <>
            <button type="button" onClick={onUndo} disabled={!canUndo} title="Ctrl+Z">
              Undo
            </button>
            <button type="button" onClick={onRedo} disabled={!canRedo} title="Ctrl+Shift+Z">
              Redo
            </button>
            <button type="button" onClick={onAddStep}>
              Add step
            </button>
            <button type="button" onClick={onWizard} title="build a pipeline step by step">
              Wizard…
            </button>
            <button
              type="button"
              className={libraryOpen ? 'is-active' : undefined}
              onClick={onLibrary}
              title="steps of other pipelines, as blocks to drag in"
            >
              Blocks
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={(): void => fileInput.current?.click()}
          title="open a pipeline.json from your computer (Save writes it to the factory named in the picker, or creates a new one when its id is free)"
        >
          Load…
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={onSave}
          disabled={!canSave || saveState.status === 'saving'}
          title="write factories/<id>/pipeline.json back to disk; a free id creates the factory and its wrapper skill"
        >
          {saveLabel(saveState)}
        </button>
        <button type="button" onClick={onExport} title="download pipeline.json">
          Export JSON
        </button>
        <button type="button" onClick={onCopy} title="copy pipeline.json to the clipboard">
          Copy
        </button>
        <button type="button" onClick={onExportPng} title="download the whole graph as a PNG">
          PNG
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden-input"
          onChange={handleFile}
        />
      </div>
    </header>
  );
};
