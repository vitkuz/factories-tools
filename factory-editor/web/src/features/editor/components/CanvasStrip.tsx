import type { ReactNode } from 'react';

interface CanvasStripProps {
  detailed: boolean;
  onToggle: () => void;
}

/**
 * Bottom-left canvas strip: the Details toggle. The same control the state dashboard puts
 * in the same corner, down to the `d` shortcut — pressed, a card grows its prompt and the
 * input, output and knowledge files it names.
 */
export const CanvasStrip = ({ detailed, onToggle }: CanvasStripProps): ReactNode => (
  <div className="canvas-strip">
    <button
      type="button"
      className="details-toggle"
      aria-pressed={detailed}
      onClick={onToggle}
      title={
        detailed ? 'Show compact cards (d)' : 'Show the prompt and the documents on every card (d)'
      }
    >
      Details
    </button>
  </div>
);
