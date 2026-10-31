import type { CSSProperties, ReactNode } from 'react';
import { useSystemMemory } from '../hooks/use-system-memory';
import type { MemoryTone, SystemMemory } from '../system.types';
import { describeMemory, memoryTone } from '../system.utils';

/**
 * "MEM 63%" and a tiny bar at the far right of the top bar, on every screen: how full the
 * machine's memory is, so you know how many more factories it can take. Amber from 75 %,
 * red from 90 %. No answer: "MEM —", quietly.
 */
export const MemoryMeter = (): ReactNode => {
  const memory: SystemMemory | null = useSystemMemory();
  if (memory === null) {
    return (
      <div className="memory-meter memory-meter--unknown" title="Memory: no reading">
        <span className="memory-meter-label">MEM</span>
        <span className="memory-meter-value">—</span>
      </div>
    );
  }
  const tone: MemoryTone = memoryTone(memory.usedPercent);
  const fill: CSSProperties = { width: `${memory.usedPercent}%` };
  return (
    <div
      className={`memory-meter memory-meter--${tone}`}
      title={describeMemory(memory)}
      role="meter"
      aria-label="Memory used"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={memory.usedPercent}
    >
      <span className="memory-meter-label">MEM</span>
      <span className="memory-meter-value">{memory.usedPercent}%</span>
      <span className="memory-meter-bar" aria-hidden="true">
        <span className="memory-meter-fill" style={fill} />
      </span>
    </div>
  );
};
