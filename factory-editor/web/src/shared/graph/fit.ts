import { useCallback, useEffect, type RefObject } from 'react';
import {
  getViewportForBounds,
  useReactFlow,
  type FitViewOptions,
  type Node,
  type Viewport,
} from '@xyflow/react';

export const FIT: FitViewOptions = { padding: { x: '32px', y: '56px' }, maxZoom: 1 };
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 1.5;
/** A fit below this zoom is a thumbnail (phones): show the graph at READABLE_ZOOM and let it pan sideways instead. */
export const FIT_FLOOR = 0.5;
export const READABLE_ZOOM = 0.6;
/** Detailed cards carry 11 px mono; below 0.85 that is under 9 px on a phone. */
export const READABLE_ZOOM_DETAILED = 0.85;
export const PHONE_INSET = 24;

/**
 * Fit the whole graph; on a narrow screen where that would make cards unreadable, fit to
 * a readable zoom with Start at the left edge and the row centred instead. Also refits
 * when the wrapper changes size (window resize, layout breakpoint, a side panel opening).
 * Returns the fit, for the screen to call when the graph itself changes.
 */
export const useFitGraph = (
  wrapRef: RefObject<HTMLDivElement | null>,
  detailed: boolean,
): ((animate: boolean) => void) => {
  const { fitView, setViewport, getNodes, getNodesBounds } = useReactFlow();

  const fitGraph = useCallback(
    (animate: boolean): void => {
      const el: HTMLDivElement | null = wrapRef.current;
      const current: Node[] = getNodes();
      if (!el || current.length === 0) return;
      const { width, height } = el.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const bounds = getNodesBounds(current);
      const fitted: Viewport = getViewportForBounds(
        bounds,
        width,
        height,
        MIN_ZOOM,
        1,
        FIT.padding ?? 0,
      );
      const duration: number = animate ? 200 : 0;
      if (fitted.zoom >= FIT_FLOOR) {
        void fitView({ ...FIT, duration });
        return;
      }
      const zoom: number = detailed ? READABLE_ZOOM_DETAILED : READABLE_ZOOM;
      void setViewport(
        {
          x: PHONE_INSET - bounds.x * zoom,
          y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
          zoom,
        },
        { duration },
      );
    },
    [fitView, setViewport, getNodes, getNodesBounds, wrapRef, detailed],
  );

  useEffect(() => {
    const el: HTMLDivElement | null = wrapRef.current;
    if (!el) return;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fitGraph(false), 100);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [fitGraph, wrapRef]);

  return fitGraph;
};
