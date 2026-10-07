import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { STATUS_META, type GraphResult, type StepNodeData } from '../lib/graph';
import { formatDurationMs } from '../lib/format';
import type { Pipeline, PipelineStep } from '../lib/types';
import type { HookSegment, PlainTransition, RunRecord } from '../runs.types';
import {
  expandDocs,
  firstSentence,
  hookSegments,
  recordedOutputs,
  transitionsOf,
} from '../runs.utils';
import { END_ID, rankPipeline } from '../../../shared/graph';
import { displayDocPath } from '../../../shared/graph/text';
import { DocLink, extLabel, type DocRef, type DocScope } from '../../../shared/document-viewer';

export interface PlainViewProps {
  pipeline: Pipeline;
  run: RunRecord;
  /** The graph on the canvas: its step data (status, model, timings, docs) is reused as-is. */
  graph: GraphResult;
  selectedId: string | null;
  onSelectStep: (slug: string) => void;
  /** Opens a document the chips cannot: a hook script, or a prompt held inline. */
  onOpenRef: (ref: DocRef) => void;
}

type FactKind = 'input' | 'output' | 'knowledge';

interface FactProps {
  kind: FactKind;
  docs: string[];
  scope: DocScope;
  /** The list comes from the definition, not from what the run wrote: drawn muted. */
  expected: boolean;
  editable?: boolean;
}

const LABEL: Record<FactKind, string> = {
  input: 'Input',
  output: 'Output',
  knowledge: 'Knowledge',
};

/** A file as a chip: its type in a badge, then the path (knowledge without its `{{…}}` template). */
const Chip = ({ path, extra }: { path: string; extra: string }): ReactNode => {
  const display: string = displayDocPath(path);
  return (
    <>
      <span className={`pv-chip-ext${extra}`}>{extLabel(display)}</span>
      <span className="pv-chip-text">{display}</span>
    </>
  );
};

/** One `Input` / `Output` / `Knowledge` row: the label, then a chip per file that opens it. */
const Fact = ({ kind, docs, scope, expected, editable = false }: FactProps): ReactNode => {
  if (docs.length === 0) return null;
  return (
    <>
      <dt>{LABEL[kind]}</dt>
      <dd>
        {docs.map((path: string) => (
          <DocLink
            key={path}
            scope={scope}
            path={path}
            editable={editable}
            className={`pv-chip is-${kind}${expected ? ' is-expected' : ''}`}
          >
            <Chip path={path} extra="" />
          </DocLink>
        ))}
      </dd>
    </>
  );
};

const Target = ({ name }: { name: string }): ReactNode =>
  name === END_ID ? <span className="pv-end">END</span> : <span className="pv-target">{name}</span>;

const Targets = ({ names }: { names: string[] }): ReactNode =>
  names.map((name: string, i: number) => (
    <span key={name}>
      {i > 0 && ', '}
      <Target name={name} />
    </span>
  ));

const Tick = ({ times }: { times: number }): ReactNode =>
  times > 0 ? (
    <span className="pv-tick" title={`taken ${times} time${times === 1 ? '' : 's'}`}>
      {' '}
      ✓{times > 1 ? `×${times}` : ''}
    </span>
  ) : null;

/** `DONE → next ✓ · max 3, then → END`. */
const Route = ({ t }: { t: PlainTransition }): ReactNode => (
  <li className={`pv-route${t.taken > 0 ? ' is-taken' : ''}`}>
    <span className="pv-event">{t.event}</span>
    {' → '}
    <Targets names={t.targets} />
    <Tick times={t.taken} />
    {t.max !== null && (
      <span className="pv-max">
        {' · max '}
        {t.max}
        {t.onMax.length > 0 && (
          <>
            {', then → '}
            <Targets names={t.onMax} />
            <Tick times={t.onMaxTaken} />
          </>
        )}
      </span>
    )}
  </li>
);

/** The time cell at the right of a step's head line. */
const timeWord = (data: StepNodeData): string => {
  if (data.status === 'SKIPPED') return 'skipped';
  if (data.status === 'waiting') return 'waiting for you';
  if (data.status === 'none' || data.status === 'PENDING') return '';
  if (data.human) return data.waitedMs === null ? '' : `waited ${formatDurationMs(data.waitedMs)}`;
  if (data.workingMs === null) return data.status === 'RUNNING' ? 'running' : '';
  const total: string = formatDurationMs(data.workingMs);
  return data.attemptCount > 1 ? `${total} ×${data.attemptCount}` : total;
};

interface StepRowProps {
  n: number;
  slug: string;
  step: PipelineStep;
  data: StepNodeData;
  run: RunRecord;
  recorded: string[];
  selected: boolean;
  onSelect: (slug: string) => void;
  onOpenRef: (ref: DocRef) => void;
}

const StepRow = ({
  n,
  slug,
  step,
  data,
  run,
  recorded,
  selected,
  onSelect,
  onOpenRef,
}: StepRowProps): ReactNode => {
  const expand = expandDocs(recorded);
  const inputs: string[] = expand(data.inputs);
  const outputs: string[] = expand(data.outputs);
  const transitions: PlainTransition[] = transitionsOf(slug, step, run.state ?? null);
  const summary: string = firstSentence(data.prompt);
  const time: string = timeWord(data);
  const dot: CSSProperties = { background: `var(${STATUS_META[data.status].token})` };
  return (
    <li className={`pv-step${selected ? ' is-selected' : ''}`} id={`plain-${slug}`}>
      <span className="pv-num mono" aria-hidden="true">
        {n}
      </span>
      <div className="pv-body">
        <div className="pv-row">
          <span
            className="status-dot"
            style={dot}
            role="img"
            aria-label={`status: ${STATUS_META[data.status].label}`}
          />
          <button
            type="button"
            className="pv-name mono"
            onClick={() => onSelect(slug)}
            aria-pressed={selected}
            title="Select this step in the graph"
          >
            {slug}
          </button>
          {data.human ? (
            <span className="pv-badge mono">HUMAN</span>
          ) : (
            <span className="pv-agent mono">
              <span className="pv-agent-name">{data.agent}</span>
              <span className="pv-sep"> · </span>
              {data.model}
            </span>
          )}
          {time !== '' && <span className="pv-time mono">{time}</span>}
        </div>
        {summary !== '' && <p className="pv-summary">{summary}</p>}
        {(inputs.length > 0 || outputs.length > 0 || data.knowledge.length > 0) && (
          <dl className="pv-facts">
            <Fact
              kind="input"
              docs={inputs}
              scope="run"
              expected={data.inputsFromPipeline && inputs.some((p) => !recorded.includes(p))}
              editable={data.human}
            />
            <Fact kind="output" docs={outputs} scope="run" expected={data.outputsFromPipeline} />
            <Fact kind="knowledge" docs={data.knowledge} scope="knowledge" expected={false} />
          </dl>
        )}
        {transitions.length > 0 && (
          <ul className="pv-transitions mono" aria-label="Transitions">
            {transitions.map((t: PlainTransition) => (
              <Route key={t.event} t={t} />
            ))}
          </ul>
        )}
        <div className="pv-prompts">
          <button
            type="button"
            className="pv-link"
            onClick={() =>
              onOpenRef({ scope: 'inline', path: `${slug}/prompt`, text: data.prompt })
            }
          >
            Prompt
          </button>
          {step.system !== undefined && step.system.length > 0 && (
            <button
              type="button"
              className="pv-link"
              onClick={() =>
                onOpenRef({
                  scope: 'inline',
                  path: `${slug}/system prompt`,
                  text: (step.system ?? []).join('\n'),
                })
              }
            >
              System prompt
            </button>
          )}
        </div>
      </div>
    </li>
  );
};

/** One hook command with its script paths as chips that open the script. */
const HookCommand = ({
  command,
  onOpenRef,
}: {
  command: string;
  onOpenRef: (ref: DocRef) => void;
}): ReactNode => (
  <code className="pv-cmd mono">
    {hookSegments(command).map((seg: HookSegment, i: number) =>
      seg.script === null ? (
        <span key={i}>{seg.text}</span>
      ) : (
        <button
          key={i}
          type="button"
          className="pv-chip is-script"
          title={`Open scripts/${seg.script}`}
          onClick={() => onOpenRef({ scope: 'script', path: seg.script ?? '' })}
        >
          <Chip path={seg.text} extra="" />
        </button>
      ),
    )}
  </code>
);

interface RunFile {
  name: string;
  present: boolean;
}

const runFiles = (run: RunRecord): RunFile[] =>
  [
    { name: 'pipeline.json', present: run.pipeline !== undefined },
    { name: 'state.json', present: run.hasState },
    { name: 'cost.json', present: run.hasCost === true },
  ].filter((f: RunFile): boolean => f.present);

/**
 * The graph as a list, under the canvas: START, every step in the graph's own order (status
 * dot, agent and model, the prompt's first sentence, its files as chips, where each event
 * leads and which way the run went), END, then the run's own files and the pipeline's hooks.
 * The step data is the canvas's, so the two never disagree.
 */
export const PlainView = ({
  pipeline,
  run,
  graph,
  selectedId,
  onSelectStep,
  onOpenRef,
}: PlainViewProps): ReactNode => {
  const order: string[] = useMemo((): string[] => rankPipeline(pipeline).order, [pipeline]);
  const data: Map<string, StepNodeData> = useMemo(
    (): Map<string, StepNodeData> =>
      new Map(
        graph.nodes.flatMap((n): [string, StepNodeData][] =>
          n.type === 'step' ? [[n.id, n.data as StepNodeData]] : [],
        ),
      ),
    [graph],
  );
  const recorded: string[] = useMemo((): string[] => recordedOutputs(run), [run]);
  const steps: string[] = order.filter((slug: string): boolean => data.has(slug));
  const hooks = pipeline.hooks;
  const before: string[] = hooks?.before ?? [];
  const after: string[] = hooks?.after ?? [];
  const files: RunFile[] = runFiles(run);
  const finished: boolean = run.state?.status === 'COMPLETED';

  return (
    <section className="plain-view" aria-label="Pipeline, plain view">
      <header className="pv-head">
        <h2 className="pv-title">Pipeline</h2>
        <span className="pv-meta mono">
          START → {steps.length} steps → END · {pipeline.id}
        </span>
        {files.length > 0 && (
          <div className="pv-files" aria-label="Run files">
            {files.map((f: RunFile) => (
              <DocLink key={f.name} scope="run" path={f.name} className="pv-chip is-run">
                <Chip path={f.name} extra="" />
              </DocLink>
            ))}
          </div>
        )}
      </header>

      <ol className="pv-list">
        <li className="pv-step is-terminal">
          <span className="pv-num mono" aria-hidden="true">
            S
          </span>
          <div className="pv-body">
            <div className="pv-row">
              <span className="pv-name mono is-terminal">START</span>
              {pipeline.START.length > 1 && (
                <span className="pv-agent mono">
                  runs {pipeline.START.length} steps in parallel
                </span>
              )}
            </div>
            <div className="pv-targets">
              {pipeline.START.map((slug: string) => (
                <button
                  key={slug}
                  type="button"
                  className="pv-target-chip mono"
                  onClick={() => onSelectStep(slug)}
                  title="Select this step in the graph"
                >
                  {slug}
                </button>
              ))}
            </div>
          </div>
        </li>

        {steps.map((slug: string, i: number) => (
          <StepRow
            key={slug}
            n={i + 1}
            slug={slug}
            step={pipeline.steps[slug]}
            data={data.get(slug) as StepNodeData}
            run={run}
            recorded={recorded}
            selected={selectedId === slug}
            onSelect={onSelectStep}
            onOpenRef={onOpenRef}
          />
        ))}

        <li className="pv-step is-terminal">
          <span className="pv-num mono" aria-hidden="true">
            E
          </span>
          <div className="pv-body">
            <div className="pv-row">
              <span className="pv-name mono is-terminal">END</span>
              {finished && <span className="pv-tick mono">✓ reached</span>}
            </div>
          </div>
        </li>
      </ol>

      {(before.length > 0 || after.length > 0) && (
        <div className="pv-hooks">
          <h3 className="pv-subtitle">Hooks</h3>
          <dl className="pv-facts">
            {before.length > 0 && (
              <>
                <dt>before</dt>
                <dd className="pv-cmds">
                  {before.map((c: string) => (
                    <HookCommand key={c} command={c} onOpenRef={onOpenRef} />
                  ))}
                </dd>
              </>
            )}
            {after.length > 0 && (
              <>
                <dt>after</dt>
                <dd className="pv-cmds">
                  {after.map((c: string) => (
                    <HookCommand key={c} command={c} onOpenRef={onOpenRef} />
                  ))}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </section>
  );
};
