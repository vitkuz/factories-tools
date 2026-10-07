import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  activeStepsOf,
  isHumanStep,
  resolveAgent,
  resolveDocs,
  resolveKnowledge,
  resolveModel,
  STATUS_META,
  stepMax,
  stepStatusCounts,
  type StepDocs,
  type StepStatusKey,
} from '../lib/graph';
import type { RunsFeed } from '../hooks/use-runs-feed';
import { useNow } from '../../../shared/lib/polling';
import { skipReason } from '../lib/history';
import {
  attemptSpanMs,
  attemptsOf,
  parallelStepCount,
  runWorkingTimeMs,
  workingTimeMs,
  type Attempt,
} from '../lib/attempts';
import type { DocScope } from '../../../shared/document-viewer';
import type { RunRef } from '../../../shared/lib/route';
import {
  formatAttempts,
  formatClock,
  formatDurationMs,
  formatParam,
  formatShare,
  formatSpan,
  formatTime,
  formatUSD,
  looksLikePath,
  type FormattedParam,
  type FormattedSpan,
} from '../lib/format';
import {
  costCertainty,
  costShare,
  isCostStale,
  modelsByCost,
  orchestratorCost,
  stepCost,
  stepModel,
  stepNestedAgents,
  tokenSummary,
  unaccountedUSD,
} from '../lib/cost';
import { RUN_STATUS_META, runStatusLabel } from '../lib/run';
import { displayDocPath, pathSegments } from '../../../shared/graph/text';
import type {
  Cost,
  CostActor,
  CostBucket,
  CostStep,
  HistoryEntry,
  Pipeline,
  PipelineStep,
  RunRecord,
  StepState,
} from '../lib/types';
import StatusBadge, { Badge } from './StatusBadge';
import LogList from './LogList';
import { DocLink } from '../../../shared/document-viewer';
import { FeedFooter } from './LiveStatus';

interface Props {
  pipeline: Pipeline | null;
  run: RunRecord;
  /** The run the link asked for when it is not on disk — `run` is then the one shown instead. */
  missing?: RunRef | null;
  selectedId: string | null;
  feed: RunsFeed;
  onSelectStep: (slug: string) => void;
}

function Row({ k, v, title }: { k: string; v: ReactNode; title?: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd title={title}>{v}</dd>
    </>
  );
}

/** A clock time; the day is shown when it differs from the anchor's day (today, or the run's start). */
function Time({
  iso,
  now,
  anchor,
}: {
  iso: string | null | undefined;
  now: number;
  anchor?: string | null;
}) {
  return iso ? (
    <time dateTime={iso} title={iso}>
      {formatTime(iso, now, anchor ?? now)}
    </time>
  ) : (
    <span className="muted">—</span>
  );
}

/** A path with a break opportunity after every `/` (mono, wraps, never an ellipsis). */
function PathText({ path }: { path: string }) {
  return (
    <>
      {pathSegments(path).map((seg: string, i: number) => (
        <span key={i}>
          {seg}
          {seg.endsWith('/') && <wbr />}
        </span>
      ))}
    </>
  );
}

/** Lines a long parameter value shows before it is folded behind "more". */
const PARAM_CLAMP_LINES = 4;

/**
 * A plain-text parameter clamped to a few lines, with "more" / "less" when the text is
 * longer than that. The clamp is measured, not guessed: a value that fits shows no toggle.
 */
function ClampedText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [overflows, setOverflows] = useState<boolean>(false);
  // Re-measured whenever the text changes or the value is folded again (a run switch resets it).
  useEffect(() => setExpanded(false), [text]);
  useLayoutEffect(() => {
    const el: HTMLSpanElement | null = ref.current;
    if (!el) return;
    const measure = (): void => {
      if (!expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer: ResizeObserver = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);
  const clamped: boolean = !expanded;
  return (
    <>
      <span
        ref={ref}
        className={`param-text${clamped ? ' is-clamped' : ''}`}
        style={clamped ? { WebkitLineClamp: PARAM_CLAMP_LINES } : undefined}
      >
        {text}
      </span>
      {(overflows || expanded) && (
        <button
          type="button"
          className="param-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </>
  );
}

function Param({ value }: { value: unknown }) {
  const f: FormattedParam = formatParam(value);
  if (f.empty) return <span className="muted">{f.text}</span>;
  if (f.code) return <code className="mono">{f.text}</code>;
  if (looksLikePath(f.text)) {
    return (
      <code className="mono param-path">
        <PathText path={f.text} />
      </code>
    );
  }
  return <ClampedText text={f.text} />;
}

function DocList({
  label,
  docs,
  fromPipeline,
  scope,
  editable = false,
  emptyText = 'none',
}: {
  label: string;
  docs: string[];
  fromPipeline: boolean;
  scope: DocScope;
  /** These docs open with the modal's editor (a human step's inputs). */
  editable?: boolean;
  emptyText?: string;
}) {
  return (
    <>
      <dt>{fromPipeline && docs.length > 0 ? `${label}, expected` : label}</dt>
      <dd>
        {docs.length === 0 ? (
          <span className="muted">{emptyText}</span>
        ) : (
          <ul className={`doc-list${fromPipeline ? ' is-expected' : ''}`}>
            {docs.map((d: string) => (
              <li key={d}>
                <DocLink scope={scope} path={d} editable={editable} className="doc-chip">
                  <PathText path={displayDocPath(d)} />
                </DocLink>
              </li>
            ))}
          </ul>
        )}
      </dd>
    </>
  );
}

const runDuration = (run: RunRecord, now: number): string => {
  const state = run.state;
  if (!state?.createdAt) return '—';
  const start: number = Date.parse(state.createdAt);
  if (!Number.isFinite(start) || start > now) return '—';
  if (state.status === 'RUNNING' || state.status === 'PAUSED')
    return `${formatDurationMs(now - start)} so far`;
  return formatDurationMs(Date.parse(state.updatedAt) - start);
};

/**
 * Sum of every agent attempt of every step — what the agents actually spent, not the wall
 * clock. Time spent waiting for a person is not in it, so it only grows while an agent runs.
 */
const runWorking = (run: RunRecord, now: number): string => {
  const state = run.state;
  const ms: number | null = runWorkingTimeMs(state ?? null)(now);
  if (ms === null) return '—';
  return state?.status === 'RUNNING' ? `${formatDurationMs(ms)} so far` : formatDurationMs(ms);
};

/**
 * Why working time can be larger than the wall clock: steps that ran at the same time are
 * each counted in full. A quiet second line under the value, with the sentence in the
 * row's tooltip; nothing when every step ran on its own.
 */
interface ParallelNote {
  line: string;
  title: string;
}

const parallelNote = (run: RunRecord, now: number): ParallelNote | null => {
  const count: number = parallelStepCount(run.state ?? null)(now);
  if (count < 2) return null;
  return {
    line: `${count} steps ran in parallel`,
    title: `Working time adds up every agent's time. ${count} steps ran at the same time, so it can exceed the wall-clock duration.`,
  };
};

const humanLine = (run: RunRecord): ReactNode => {
  const pause = run.state?.pause;
  if (!pause) return null;
  if (pause.status === 'AWAITING_INPUT')
    return <span className="waiting-text">Waiting for you on {pause.step}</span>;
  return `${pause.status === 'REJECTED' ? 'Rejected' : 'Answered'} on ${pause.step}`;
};

const stepsLine = (counts: Array<[StepStatusKey, number]>): string =>
  counts
    .map(([status, n]: [StepStatusKey, number]): string => `${n} ${STATUS_META[status].count}`)
    .join(', ');

/** The duration cell: an agent's working time, or how long a person was (is being) waited for. */
const attemptDuration = (a: Attempt, now: number): string => {
  const ms: number | null = attemptSpanMs(a, now);
  if (ms === null) return '—';
  if (a.kind === 'wait') return a.open ? 'waiting' : `waited ${formatDurationMs(ms)}`;
  return a.open ? `running, ${formatDurationMs(ms)}` : formatDurationMs(ms);
};

const attemptWord = (a: Attempt): string =>
  a.result ?? (a.open ? (a.kind === 'wait' ? 'waiting' : 'running') : '—');

/** One row per attempt: number, result, duration, start → finish (the day printed once). */
function AttemptList({
  attempts,
  now,
  anchor,
}: {
  attempts: Attempt[];
  now: number;
  anchor: string | null;
}) {
  return (
    <ol className="attempt-list">
      {attempts.map((a: Attempt) => {
        const span: FormattedSpan = formatSpan(a.startedAt, a.finishedAt, now, anchor);
        return (
          <li key={a.attempt} className={`attempt-row${a.open ? ' is-open' : ''}`}>
            <span className="attempt-n">{a.attempt}</span>
            <span className="attempt-result mono">{attemptWord(a)}</span>
            <span className="attempt-duration">{attemptDuration(a, now)}</span>
            <span className="attempt-span">
              {a.startedAt ? (
                <time dateTime={a.startedAt} title={a.startedAt}>
                  {span.start}
                </time>
              ) : (
                <span className="muted">—</span>
              )}
              <span className="attempt-arrow" aria-hidden="true">
                →
              </span>
              {a.open ? (
                <span className="muted">now</span>
              ) : a.finishedAt ? (
                <time dateTime={a.finishedAt} title={a.finishedAt}>
                  {span.end}
                </time>
              ) : (
                <span className="muted">—</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One row per agent that worked on the step — its own agent first, then any it spawned.
 * The report records cost for the step as a whole, so the rows name the workers; the money
 * is on the step, above.
 */
function CostActorList({ step }: { step: CostStep }) {
  return (
    <ol className="cost-list">
      {step.actors.map((actor: CostActor, i: number) => (
        <li key={actor.id ?? i} className="cost-row" title={actor.sessionRunId}>
          <span className="cost-n">{i + 1}</span>
          <span className="cost-name" title={actor.name}>
            {actor.name ?? '—'}
            <span className="cost-tokens">{actor.kind ?? 'agent'}</span>
          </span>
          <span className="cost-usd">{actor.provider ?? ''}</span>
        </li>
      ))}
    </ol>
  );
}

/** Where the run's money went: by model, then the harness's own turns, then anything unplaced. */
function CostBreakdown({ cost }: { cost: Cost }) {
  const unaccounted: number = unaccountedUSD(cost);
  const row = (
    key: string,
    name: string,
    bucket: CostBucket,
    muted: boolean = false,
  ): ReactNode => (
    <li key={key} className={`cost-row${muted ? ' is-muted' : ''}`}>
      <span className="cost-name" title={name}>
        {name}
        <span className="cost-tokens">{tokenSummary(bucket.totals)}</span>
      </span>
      <span className="cost-usd">{formatUSD(bucket.estimatedListPriceUsd)}</span>
    </li>
  );
  return (
    <ol className="cost-list is-models">
      {modelsByCost(cost).map(([model, b]: [string, CostBucket]) => row(model, model, b))}
      {orchestratorCost(cost).estimatedListPriceUsd > 0 &&
        row('orchestrator', 'harness (main conversation)', orchestratorCost(cost), true)}
      <li className="cost-row is-total">
        <span className="cost-name">total</span>
        <span className="cost-usd">{formatUSD(cost.totals.estimatedListPriceUsd)}</span>
      </li>
      {unaccounted > 0 && (
        <li
          className="cost-row is-muted"
          title="The harness reported this much more for the driving session(s) than its transcripts show (interrupted or retried requests, side calls). It is not part of the total above."
        >
          <span className="cost-name">unattributed</span>
          <span className="cost-usd">{formatUSD(unaccounted)}</span>
        </li>
      )}
    </ol>
  );
}

export default function Inspector({
  pipeline,
  run,
  missing = null,
  selectedId,
  feed,
  onSelectStep,
}: Props) {
  const state = run.state;
  const now: number = useNow(1000);
  const active: boolean = state?.status === 'RUNNING' || state?.status === 'PAUSED';
  const [showLog, setShowLog] = useState<boolean>(active);
  // Inspector state must not leak between runs; a running run opens the log by default.
  // Only the run id is a dependency on purpose: a live status change must not collapse
  // a log the user is reading.
  useEffect(() => setShowLog(active), [run.runId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedStep: PipelineStep | undefined =
    selectedId && pipeline ? pipeline.steps[selectedId] : undefined;
  const selectedState: StepState | undefined = selectedId ? state?.steps?.[selectedId] : undefined;
  const docs: StepDocs | null =
    selectedId && pipeline ? resolveDocs(pipeline)(selectedId, selectedState) : null;
  const knowledge: string[] = selectedId && pipeline ? resolveKnowledge(pipeline)(selectedId) : [];
  const human: ReactNode = humanLine(run);
  const params: [string, unknown][] = Object.entries(state?.context.params ?? {});
  const logs: HistoryEntry[] = state?.history ?? [];
  const counts: Array<[StepStatusKey, number]> = stepStatusCounts(state ?? null);
  const parallel: ParallelNote | null = parallelNote(run, now);
  const selectedHuman: boolean = Boolean(
    selectedId && pipeline && isHumanStep(pipeline, selectedId, selectedState),
  );
  const selectedSkipped: boolean = selectedState?.status === 'SKIPPED';
  const selectedRunning: boolean =
    selectedState?.status === 'RUNNING' || selectedState?.status === 'RETRYING';
  const skipped: string | null =
    selectedSkipped && selectedId ? skipReason(state ?? null)(selectedId) : null;
  const configuredModel: string | null =
    selectedId && pipeline ? resolveModel(pipeline)(selectedId, selectedState) : null;
  const actualModel: string | null = selectedId ? stepModel(run.cost ?? null)(selectedId) : null;
  // The model the agent actually ran on wins over the configured one once cost.json knows it.
  const model: string | null = actualModel ?? configuredModel;
  const attempts: Attempt[] = selectedId
    ? attemptsOf(state ?? null)(selectedId, selectedHuman)
    : [];
  const firstStart: string | null = attempts.find((a) => a.startedAt)?.startedAt ?? null;
  const lastFinish: string | null =
    [...attempts].reverse().find((a) => a.finishedAt)?.finishedAt ?? null;
  const working: number | null = workingTimeMs(attempts, now);
  // A human gate: when the wait began (from the log when the state has no time), and how
  // long the last verdict took — listed, never counted as working time.
  const selectedWaiting: boolean = Boolean(
    selectedId && state?.status === 'PAUSED' && state.pause?.step === selectedId,
  );
  const openWait: Attempt | undefined = attempts.find((a) => a.open && a.kind === 'wait');
  const lastWait: Attempt | undefined = [...attempts]
    .reverse()
    .find((a) => a.kind === 'wait' && !a.open);
  const waited: number | null = lastWait ? attemptSpanMs(lastWait, now) : null;
  const looped: boolean = attempts.length > 1;
  const anchor: string | null = state?.createdAt ?? null;
  const cost: Cost | null = run.cost ?? null;
  const stale: boolean = cost ? isCostStale(cost, state ?? null) : false;
  const selectedCost: CostStep | null = selectedId ? stepCost(cost)(selectedId) : null;
  const selectedShare: number | null = selectedId ? costShare(cost)(selectedId) : null;
  const costTitle: string | null = cost
    ? stale
      ? `cost.json was generated ${formatClock(cost.generatedAt)}, before the run last moved — run factory-cost again`
      : `${cost.totals.requestCount} requests · ${costCertainty(cost) ?? 'unknown pricing'}` +
        (unaccountedUSD(cost) > 0
          ? ` · ${formatUSD(unaccountedUSD(cost))} unaccounted in session`
          : '')
    : null;

  return (
    <aside className="inspector">
      <div className="inspector-scroll">
        <section className="pane">
          {missing && (
            <p className="run-missing" role="status">
              No run <code>{missing.runId}</code> in <code>{missing.pipelineId}</code>. Showing the
              latest run instead.
            </p>
          )}
          <div className="run-head">
            <h2>{run.runId}</h2>
            {state && (
              <Badge
                label={runStatusLabel(state.status)}
                token={RUN_STATUS_META[state.status].token}
                ariaLabel={`run status: ${runStatusLabel(state.status)}`}
              />
            )}
            {cost && (
              <span
                className={`run-cost${stale ? ' is-stale' : ''}`}
                title={costTitle ?? undefined}
                aria-label={`run cost: ${formatUSD(cost.totals.estimatedListPriceUsd)}${stale ? ' (stale)' : ''}`}
              >
                {formatUSD(cost.totals.estimatedListPriceUsd)}
                {stale && <span className="run-cost-stale">stale</span>}
              </span>
            )}
          </div>

          <dl className="kv">
            <Row
              k="pipeline"
              v={
                pipeline ? (
                  pipeline.id
                ) : (
                  <>
                    {run.pipelineId} <span className="muted">(definition not found)</span>
                  </>
                )
              }
            />
            {state && (
              <>
                {counts.length > 0 && <Row k="steps" v={stepsLine(counts)} />}
                <Row
                  k="current step"
                  v={activeStepsOf(state).join(', ') || <span className="muted">—</span>}
                />
                <Row k="started" v={<Time iso={state.createdAt} now={now} />} />
                <Row k="duration" v={runDuration(run, now)} />
                <Row
                  k="working time"
                  title={parallel?.title}
                  v={
                    parallel ? (
                      <>
                        {runWorking(run, now)}
                        <span className="kv-note">{parallel.line}</span>
                      </>
                    ) : (
                      runWorking(run, now)
                    )
                  }
                />
                <Row k="updated" v={<Time iso={state.updatedAt} now={now} anchor={anchor} />} />
                {human && <Row k="human" v={human} />}
              </>
            )}
          </dl>
          {pipeline?.description && <p className="run-description">{pipeline.description}</p>}
          {!state && (
            <p className="hint">No state.json yet. Step details show the pipeline definition.</p>
          )}

          {params.length > 0 && (
            <>
              <h4 className="sub-title">Parameters</h4>
              <dl className="kv">
                {params.map(([k, v]: [string, unknown]) => (
                  <Row key={k} k={k} v={<Param value={v} />} />
                ))}
              </dl>
            </>
          )}
          {state && !selectedId && (
            <>
              <h4 className="sub-title">Cost</h4>
              {cost ? (
                <>
                  <CostBreakdown cost={cost} />
                  {cost.notes.map((w: string) => (
                    <p key={w} className="hint cost-warning">
                      {w}
                    </p>
                  ))}
                </>
              ) : run.hasCost ? (
                <p className="hint">cost.json is present but could not be read.</p>
              ) : (
                <p className="hint">
                  No cost.json for this run. Run <code>factory-cost</code> to generate it.
                </p>
              )}
            </>
          )}
        </section>

        <section className="pane">
          {selectedStep && pipeline && selectedId && docs ? (
            <>
              <h3 className="pane-title">{selectedId}</h3>
              <p className="step-sub">
                <span className="agent-name">
                  {resolveAgent(pipeline)(selectedId, selectedState)}
                </span>
                {selectedHuman ? ' agent, waits for a person' : ` agent, ${model ?? ''}`}
                {!selectedHuman &&
                  actualModel &&
                  configuredModel &&
                  actualModel !== configuredModel && (
                    <span className="muted"> (configured: {configuredModel})</span>
                  )}
              </p>
              <dl className="kv">
                <Row
                  k="status"
                  v={
                    selectedState ? (
                      <StatusBadge status={selectedState.status} />
                    ) : (
                      <StatusBadge status="none" />
                    )
                  }
                />
                {selectedSkipped && (
                  <Row
                    k="why"
                    v={skipped ? `Skipped, ${skipped}` : 'Skipped, no reason recorded'}
                  />
                )}
                {selectedState && !selectedSkipped && !selectedHuman && (
                  <Row
                    k="attempts"
                    v={formatAttempts(
                      selectedState.passes ?? selectedState.retryCount,
                      stepMax(selectedStep),
                      selectedRunning,
                    )}
                  />
                )}
                {selectedState?.event && !selectedSkipped && (
                  <Row
                    k={selectedHuman ? 'verdict' : 'result'}
                    v={<code className="mono">{selectedState.event}</code>}
                  />
                )}
                {selectedState && !selectedSkipped && selectedWaiting && (
                  <Row
                    k="waiting since"
                    v={<Time iso={openWait?.startedAt ?? selectedState.startedAt} now={now} />}
                  />
                )}
                {selectedState && !selectedSkipped && !selectedWaiting && (
                  <>
                    <Row
                      k="started"
                      v={
                        <Time
                          iso={firstStart ?? selectedState.startedAt}
                          now={now}
                          anchor={anchor}
                        />
                      }
                    />
                    {!selectedRunning && (
                      <Row
                        k="finished"
                        v={
                          <Time
                            iso={lastFinish ?? selectedState.completedAt}
                            now={now}
                            anchor={anchor}
                          />
                        }
                      />
                    )}
                    {selectedHuman ? (
                      <Row k="waited" v={waited === null ? '—' : formatDurationMs(waited)} />
                    ) : (
                      <Row
                        k={
                          selectedRunning && !looped
                            ? 'elapsed'
                            : looped
                              ? 'working time'
                              : 'duration'
                        }
                        v={
                          working === null
                            ? '—'
                            : looped
                              ? `${formatDurationMs(working)}, ${attempts.length} attempts`
                              : formatDurationMs(working)
                        }
                      />
                    )}
                  </>
                )}
                <DocList
                  label="input"
                  docs={docs.inputs}
                  fromPipeline={docs.inputsFromPipeline}
                  scope="run"
                  editable={selectedHuman}
                />
                <DocList
                  label="output"
                  docs={docs.outputs}
                  fromPipeline={docs.outputsFromPipeline}
                  scope="run"
                />
                <DocList
                  label="knowledge"
                  docs={knowledge}
                  fromPipeline={false}
                  scope="knowledge"
                  emptyText="—"
                />
              </dl>
              {looped && (
                <>
                  <h4 className="sub-title">Attempts</h4>
                  <AttemptList attempts={attempts} now={now} anchor={anchor} />
                </>
              )}
              {selectedCost && selectedCost.cost.requestCount > 0 && (
                <>
                  <h4 className="sub-title">Cost</h4>
                  <dl className="kv">
                    <Row
                      k="total"
                      v={
                        <>
                          {formatUSD(selectedCost.cost.estimatedListPriceUsd)}
                          {selectedShare !== null && (
                            <span className="kv-note">{formatShare(selectedShare)} of the run</span>
                          )}
                        </>
                      }
                    />
                    {tokenSummary(selectedCost.cost.totals) && (
                      <Row
                        k="tokens"
                        v={tokenSummary(selectedCost.cost.totals)}
                        title="fresh input · output · cache read"
                      />
                    )}
                    {stepNestedAgents(cost)(selectedId) > 0 && (
                      <Row k="sub-agents" v={String(stepNestedAgents(cost)(selectedId))} />
                    )}
                  </dl>
                  <CostActorList step={selectedCost} />
                </>
              )}
              <h4 className="sub-title">Prompt</h4>
              <p className="prompt">{selectedStep.prompt.join('\n')}</p>
            </>
          ) : (
            <>
              <h3 className="pane-title">Step</h3>
              <p className="hint">
                {pipeline
                  ? 'Click a step to inspect it.'
                  : 'No pipeline definition, so there are no steps to inspect.'}
              </p>
            </>
          )}
        </section>

        <section className="pane">
          <button
            type="button"
            className="log-toggle"
            onClick={() => setShowLog((s) => !s)}
            aria-expanded={showLog}
            aria-controls="run-log"
          >
            <span className={`chevron${showLog ? ' is-open' : ''}`} aria-hidden="true" />
            Log{logs.length ? ` (${logs.length})` : ''}
          </button>
          {showLog && (
            <LogList
              logs={logs}
              startedAt={state?.createdAt}
              stepSlugs={pipeline ? Object.keys(pipeline.steps) : []}
              onSelectStep={onSelectStep}
            />
          )}
        </section>
      </div>
      <FeedFooter feed={feed} />
    </aside>
  );
}
