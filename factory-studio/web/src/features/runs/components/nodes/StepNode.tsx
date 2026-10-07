import { memo, type CSSProperties, type ReactNode } from 'react';
import type { NodeProps } from '@xyflow/react';
import { STATUS_META, type StepNodeData, type StepNodeType } from '../../lib/graph';
import { useNow } from '../../../../shared/lib/polling';
import { formatAttempts, formatDurationMs, formatUSD } from '../../lib/format';
import { DocGroup, StepCard } from '../../../../shared/graph';

/** Footer cells: left (result / running / skipped word), right (attempts). */
interface Footer {
  left: string;
  leftTone: 'result' | 'running' | 'skipped' | 'none';
  right: string;
}

/** "running" + "attempt 2 of 20" does not fit 128 px at 12 px; drop the word, keep the numbers. */
const FOOT_CHARS = 20;

export const footerFor = (data: StepNodeData): Footer => {
  if (!data.hasState || data.status === 'none') return { left: '', leftTone: 'none', right: '' };
  if (data.status === 'SKIPPED') return { left: 'skipped', leftTone: 'skipped', right: '' };
  if (data.status === 'waiting') return { left: '', leftTone: 'none', right: '' };
  if (data.status === 'RUNNING' || data.status === 'RETRYING') {
    const full: string = data.human ? '' : formatAttempts(data.attempts, data.max, true);
    // A cost in the middle cell eats into the same budget.
    const costChars: number = data.costUSD !== null ? formatUSD(data.costUSD).length + 1 : 0;
    const right: string =
      'running'.length + full.length + costChars > FOOT_CHARS
        ? full.replace(/^attempt /, '')
        : full;
    return { left: 'running', leftTone: 'running', right };
  }
  const attempts: string =
    data.human || (data.attempts === 0 && data.status === 'PENDING')
      ? ''
      : formatAttempts(data.attempts, data.max, false);
  const left: string = data.result ?? '';
  // With a cost in the middle cell, "APPROVE  $2.90  3 of 3" overflows: keep the count only.
  const costChars: number = data.costUSD !== null ? formatUSD(data.costUSD).length + 1 : 0;
  const right: string =
    left.length + costChars + attempts.length > FOOT_CHARS
      ? attempts.replace(/ of \d+$/, '')
      : attempts;
  return { left, leftTone: 'result', right };
};

/**
 * Duration line of a detailed card: live elapsed while running, total working time once
 * done; a human gate says `waiting` while the person is asked and `waited …` after the
 * verdict. The line keeps its height when it has nothing to say, so the card arithmetic holds.
 */
interface DurationLine {
  text: string;
  /** Finished attempts behind the total — shown as `×n` when more than one. */
  count: number;
  live: boolean;
}

const durationText = (data: StepNodeData, now: number): DurationLine => {
  if (data.human) {
    if (data.status === 'waiting') return { text: 'waiting', count: 0, live: false };
    if (data.waitedMs !== null)
      return { text: `waited ${formatDurationMs(data.waitedMs)}`, count: 0, live: false };
    return { text: '', count: 0, live: false };
  }
  if ((data.status === 'RUNNING' || data.status === 'RETRYING') && data.startedAt) {
    return {
      text: `elapsed ${formatDurationMs(now - Date.parse(data.startedAt))}`,
      count: 0,
      live: true,
    };
  }
  if (data.status === 'COMPLETED' && data.workingMs !== null) {
    return { text: formatDurationMs(data.workingMs), count: data.attemptCount, live: false };
  }
  // Nothing to time yet (pending, skipped): an empty line, never a dash, at the same height.
  return { text: '', count: 0, live: false };
};

function StepNode({ data }: NodeProps<StepNodeType>) {
  const now: number = useNow(data.detailed && data.status === 'RUNNING' ? 1000 : null);
  const dotStyle: CSSProperties = { background: `var(${STATUS_META[data.status].token})` };
  const foot: Footer = footerFor(data);
  const footEmpty: boolean = foot.left === '' && foot.right === '' && data.costUSD === null;
  // A run without state has nothing to time: the definition view carries no duration line.
  const duration: DurationLine | null =
    data.detailed && data.hasState ? durationText(data, now) : null;
  const dot: ReactNode = (
    <span className="status-dot" style={dotStyle} aria-label={STATUS_META[data.status].label} />
  );

  return (
    <StepCard
      slug={data.slug}
      headEnd={dot}
      agent={data.agent}
      model={data.model}
      modelTitle={
        data.actualModel
          ? `${data.actualModel} — the model actually used (cost.json)`
          : data.human
            ? undefined
            : 'configured model (no cost.json yet)'
      }
      human={data.human}
      detailed={data.detailed}
      status={data.status}
    >
      {duration && (
        <div
          className={`step-duration${duration.live ? ' is-live' : ''}${duration.text === '' ? ' is-empty' : ''}`}
        >
          {duration.text}
          {duration.count > 1 && <span className="step-attempt-count"> ×{duration.count}</span>}
        </div>
      )}
      {data.detailed && (
        <div className="step-docs">
          <DocGroup
            label="input"
            docs={data.inputs}
            expected={data.inputsFromPipeline}
            scope="run"
            editable={data.human}
          />
          <DocGroup
            label="output"
            docs={data.outputs}
            expected={data.outputsFromPipeline}
            scope="run"
          />
          {data.knowledge.length > 0 && (
            <DocGroup label="knowledge" docs={data.knowledge} expected={false} scope="knowledge" />
          )}
        </div>
      )}
      <div className={`step-foot${footEmpty ? ' is-empty' : ''}`}>
        <span className={`step-result step-result--${foot.leftTone}`}>{foot.left}</span>
        {data.costUSD !== null && (
          <span className="step-cost" title="cost of this step's agent runs (cost.json)">
            {formatUSD(data.costUSD)}
          </span>
        )}
        <span className="step-attempts">{foot.right}</span>
      </div>
    </StepCard>
  );
}

export default memo(StepNode);
