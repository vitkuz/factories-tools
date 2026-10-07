import {
  HANDLE,
  NODE_H,
  buildDefinitionGraph,
  type EdgeData,
  type GraphEdge as StudioEdge,
  type GraphNodeOf,
  type GraphPipeline,
  type StepCardData,
} from '../../../shared/studio-graph/index.js';
import {
  stepNodes,
  toGraphPipeline,
  type GraphEdge,
  type GraphModel,
  type GraphNode,
} from '../../graph/index.js';
import type { Anchor, Box, PlacedNode, RoutedEdge, Side } from './native.types.js';
import { handlePoint, lanePoints, rowLabel, rowPoints } from './native.utils.js';

export interface NativeLayout {
  nodes: PlacedNode[];
  edges: RoutedEdge[];
}

interface HandleSpec {
  side: Side;
  fraction: number;
}

/** The Studio's eight card handles: row edges leave right / enter left, loops at the bottom, escapes and jumps at the top. */
const HANDLES: Record<string, HandleSpec> = {
  [HANDLE.in]: { side: 'left', fraction: 0.5 },
  [HANDLE.out]: { side: 'right', fraction: 0.5 },
  [HANDLE.loopOut]: { side: 'bottom', fraction: 0.2 },
  [HANDLE.loopIn]: { side: 'bottom', fraction: 0.8 },
  [HANDLE.maxOut]: { side: 'top', fraction: 0.8 },
  [HANDLE.maxIn]: { side: 'top', fraction: 0.2 },
  [HANDLE.jumpOut]: { side: 'top', fraction: 0.5 },
  [HANDLE.jumpIn]: { side: 'top', fraction: 0.5 },
};

const anchorOf = (box: Box, handle: string | undefined, fallback: Side): Anchor => {
  const spec: HandleSpec = HANDLES[handle ?? ''] ?? { side: fallback, fraction: 0.5 };
  return { point: handlePoint(box, spec.side, spec.fraction), side: spec.side };
};

const toCardData =
  (model: GraphModel) =>
  (slug: string, stackIndex: number): StepCardData => {
    const node: GraphNode | undefined = model.nodes.find((n: GraphNode): boolean => n.id === slug);
    return {
      slug,
      agent: node?.agent ?? '',
      model: node?.model ?? null,
      human: node?.kind === 'human',
      ...(node?.max === null || node?.max === undefined ? {} : { max: node.max }),
      inputs: node?.inputs ?? [],
      outputs: node?.outputs ?? [],
      knowledge: node?.knowledge ?? [],
      detailed: false,
      stackIndex,
    };
  };

const route = (edge: GraphEdge, from: Anchor, to: Anchor, laneY: number | null): RoutedEdge => {
  if (laneY === null) {
    const points = rowPoints(from.point, to.point);
    return { edge, from, to, laneY, points, label: rowLabel(points) };
  }
  return {
    edge,
    from,
    to,
    laneY,
    points: lanePoints(from.point, to.point, to.side, laneY),
    label: { x: (from.point.x + to.point.x) / 2, y: laneY },
  };
};

/**
 * The Studio's definition layout, read for the model: one column per rank, stacked fan-out,
 * lanes above and below. Positions come from the port untouched; this only turns handles into
 * points and lanes into polylines. `--view` other than compact: TODO(M4) — detailed via
 * `stepNodeHeight`, minimal with slug-only cards.
 */
export const layoutNative = (model: GraphModel): NativeLayout => {
  const pipeline: GraphPipeline = toGraphPipeline(model);
  const { nodes, edges } = buildDefinitionGraph<StepCardData>(
    pipeline,
    toCardData(model),
    (): number => NODE_H,
  );
  const boxes: Map<string, Box> = new Map(
    nodes.map((n: GraphNodeOf<StepCardData>): [string, Box] => [
      n.id,
      { x: n.position.x, y: n.position.y, width: n.width ?? 0, height: n.height ?? NODE_H },
    ]),
  );
  const byId: Map<string, GraphNode> = new Map(
    model.nodes.map((n: GraphNode): [string, GraphNode] => [n.id, n]),
  );
  const placed: PlacedNode[] = nodes.flatMap((n: GraphNodeOf<StepCardData>): PlacedNode[] => {
    const node: GraphNode | undefined = byId.get(n.id);
    const box: Box | undefined = boxes.get(n.id);
    return node && box ? [{ node, box }] : [];
  });
  const geometry: Map<string, StudioEdge> = new Map(
    edges.map((e: StudioEdge): [string, StudioEdge] => [e.id, e]),
  );
  const routed: RoutedEdge[] = model.edges.flatMap((edge: GraphEdge): RoutedEdge[] => {
    const studio: StudioEdge | undefined = geometry.get(edge.id);
    const from: Box | undefined = boxes.get(edge.source);
    const to: Box | undefined = boxes.get(edge.target);
    if (!studio || !from || !to) return [];
    const data: EdgeData = studio.data as EdgeData;
    return [
      route(
        edge,
        anchorOf(from, studio.sourceHandle, 'right'),
        anchorOf(to, studio.targetHandle, 'left'),
        data.lane === 'row' ? null : (data.laneY ?? null),
      ),
    ];
  });
  // keep every model node even if the port had no place for it (it always has — defensive)
  const missing: PlacedNode[] = stepNodes(model)
    .filter((n: GraphNode): boolean => !boxes.has(n.id))
    .map((n: GraphNode): PlacedNode => ({ node: n, box: { x: 0, y: 0, width: 0, height: 0 } }));
  return { nodes: [...placed, ...missing], edges: routed };
};
