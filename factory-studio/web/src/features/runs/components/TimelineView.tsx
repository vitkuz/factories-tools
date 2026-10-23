import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { STATUS_META, type GraphResult, type StepNodeData } from '../lib/graph';
import { attemptSpanMs, type Attempt } from '../lib/attempts';
import {
  formatDuration,
  formatDurationMs,
  formatOffset,
  formatSpan,
  formatTime,
  type FormattedSpan,
} from '../lib/format';
import type { Pipeline, PipelineStep, RunState } from '../lib/types';
import type { HookSegment, PlainTransition, RunRecord, TimelineRow } from '../runs.types';
import {
  expandDocs,
  type JumpKind,
  jumpKindOf,
  promptPreview,
  type PromptPreview,
  recordedOutputs,
  stepTimeLabel,
  timelineRows,
  transitionsOf,
} from '../runs.utils';
import { hookSegments } from '../hooks.utils';
import { END_ID, rankPipeline } from '../../../shared/graph';
import { displayDocPath } from '../../../shared/graph/text';
import { copyText } from '../../../shared/lib/clipboard';
import { DocLink, extLabel, type DocScope } from '../../../shared/document-viewer';

export interface TimelineViewProps {
  pipeline: Pipeline;
  run: RunRecord;
  /** The graph on the canvas: its step data (status, model, timings, docs) is reused as-is. */
  graph: GraphResult;
  /** The step selected on either tab: scrolled to and highlighted here. */
  selectedId: string | null;
  onSelectStep: (slug: string) => void;
  /** A step title was clicked: show that step on the Graph tab. */
  onShowInGraph: (slug: string) => void;
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

/** How a transition target is jumped to: what kind it is, and what a click does. */
interface JumpProps {
  kindOf: (name: string) => JumpKind;
  onJump: (name: string) => void;
}

const Target = ({ name, jump }: { name: string; jump: JumpProps }): ReactNode => {
  const kind: JumpKind = jump.kindOf(name);
  const cls: string = name === END_ID ? 'pv-end' : 'pv-target';
  if (kind === 'none') return <span className={cls}>{name === END_ID ? 'END' : name}</span>;
  return (
    <button
      type="button"
      className={`${cls} pv-target-link`}
      onClick={() => jump.onJump(name)}
      aria-label={kind === 'end' ? 'Go to END' : `Go to step ${name}`}
      title={kind === 'end' ? 'Jump to END' : 'Jump to this step'}
    >
      {kind === 'end' ? 'END' : name}
    </button>
  );
};

const Targets = ({ names, jump }: { names: string[]; jump: JumpProps }): ReactNode =>
  names.map((name: string, i: number) => (
    <span key={name}>
      {i > 0 && ', '}
      <Target name={name} jump={jump} />
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
const Route = ({ t, jump }: { t: PlainTransition; jump: JumpProps }): ReactNode => (
  <li className={`pv-route${t.taken > 0 ? ' is-taken' : ''}`}>
    <span className="pv-event">{t.event}</span>
    {' → '}
    <Targets names={t.targets} jump={jump} />
    <Tick times={t.taken} />
    {t.max !== null && (
      <span className="pv-max">
        {' · max '}
        {t.max}
        {t.onMax.length > 0 && (
          <>
            {', then → '}
            <Targets names={t.onMax} jump={jump} />
            <Tick times={t.onMaxTaken} />
          </>
        )}
      </span>
    )}
  </li>
);

/** The rail dot of a step: its status colour; hollow while it has not run. */
const dotStyle = (data: StepNodeData): CSSProperties => ({
  ['--dot' as string]: `var(${STATUS_META[data.status].token})`,
});

interface PassesProps {
  attempts: Attempt[];
  /** The run's start day: a pass on another day prints its date. */
  anchor: string | null;
  now: number;
}

/** A loop's passes, one line each: `pass 2 · 9:19 PM → 9:21 PM · 2 min · REVISE`. */
const Passes = ({ attempts, anchor, now }: PassesProps): ReactNode => (
  <ol className="tl-passes mono" aria-label="Passes">
    {attempts.map((a: Attempt) => {
      const span: number | null = attemptSpanMs(a, now);
      const { start, end }: FormattedSpan = formatSpan(a.startedAt, a.finishedAt, now, anchor);
      return (
        <li key={a.attempt} className={a.open ? 'is-open' : undefined}>
          <span className="tl-pass-n">pass {a.attempt}</span>
          <span className="pv-sep"> · </span>
          <span title={a.startedAt ?? undefined}>{start}</span>
          {' → '}
          <span title={a.finishedAt ?? undefined}>{a.open ? 'now' : end}</span>
          {span !== null && (
            <>
              <span className="pv-sep"> · </span>
              {a.kind === 'wait' ? 'waited ' : ''}
              {formatDurationMs(span)}
            </>
          )}
          {a.result !== null && (
            <>
              <span className="pv-sep"> · </span>
              <span className="tl-result">{a.result}</span>
            </>
          )}
        </li>
      );
    })}
  </ol>
);

interface PromptToggleProps {
  id: string;
  label: string;
  text: PromptPreview;
  /** The system prompt: a quieter row. */
  muted?: boolean;
}

/** A labelled prompt's first line that expands, in place, to the full text (raw, wrapped, copyable). */
const PromptToggle = ({ id, label, text, muted = false }: PromptToggleProps): ReactNode => {
  const [open, setOpen] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const copy = async (): Promise<void> => {
    setCopied(await copyText(text.full));
    window.setTimeout(() => setCopied(false), 1500);
  };
  const line: ReactNode = (
    <>
      <span className="pv-prompt-label">{label}</span>
      <span className="pv-prompt-line">{text.preview}</span>
    </>
  );
  return (
    <div className={`pv-prompt${muted ? ' is-muted' : ''}${open ? ' is-open' : ''}`}>
      {text.expandable ? (
        <button
          type="button"
          className="pv-prompt-toggle"
          aria-expanded={open}
          aria-controls={`${id}-full`}
          title={
            open ? `Hide the full ${label.toLowerCase()}` : `Show the full ${label.toLowerCase()}`
          }
          onClick={() => setOpen((o: boolean): boolean => !o)}
        >
          <span className="pv-prompt-chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          {line}
        </button>
      ) : (
        <p className="pv-prompt-toggle is-static">{line}</p>
      )}
      {open && (
        <div className="pv-prompt-full" id={`${id}-full`}>
          <button type="button" className="pv-prompt-copy" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <pre className="pv-prompt-text">{text.full}</pre>
        </div>
      )}
    </div>
  );
};

interface StepRowProps {
  n: number;
  row: TimelineRow;
  step: PipelineStep;
  data: StepNodeData;
  run: RunRecord;
  recorded: string[];
  /** The step that ran just before this one, when the two overlapped. */
  alongside: string | null;
  now: number;
  selected: boolean;
  jump: JumpProps;
  onShowInGraph: (slug: string) => void;
}

const StepRow = ({
  n,
  row,
  step,
  data,
  run,
  recorded,
  alongside,
  now,
  selected,
  jump,
  onShowInGraph,
}: StepRowProps): ReactNode => {
  const slug: string = row.slug;
  const createdAt: string | null = run.state?.createdAt ?? null;
  const expand = expandDocs(recorded);
  const inputs: string[] = expand(data.inputs);
  const outputs: string[] = expand(data.outputs);
  const transitions: PlainTransition[] = transitionsOf(slug, step, run.state ?? null);
  const prompt: PromptPreview = promptPreview(data.prompt);
  const system: PromptPreview = promptPreview((step.system ?? []).join('\n'));
  const time: string = stepTimeLabel(row.passes)(data);
  const idle: boolean = !row.ran;
  const cls: string = [
    'tl-item',
    `is-${data.status}`,
    idle ? 'is-idle' : '',
    row.parallel ? 'is-parallel' : '',
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <li className={cls} id={`timeline-${slug}`} aria-current={selected ? 'step' : undefined}>
      <span
        className="tl-dot"
        style={dotStyle(data)}
        role="img"
        aria-label={`status: ${STATUS_META[data.status].label}`}
      />
      <div className="pv-body">
        <div className="pv-row">
          <span className="tl-n mono" aria-hidden="true">
            {n}
          </span>
          <button
            type="button"
            className="pv-name mono"
            onClick={() => onShowInGraph(slug)}
            title="Show this step in the graph"
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
          {row.passes > 1 && (
            <span
              className="tl-loop mono"
              title={`Entered ${row.passes} times: a loop sent the run back here`}
            >
              ↻ {row.passes} passes
            </span>
          )}
          {row.ran && data.result !== null && (
            <span className="tl-result mono" title="The event of its last pass">
              {data.result}
            </span>
          )}
          {time !== '' && <span className="pv-time mono">{time}</span>}
        </div>
        {(row.startedAt !== null || alongside !== null) && (
          <div className="tl-when mono">
            {row.startedAt !== null && (
              <span title={row.startedAt}>
                {row.passes > 1 && row.attempts.length < row.passes
                  ? 'last pass started '
                  : 'started '}
                {formatTime(row.startedAt, now, createdAt)}
                {createdAt !== null && (
                  <span className="muted"> · {formatOffset(createdAt, row.startedAt)}</span>
                )}
              </span>
            )}
            {alongside !== null && (
              <span className="tl-parallel" title="Started before the step above finished">
                ∥ alongside {alongside}
              </span>
            )}
          </div>
        )}
        {data.status === 'SKIPPED' && row.skipReason !== null && (
          <p className="tl-skip">{row.skipReason}</p>
        )}
        {!data.human && system.full !== '' && (
          <PromptToggle id={`${slug}-system`} label="System prompt" text={system} muted />
        )}
        {prompt.preview !== '' && (
          <PromptToggle id={`${slug}-prompt`} label="Prompt" text={prompt} />
        )}
        {row.attempts.length > 1 && <Passes attempts={row.attempts} anchor={createdAt} now={now} />}
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
              <Route key={t.event} t={t} jump={jump} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
};

/**
 * One hook command with every path token as ONE chip over the whole token (placeholder prefix
 * included, shown as written), resolved with the pipeline's constants and opened as a doc.
 */
const HookCommand = ({ command, pipeline }: { command: string; pipeline: Pipeline }): ReactNode => (
  <code className="pv-cmd mono">
    {hookSegments(
      pipeline.constants ?? {},
      pipeline.id,
    )(command).map((seg: HookSegment, i: number) =>
      seg.target === null ? (
        <span key={i}>{seg.text}</span>
      ) : (
        <DocLink
          key={i}
          scope={seg.target.scope}
          path={seg.target.path}
          className="pv-chip is-script"
        >
          <span className="pv-chip-ext">{extLabel(seg.text)}</span>
          <span className="pv-chip-text">{seg.text}</span>
        </DocLink>
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

/** The run's wall-clock span for the END row: `reached 9:42 PM · 35 min` once it completed. */
const endWord = (run: RunRecord, now: number): string => {
  const state: RunState | null | undefined = run.state;
  if (!state || state.status !== 'COMPLETED') return '';
  const took: string = formatDuration(state.createdAt, state.updatedAt);
  return `✓ reached ${formatTime(state.updatedAt, now, state.createdAt)}${took === '—' ? '' : ` · ${took}`}`;
};

/**
 * The Timeline tab: START, every step in the order the run reached it (a rail with a status
 * dot per step, when it started and how long it worked or waited, its passes when a loop sent
 * it back, the prompt's first sentence, its files as chips, where each event leads and which
 * way the run went), the steps that never ran in graph order, END, then the run's own files
 * and the pipeline's hooks. The step data is the canvas's, so the two tabs never disagree.
 */
export const TimelineView = ({
  pipeline,
  run,
  graph,
  selectedId,
  onSelectStep,
  onShowInGraph,
}: TimelineViewProps): ReactNode => {
  const scrollRef = useRef<HTMLElement | null>(null);
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
  const now: number = Date.now();
  const rows: TimelineRow[] = timelineRows(
    run.state ?? null,
    now,
  )(order.filter((slug: string): boolean => data.has(slug)));
  const hooks = pipeline.hooks;
  const before: string[] = hooks?.before ?? [];
  const after: string[] = hooks?.after ?? [];
  const files: RunFile[] = runFiles(run);
  const createdAt: string | null = run.state?.createdAt ?? null;
  const ended: string = endWord(run, now);

  // A transition target is jumped to like the START chip: a step is selected (the effect below
  // scrolls to it and highlights it), END has no selection so it is scrolled to directly.
  const jump: JumpProps = {
    kindOf: jumpKindOf(rows.map((r: TimelineRow): string => r.slug)),
    onJump: (name: string): void => {
      if (name !== END_ID) return onSelectStep(name);
      const el: Element | null = scrollRef.current?.querySelector('#timeline-END') ?? null;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
  };

  // The step selected on the graph (or in the inspector): brought into view and highlighted.
  useEffect(() => {
    if (selectedId === null) return;
    const el: HTMLElement | null =
      scrollRef.current?.querySelector(`#${CSS.escape(`timeline-${selectedId}`)}`) ?? null;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [selectedId]);

  return (
    <section className="timeline" aria-label="Run timeline" ref={scrollRef}>
      <header className="pv-head">
        <h2 className="pv-title">Timeline</h2>
        <span className="pv-meta mono">
          START → {rows.length} steps → END · {pipeline.id}
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

      <ol className="tl-list">
        <li className="tl-item is-terminal">
          <span className="tl-dot is-terminal" aria-hidden="true">
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
              {createdAt !== null && (
                <span className="pv-time mono" title={createdAt}>
                  {formatTime(createdAt, now, createdAt)}
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
                  title="Jump to this step"
                >
                  {slug}
                </button>
              ))}
            </div>
          </div>
        </li>

        {rows.map((row: TimelineRow, i: number) => (
          <StepRow
            key={row.slug}
            n={i + 1}
            row={row}
            step={pipeline.steps[row.slug]}
            data={data.get(row.slug) as StepNodeData}
            run={run}
            recorded={recorded}
            alongside={row.parallel ? (rows[i - 1]?.slug ?? null) : null}
            now={now}
            selected={selectedId === row.slug}
            jump={jump}
            onShowInGraph={onShowInGraph}
          />
        ))}

        <li className="tl-item is-terminal is-last" id="timeline-END">
          <span className="tl-dot is-terminal" aria-hidden="true">
            E
          </span>
          <div className="pv-body">
            <div className="pv-row">
              <span className="pv-name mono is-terminal">END</span>
              {ended !== '' && <span className="pv-tick mono">{ended}</span>}
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
                    <HookCommand key={c} command={c} pipeline={pipeline} />
                  ))}
                </dd>
              </>
            )}
            {after.length > 0 && (
              <>
                <dt>after</dt>
                <dd className="pv-cmds">
                  {after.map((c: string) => (
                    <HookCommand key={c} command={c} pipeline={pipeline} />
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
