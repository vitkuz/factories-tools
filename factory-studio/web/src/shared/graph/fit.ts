import { useCallback, useEffect, type RefObject } from 'react';
import {
  getViewportForBounds,
  useReactFlow,
  type FitViewOptions,
  type Node,
  type Viewport,
} from '@xyflow/react';
import type { Box } from './graph.types';

export const FIT: FitViewOptions = { padding: { x: '32px', y: '40px' }, maxZoom: 1 };
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 1.5;
/** A fit below this zoom is a strip, not an overview: show the graph at READABLE_ZOOM around the step that matters instead. */
export const FIT_FLOOR = 0.3;
export const READABLE_ZOOM = 0.6;
/** Detailed cards carry 11 px mono; below 0.85 that is under 9 px on a phone. */
export const READABLE_ZOOM_DETAILED = 0.85;
export const PHONE_INSET = 24;

const FIT_PAD_X = 32;
const FIT_PAD_Y = 40;

/**
 * The readable viewport for a drawing too big to fit: `zoom` fixed, the focal box (the step
 * that needs attention) centred on each axis where the drawing overflows the view, the
 * drawing centred where it does not; without a focal box the drawing's left edge sits at the
 * inset and its rows are centred. Pure.
 */
export const readableViewport = (
  bounds: Box,
  focal: Box | null,
  width: number,
  height: number,
  zoom: number,
): Viewport => {
  const axis = (
    lo: number,
    size: number,
    focalLo: number | null,
    focalSize: number,
    view: number,
  ): number => {
    const extent: number = size * zoom;
    if (extent + 2 * PHONE_INSET <= view) return (view - extent) / 2 - lo * zoom;
    if (focalLo === null) return PHONE_INSET - lo * zoom;
    const centred: number = view / 2 - (focalLo + focalSize / 2) * zoom;
    const max: number = PHONE_INSET - lo * zoom;
    const min: number = view - PHONE_INSET - (lo + size) * zoom;
    return Math.min(max, Math.max(min, centred));
  };
  return {
    x: axis(bounds.x, bounds.width, focal ? focal.x : null, focal?.width ?? 0, width),
    y: axis(bounds.y, bounds.height, focal ? focal.y : null, focal?.height ?? 0, height),
    zoom,
  };
};

/**
 * Fit the drawing (cards and lanes); when that would make cards unreadable, show a readable
 * zoom around the focal step instead (and let it pan). Also refits when the wrapper changes
 * size (window resize, layout breakpoint, a side panel opening). Returns the fit, for the
 * screen to call when the graph itself changes.
 */
export const useFitGraph = (
  wrapRef: RefObject<HTMLDivElement | null>,
  detailed: boolean,
  bounds: Box,
  focusId: string | null,
): ((animate: boolean) => void) => {
  const { setViewport, getNodes, getNodesBounds } = useReactFlow();

  const fitGraph = useCallback(
    (animate: boolean): void => {
      const el: HTMLDivElement | null = wrapRef.current;
      const current: Node[] = getNodes();
      if (!el || current.length === 0) return;
      const { width, height } = el.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const box: Box = bounds.width > 0 ? bounds : getNodesBounds(current);
      const fitted: Viewport = getViewportForBounds(box, width, height, MIN_ZOOM, 1, {
        x: `${FIT_PAD_X}px`,
        y: `${FIT_PAD_Y}px`,
      });
      const duration: number = animate ? 200 : 0;
      if (fitted.zoom >= FIT_FLOOR) {
        void setViewport(fitted, { duration });
        return;
      }
      const zoom: number = detailed ? READABLE_ZOOM_DETAILED : READABLE_ZOOM;
      const focal: Node | undefined = focusId
        ? current.find((n: Node): boolean => n.id === focusId)
        : undefined;
      const focalBox: Box | null = focal
        ? {
            x: focal.position.x,
            y: focal.position.y,
            width: focal.measured?.width ?? focal.width ?? 0,
            height: focal.measured?.height ?? focal.height ?? 0,
          }
        : null;
      void setViewport(readableViewport(box, focalBox, width, height, zoom), { duration });
    },
    [setViewport, getNodes, getNodesBounds, wrapRef, detailed, bounds, focusId],
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
