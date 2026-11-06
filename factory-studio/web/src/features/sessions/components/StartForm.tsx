import {
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type {
  FactoryParam,
  ListState,
  ParamDraft,
  ParamWidget,
  PipelineListEntry,
  StartRequest,
} from '../sessions.types';
import {
  buildStartRequest,
  initialParamDraft,
  paramWidget,
  selectOptions,
  startBlocker,
} from '../sessions.utils';

interface StartFormProps {
  entries: PipelineListEntry[];
  /** Every factory is outside the chosen workspace: the list is empty because of the filter. */
  outsideWorkspace?: boolean;
  listState: ListState;
  busy: boolean;
  onStart: (request: StartRequest) => void;
}

interface ParamFieldProps {
  param: FactoryParam;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}

const fieldId = (name: string): string => `start-param-${name}`;
const descriptionId = (name: string): string => `start-param-${name}-description`;

/** The param's name, a mark when it is required, and a tag on the one that names the run folder. */
const ParamLabel = ({ param }: { param: FactoryParam }): ReactNode => (
  <>
    <span className="sessions-param-name">{param.name}</span>
    {param.required ? (
      <span className="sessions-param-required" title="Required">
        *
      </span>
    ) : null}
    {param.main ? (
      <span className="sessions-param-tag" title="The run folder is named after this param">
        run name
      </span>
    ) : null}
  </>
);

/** The pipeline's help text for a param (`paramsInfo`), under its field. */
const ParamDescription = ({ param }: { param: FactoryParam }): ReactNode =>
  param.description === undefined ? null : (
    <p id={descriptionId(param.name)} className="sessions-param-description">
      {param.description}
    </p>
  );

/**
 * One param: a checkbox, a number, a select, a one-line text or a growing textarea, pre-filled
 * with the default, its help text under it.
 */
const ParamField = ({ param, value, onChange }: ParamFieldProps): ReactNode => {
  const widget: ParamWidget = paramWidget(param);
  const id: string = fieldId(param.name);
  const placeholder: string = param.required ? 'required' : '';
  const describedBy: string | undefined =
    param.description === undefined ? undefined : descriptionId(param.name);

  if (widget === 'checkbox') {
    const check: ReactNode = (
      <label className="sessions-param sessions-param-check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          aria-describedby={describedBy}
          onChange={(event: ChangeEvent<HTMLInputElement>): void => onChange(event.target.checked)}
        />
        <ParamLabel param={param} />
      </label>
    );
    return describedBy === undefined ? (
      check
    ) : (
      <div className="sessions-param sessions-param-described">
        {check}
        <ParamDescription param={param} />
      </div>
    );
  }

  const field = (): ReactNode => {
    if (widget === 'select')
      return (
        <select
          id={id}
          className="control is-mono sessions-param-input"
          value={String(value)}
          required={param.required}
          aria-describedby={describedBy}
          onChange={(event: ChangeEvent<HTMLSelectElement>): void => onChange(event.target.value)}
        >
          {selectOptions(param).map((option: string) => (
            <option key={option} value={option}>
              {option === '' ? placeholder : option}
            </option>
          ))}
        </select>
      );
    if (widget === 'textarea')
      return (
        <textarea
          id={id}
          className="control sessions-param-input sessions-param-textarea"
          value={String(value)}
          rows={1}
          required={param.required}
          placeholder={placeholder}
          aria-describedby={describedBy}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => onChange(event.target.value)}
        />
      );
    return (
      <input
        id={id}
        className="control sessions-param-input"
        type={widget === 'number' ? 'number' : 'text'}
        step={widget === 'number' && !Number.isInteger(param.default) ? 'any' : undefined}
        inputMode={widget === 'number' ? 'decimal' : undefined}
        value={String(value)}
        required={param.required}
        placeholder={placeholder}
        aria-describedby={describedBy}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => onChange(event.target.value)}
      />
    );
  };

  return (
    <div className={`sessions-param${widget === 'textarea' ? ' is-wide' : ''}`}>
      <label className="sessions-param-label" htmlFor={id}>
        <ParamLabel param={param} />
      </label>
      {field()}
      <ParamDescription param={param} />
    </div>
  );
};

/**
 * The factory and Start on the first row. A factory with params gets one field per param under
 * it, pre-filled with the defaults, and an optional "extra instructions" field; one without
 * params keeps the single free-text prompt in the row. What is typed is kept per factory while
 * the screen is open. Ctrl/⌘+Enter starts.
 */
export const StartForm = ({
  entries,
  outsideWorkspace = false,
  listState,
  busy,
  onStart,
}: StartFormProps): ReactNode => {
  const [prompt, setPrompt] = useState<string>('');
  const [id, setId] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<string, ParamDraft>>({});
  // The kept pick holds while it is offered; a workspace that hides it falls back to the first.
  const chosen: string = entries.some((item: PipelineListEntry): boolean => item.id === id)
    ? id
    : (entries[0]?.id ?? '');
  const entry: PipelineListEntry | undefined = entries.find(
    (candidate: PipelineListEntry): boolean => candidate.id === chosen,
  );
  const params: FactoryParam[] = entry?.params ?? [];
  const draft: ParamDraft = drafts[chosen] ?? initialParamDraft(params);
  const blocker: string | null = startBlocker(entry, draft, prompt);
  const canStart: boolean = blocker === null && !busy;

  const setParam =
    (name: string) =>
    (value: string | boolean): void =>
      setDrafts((current: Record<string, ParamDraft>): Record<string, ParamDraft> => ({
        ...current,
        [chosen]: { ...draft, [name]: value },
      }));

  const start = (): void => {
    if (canStart && entry !== undefined) onStart(buildStartRequest(entry, draft, prompt));
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    start();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    start();
  };

  const promptField = (className: string, placeholder: string): ReactNode => (
    <textarea
      id="start-prompt"
      className={`control ${className}`}
      value={prompt}
      placeholder={placeholder}
      rows={1}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => setPrompt(event.target.value)}
    />
  );

  return (
    <form
      className="panel sessions-form"
      onSubmit={submit}
      onKeyDown={onKeyDown}
      aria-label="Start a session"
    >
      <div className="panel-head">
        <h2 className="kicker">New session</h2>
        <span className="panel-note">Ctrl+Enter starts</span>
      </div>
      <div className="panel-body sessions-form-body">
        <div className="sessions-form-row">
          <span className="bar-field sessions-factory-field">
            <span className="kicker" aria-hidden="true">
              Pipeline
            </span>
            <label className="visually-hidden" htmlFor="start-factory">
              Factory (harness: claude)
            </label>
            <select
              id="start-factory"
              className="control is-mono sessions-factory"
              value={chosen}
              title={entry?.description}
              disabled={listState !== 'ready' || entries.length === 0}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void => setId(event.target.value)}
            >
              {listState === 'loading' ? <option value="">loading…</option> : null}
              {listState === 'failed' ? <option value="">could not list pipelines</option> : null}
              {listState === 'ready' && entries.length === 0 ? (
                <option value="" disabled={outsideWorkspace}>
                  {outsideWorkspace ? 'no factories in this workspace' : 'none'}
                </option>
              ) : null}
              {entries.map((item: PipelineListEntry) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
            </select>
          </span>
          {params.length === 0 ? (
            <>
              <label className="visually-hidden" htmlFor="start-prompt">
                Prompt
              </label>
              {promptField('sessions-prompt', 'What should the factory do?')}
            </>
          ) : (
            <p className="sessions-hint" title={entry?.description}>
              {entry?.description ?? ''}
            </p>
          )}
          <button
            type="submit"
            className="btn btn--bar btn--primary sessions-start"
            disabled={!canStart}
            title={blocker ?? 'Start (Ctrl+Enter)'}
          >
            {busy ? 'Starting…' : 'Start session'}
          </button>
        </div>
        {params.length > 0 ? (
          <div className="sessions-params">
            {params.map((param: FactoryParam) => (
              <ParamField
                key={`${chosen}:${param.name}`}
                param={param}
                value={draft[param.name] ?? ''}
                onChange={setParam(param.name)}
              />
            ))}
            <div className="sessions-param is-wide">
              <label className="sessions-param-label" htmlFor="start-prompt">
                <span className="sessions-param-name">extra instructions</span>
                <span className="sessions-param-optional">optional</span>
              </label>
              {promptField(
                'sessions-param-input sessions-param-textarea',
                'Anything the params do not cover',
              )}
            </div>
          </div>
        ) : null}
      </div>
    </form>
  );
};
