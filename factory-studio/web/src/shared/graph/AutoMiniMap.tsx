import { useMemo, type CSSProperties } from 'react';
import {
  getViewportForBounds,
  MiniMap,
  useNodes,
  useReactFlow,
  useStore,
  type Node,
  type Viewport,
} from '@xyflow/react';
import { FIT, MIN_ZOOM } from './fit';

/** Small on purpose: it is a locator for a graph larger than the view, not a second drawing of it. */
const MINIMAP_SIZE: CSSProperties = { width: 132, height: 80 };

interface AutoMiniMapProps {
  nodeClassName: (node: Node) => string;
}

/** The minimap only earns its place when the graph is larger than the view. */
export function AutoMiniMap({ nodeClassName }: AutoMiniMapProps) {
  const zoom: number = useStore((s) => s.transform[2]);
  const width: number = useStore((s) => s.width);
  const height: number = useStore((s) => s.height);
  const nodes = useNodes();
  const { getNodesBounds } = useReactFlow();
  const fits: boolean = useMemo((): boolean => {
    if (nodes.length === 0 || width === 0 || height === 0) return true;
    const fitted: Viewport = getViewportForBounds(
      getNodesBounds(nodes),
      width,
      height,
      MIN_ZOOM,
      1,
      FIT.padding ?? 0,
    );
    return zoom <= fitted.zoom + 0.001;
  }, [nodes, width, height, zoom, getNodesBounds]);
  if (fits) return null;
  return (
    <MiniMap
      pannable
      zoomable
      nodeClassName={nodeClassName}
      nodeStrokeWidth={0}
      position="bottom-right"
      style={MINIMAP_SIZE}
    />
  );
}
