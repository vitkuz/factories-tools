import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  Issue,
  Pipeline,
  PipelineEdge,
  PipelineStep,
  Selection,
  WizardMode,
  WizardScreen,
} from '../../lib/pipeline.types';
import { END } from '../../lib/pipeline.types';
import { validatePipeline } from '../../lib/validate.utils';
import { pipelineSchema } from '../../lib/pipeline.schema';
import {
  connectStep,
  deleteStep,
  freeName,
  insertStep,
  nextEventName,
  stepNames,
} from '../../lib/pipeline.utils';
import {
  blankPipeline,
  edgeCount,
  issuesForScreen,
  orphanSteps,
  SCREEN_GUIDES,
  SCREEN_TITLES,
  WIZARD_SCREENS,
  withNewStep,
} from '../../lib/wizard.utils';
import { PipelineInspector } from '../PipelineInspector';
import { StepInspector } from '../StepInspector';
import { EdgeInspector } from '../EdgeInspector';

interface WizardProps {
  /** The pipeline open in the editor, offered as the base to extend. */
  current: Pipeline;
  onCancel: () => void;
  /** Hand the finished pipeline back: replace the editor's (new) or edit it (extend). */
  onFinish: (pipeline: Pipeline, mode: WizardMode) => void;
}

interface IssueStripProps {
  issues: Issue[];
  onSelect?: (issue: Issue) => void;
}

/** The issues a screen owns, in the Checks panel's words. */
const IssueStrip = ({ issues, onSelect }: IssueStripProps): ReactNode => {
  if (issues.length === 0) return <p className="empty">Nothing to fix on this screen.</p>;
  return (
    <ul className="wizard-issues">
      {issues.map((issue: Issue, index: number) => (
        // eslint-disable-next-line react/no-array-index-key -- positional, may repeat
        <li key={index} className={`issue issue-${issue.level}`}>
          <button
            type="button"
            className="issue-button"
            disabled={onSelect === undefined}
            onClick={(): void => onSelect?.(issue)}
          >
            <span className="issue-where mono">{issue.where}</span>
            <span className="issue-message">{issue.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
};

/**
 * The zod schema, run on the draft, in the same words the Load button would
 * use — so the wizard never finishes with a file the schema would refuse.
 */
const schemaIssues = (pipeline: Pipeline): Issue[] => {
  const result = pipelineSchema.safeParse(pipeline);
  if (result.success) return [];
  return result.error.issues.map((issue): Issue => ({
    level: 'error',
    where: issue.path.join('.') || '<root>',
    message: `schema: ${issue.message}`,
    subject: typeof issue.path[1] === 'string' ? issue.path[1] : undefined,
  }));
};

export const Wizard = ({ current, onCancel, onFinish }: WizardProps): ReactNode => {
  const [mode, setMode] = useState<WizardMode | null>(null);
  const [draft, setDraft] = useState<Pipeline>(current);
  const [screen, setScreen] = useState<WizardScreen>('pipeline');
  const [stepName, setStepName] = useState<string | null>(null);
  const [edge, setEdge] = useState<{ source: string; event: string } | null>(null);

  useEffect((): (() => void) => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const issues: Issue[] = useMemo(
    (): Issue[] => [...schemaIssues(draft), ...validatePipeline(draft)],
    [draft],
  );
  const screenIssues: Issue[] = issuesForScreen(issues, screen);
  const errorCount: number = issues.filter(
    (issue: Issue): boolean => issue.level === 'error',
  ).length;
  const names: string[] = stepNames(draft);
  const index: number = WIZARD_SCREENS.indexOf(screen);

  const begin = (chosen: WizardMode): void => {
    setMode(chosen);
    if (chosen === 'new') {
      const fresh: Pipeline = blankPipeline();
      setDraft(fresh);
      setStepName(stepNames(fresh)[0]);
      setScreen('pipeline');
    } else {
      const [extended, name]: [Pipeline, string] = withNewStep(current);
      setDraft(extended);
      setStepName(name);
      setScreen('steps');
    }
  };

  const addStep = (): void => {
    const name: string = freeName(draft, 'new-step');
    setDraft(insertStep(draft, name, null, ''));
    setStepName(name);
  };

  const removeStep = (name: string): void => {
    const next: Pipeline = deleteStep(draft, name);
    setDraft(next);
    const remaining: string[] = stepNames(next);
    setStepName(remaining[0] ?? null);
  };

  const addEvent = (source: string): void => {
    const event: string = nextEventName(draft, source);
    setDraft(connectStep(draft, source, event, END));
    setEdge({ source, event });
  };

  const onSelect = (selection: Selection | null): void => {
    if (selection?.kind === 'step') {
      setStepName(selection.name);
      if (screen === 'wiring') setEdge(null);
    } else if (selection?.kind === 'edge') {
      setEdge({ source: selection.source, event: selection.event });
      if (screen === 'steps') setScreen('wiring');
    }
  };

  const jumpTo = (issue: Issue): void => {
    const target: WizardScreen =
      (['pipeline', 'steps', 'wiring'] as WizardScreen[]).find(
        (candidate: WizardScreen): boolean => issuesForScreen([issue], candidate).length > 0,
      ) ?? 'review';
    setScreen(target);
    if (issue.subject && draft.steps[issue.subject]) setStepName(issue.subject);
    const match: RegExpMatchArray | null = issue.where.match(
      /^steps\.([^.]+)\.transitions\.([^.]+)/,
    );
    if (match) setEdge({ source: match[1], event: match[2] });
  };

  const stepIssues = (name: string): number =>
    issues.filter((issue: Issue): boolean => issue.subject === name).length;

  if (mode === null) {
    return (
      <div className="wizard-backdrop" onClick={onCancel}>
        <div className="wizard" onClick={(event): void => event.stopPropagation()}>
          <header className="wizard-head">
            <span className="wizard-title">Pipeline wizard</span>
          </header>
          <div className="wizard-choice">
            <button type="button" onClick={(): void => begin('new')}>
              <strong>Start from nothing</strong>
              <span>
                A new pipeline: its id and output folder, its params and constants, then the steps
                and how their events wire together. The editor opens on the result.
              </span>
            </button>
            <button type="button" onClick={(): void => begin('extend')}>
              <strong>Add a step to {current.id}</strong>
              <span>
                One more step in the pipeline that is open: what it runs, what it reads and writes,
                and where it sits in the graph. Undo takes it back out.
              </span>
            </button>
          </div>
          <footer className="wizard-foot">
            <span className="spacer" />
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </footer>
        </div>
      </div>
    );
  }

  const stepList: ReactNode = (
    <div className="wizard-list">
      <p className="wizard-list-title">Steps</p>
      {names.map((name: string) => (
        <button
          type="button"
          key={name}
          className={`wizard-item${name === stepName ? ' is-current' : ''}`}
          onClick={(): void => {
            setStepName(name);
            setEdge(null);
          }}
        >
          {name}
          {stepIssues(name) > 0 ? <span className="step-issues">{stepIssues(name)}</span> : null}
        </button>
      ))}
      <button type="button" className="ghost-button" onClick={addStep}>
        + Add step
      </button>
    </div>
  );

  const eventList: ReactNode = (
    <div className="wizard-list">
      <p className="wizard-list-title">START</p>
      <button
        type="button"
        className={`wizard-item${stepName === null && edge === null ? ' is-current' : ''}`}
        onClick={(): void => {
          setStepName(null);
          setEdge(null);
        }}
      >
        START → {draft.START.join(', ') || '(nothing)'}
      </button>
      {names.map((name: string) => {
        const step: PipelineStep = draft.steps[name];
        return (
          <div key={name}>
            <p className="wizard-list-title">{name}</p>
            {Object.entries(step.transitions).map(([event, on]: [string, PipelineEdge]) => (
              <button
                type="button"
                key={event}
                className={`wizard-item${
                  edge?.source === name && edge.event === event ? ' is-current' : ''
                }`}
                onClick={(): void => {
                  setStepName(name);
                  setEdge({ source: name, event });
                }}
              >
                {event} → {on.target.join(', ')}
                {on.max !== undefined ? <span className="chip">max {on.max}</span> : null}
              </button>
            ))}
            <button type="button" className="ghost-button" onClick={(): void => addEvent(name)}>
              + event
            </button>
          </div>
        );
      })}
    </div>
  );

  const pane: ReactNode =
    screen === 'pipeline' ? (
      <>
        <PipelineInspector pipeline={draft} onChange={setDraft} sections={['meta']} />
        <section className="issues">
          <h2 className="panel-heading">Checks on this screen</h2>
          <IssueStrip issues={screenIssues} />
        </section>
      </>
    ) : screen === 'steps' ? (
      <>
        {stepName && draft.steps[stepName] ? (
          <StepInspector
            pipeline={draft}
            name={stepName}
            onChange={setDraft}
            onSelect={onSelect}
            onDelete={(): void => removeStep(stepName)}
          />
        ) : (
          <p className="empty">Add a step to begin.</p>
        )}
        <section className="issues">
          <h2 className="panel-heading">Checks on this screen</h2>
          <IssueStrip issues={screenIssues} />
        </section>
      </>
    ) : screen === 'wiring' ? (
      <>
        {edge && draft.steps[edge.source]?.transitions[edge.event] ? (
          <EdgeInspector
            pipeline={draft}
            source={edge.source}
            event={edge.event}
            onChange={setDraft}
            onSelect={onSelect}
          />
        ) : (
          <PipelineInspector pipeline={draft} onChange={setDraft} sections={['start']} />
        )}
        <section className="issues">
          <h2 className="panel-heading">Checks on this screen</h2>
          <IssueStrip issues={screenIssues} />
        </section>
      </>
    ) : (
      <>
        <div className="wizard-summary">
          <div className="wizard-stat">
            <strong className="mono">{draft.id}</strong>
            <span>pipeline id</span>
          </div>
          <div className="wizard-stat">
            <strong>{names.length}</strong>
            <span>steps</span>
          </div>
          <div className="wizard-stat">
            <strong>{edgeCount(draft)}</strong>
            <span>edges</span>
          </div>
          <div className="wizard-stat">
            <strong>{orphanSteps(draft).length}</strong>
            <span>steps nothing reaches</span>
          </div>
          <div className="wizard-stat">
            <strong style={{ color: errorCount > 0 ? 'var(--error)' : 'var(--ok)' }}>
              {errorCount}
            </strong>
            <span>errors</span>
          </div>
        </div>
        <section className="issues">
          <h2 className="panel-heading">
            All checks
            <em className="field-hint">click one to go to the screen that fixes it</em>
          </h2>
          <IssueStrip issues={issues} onSelect={jumpTo} />
        </section>
      </>
    );

  const list: ReactNode | null =
    screen === 'steps' ? stepList : screen === 'wiring' ? eventList : null;

  return (
    <div className="wizard-backdrop">
      <div className="wizard" role="dialog" aria-label="pipeline wizard">
        <header className="wizard-head">
          <span className="wizard-title">
            {mode === 'new' ? 'New pipeline' : `Add a step to ${current.id}`}
          </span>
          <nav className="wizard-steps">
            {WIZARD_SCREENS.map((candidate: WizardScreen, i: number) => (
              <button
                type="button"
                key={candidate}
                className={candidate === screen ? 'is-current' : i < index ? 'is-done' : undefined}
                onClick={(): void => setScreen(candidate)}
              >
                {i + 1}. {SCREEN_TITLES[candidate]}
              </button>
            ))}
          </nav>
        </header>
        <p className="wizard-guide">{SCREEN_GUIDES[screen]}</p>

        <div className={`wizard-body${list ? '' : ' is-single'}`}>
          {list}
          <div className="wizard-pane">{pane}</div>
        </div>

        <footer className="wizard-foot">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <span className="spacer" />
          <span className={errorCount > 0 ? 'badge badge-error' : 'badge badge-ok'}>
            {errorCount} error{errorCount === 1 ? '' : 's'}
          </span>
          <span className="badge badge-ok">
            {issues.length - errorCount} warning{issues.length - errorCount === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            disabled={index === 0}
            onClick={(): void => setScreen(WIZARD_SCREENS[index - 1])}
          >
            Back
          </button>
          {screen === 'review' ? (
            <button
              type="button"
              className="primary-button"
              onClick={(): void => onFinish(draft, mode)}
              title={errorCount > 0 ? 'the editor will keep showing these errors' : undefined}
            >
              {errorCount > 0 ? 'Finish anyway' : 'Finish'}
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={(): void => setScreen(WIZARD_SCREENS[index + 1])}
            >
              Next
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};
