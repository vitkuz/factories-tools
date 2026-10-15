import { useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import type { PipelineStep, Reference } from '../lib/pipeline.types';
import { BLOCK_DRAG_TYPE } from '../lib/pipeline.types';
import { stepNames } from '../lib/pipeline.utils';
import type { PipelineListEntry } from '../editor.types';

interface LibraryProps {
  references: Reference[];
  /** The pipelines the API lists: each can be loaded as a reference without a file. */
  apiReferences: PipelineListEntry[];
  /** Files the user picked, read to text, with their names. */
  onLoad: (files: { text: string; filename: string }[]) => void;
  /** Load these ids from the API as references. */
  onLoadFromApi: (ids: string[]) => void;
  onRemove: (key: string) => void;
  onAddStep: (reference: string, step: string) => void;
  onAddAll: (reference: string) => void;
  onClose: () => void;
}

/**
 * Building blocks: every step of every loaded reference pipeline, ready to be
 * dragged onto the canvas or added with a click. References are read-only
 * here — the open pipeline is the only thing that changes.
 */
export const Library = ({
  references,
  apiReferences,
  onLoad,
  onLoadFromApi,
  onRemove,
  onAddStep,
  onAddAll,
  onClose,
}: LibraryProps): ReactNode => {
  const fileInput = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<string>('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [apiOpen, setApiOpen] = useState<boolean>(false);
  const [picked, setPicked] = useState<string[]>([]);

  const togglePicked = (id: string): void =>
    setPicked(
      picked.includes(id)
        ? picked.filter((entry: string): boolean => entry !== id)
        : [...picked, id],
    );

  const addPicked = (): void => {
    if (picked.length === 0) return;
    onLoadFromApi(picked);
    setPicked([]);
    setApiOpen(false);
  };

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files: File[] = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;
    onLoad(
      await Promise.all(
        files.map(async (file: File): Promise<{ text: string; filename: string }> => ({
          text: await file.text(),
          filename: file.name,
        })),
      ),
    );
  };

  const needle: string = filter.trim().toLowerCase();
  const matches = (name: string, step: PipelineStep): boolean =>
    needle === '' || name.includes(needle) || step.agent.toLowerCase().includes(needle);

  const startDrag = (event: DragEvent<HTMLElement>, reference: string, step: string): void => {
    event.dataTransfer.setData(BLOCK_DRAG_TYPE, JSON.stringify({ reference, step }));
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside className="library">
      <header className="library-head">
        <span className="panel-heading library-title">Blocks</span>
        <button type="button" className="icon-button" title="close the library" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="library-tools">
        <button type="button" onClick={(): void => fileInput.current?.click()}>
          Load references…
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="application/json,.json"
          className="hidden-input"
          onChange={handleFiles}
        />
        <button
          type="button"
          className={apiOpen ? 'is-active' : undefined}
          disabled={apiReferences.length === 0}
          title="pipelines the API lists, as references"
          onClick={(): void => setApiOpen(!apiOpen)}
        >
          From API…
        </button>
        <input
          className="input"
          placeholder="filter by step or agent"
          value={filter}
          onChange={(event: ChangeEvent<HTMLInputElement>): void => setFilter(event.target.value)}
        />
      </div>

      {apiOpen ? (
        <div className="library-api" role="group" aria-label="Pipelines on the API">
          {apiReferences.map((entry: PipelineListEntry) => (
            <label key={entry.id} className="checkbox-row">
              <input
                type="checkbox"
                checked={picked.includes(entry.id)}
                onChange={(): void => togglePicked(entry.id)}
              />
              <span className="mono">{entry.id}</span>
            </label>
          ))}
          <button type="button" disabled={picked.length === 0} onClick={addPicked}>
            Add
          </button>
        </div>
      ) : null}

      <div className="library-scroll">
        {references.length === 0 ? (
          <p className="empty library-empty">
            Load one or more pipeline.json files. Every step becomes a block: drag it onto the
            canvas, or click + to append it. Blocks from the same pipeline reconnect as you add
            them.
          </p>
        ) : null}

        {references.map((reference: Reference) => {
          const names: string[] = stepNames(reference.pipeline).filter((name: string): boolean =>
            matches(name, reference.pipeline.steps[name]),
          );
          const isCollapsed: boolean = collapsed[reference.key] === true;
          return (
            <section className="library-group" key={reference.key}>
              <header className="library-group-head">
                <button
                  type="button"
                  className="library-toggle"
                  onClick={(): void =>
                    setCollapsed({ ...collapsed, [reference.key]: !isCollapsed })
                  }
                  title={reference.filename}
                >
                  <span className="library-caret">{isCollapsed ? '▸' : '▾'}</span>
                  <span className="mono">{reference.key}</span>
                  <span className="library-count">{stepNames(reference.pipeline).length}</span>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="add every step, wired as in the reference"
                  onClick={(): void => onAddAll(reference.key)}
                >
                  all
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title="drop this reference from the library"
                  onClick={(): void => onRemove(reference.key)}
                >
                  ×
                </button>
              </header>

              {isCollapsed
                ? null
                : names.map((name: string) => {
                    const step: PipelineStep = reference.pipeline.steps[name];
                    const events: string[] = Object.keys(step.transitions);
                    return (
                      <div
                        className={`block${step.agent === 'human' ? ' is-human' : ''}`}
                        key={name}
                        draggable
                        onDragStart={(event: DragEvent<HTMLDivElement>): void =>
                          startDrag(event, reference.key, name)
                        }
                        title={step.prompt[0] ?? ''}
                      >
                        <span className="block-grip" aria-hidden="true">
                          ⋮⋮
                        </span>
                        <span className="block-body">
                          <span className="block-name">{name}</span>
                          <span className="block-agent">{step.agent}</span>
                          <span className="block-events">{events.join(' · ')}</span>
                        </span>
                        <button
                          type="button"
                          className="icon-button block-add"
                          title="append this step to the pipeline"
                          onClick={(): void => onAddStep(reference.key, name)}
                        >
                          +
                        </button>
                      </div>
                    );
                  })}
            </section>
          );
        })}
      </div>
    </aside>
  );
};
