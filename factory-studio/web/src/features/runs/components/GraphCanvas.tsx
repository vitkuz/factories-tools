import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useUpdateNodeInternals,
  type Node,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import {
  statusesPresent,
  type GraphEdge,
  type GraphNode,
  type GraphResult,
  type StepNodeData,
  type ViewMode,
} from '../lib/graph';
import {
  applyFocus,
  AutoMiniMap,
  EndNode,
  FlowEdge,
  FIT,
  MAX_ZOOM,
  MIN_ZOOM,
  StartNode,
  useFitGraph,
} from '../../../shared/graph';
import { isTypingTarget } from '../../../shared/lib/keys';
import Legend from './Legend';
import StepNode from './nodes/StepNode';

const nodeTypes = { step: StepNode, start: StartNode, end: EndNode };
const edgeTypes = { flow: FlowEdge };

/**
 * Replace the controlled node array with a freshly built graph while keeping what
 * React Flow wrote back onto the previous objects: measured dimensions and selection.
 */
const adoptNodes = (prev: GraphNode[], next: GraphNode[]): GraphNode[] => {
  const byId: Map<string, GraphNode> = new Map(prev.map((n) => [n.id, n]));
  return next.map((n: GraphNode): GraphNode => {
    const old: GraphNode | undefined = byId.get(n.id);
    return old ? ({ ...n, measured: old.measured, selected: old.selected } as GraphNode) : n;
  });
};

/** New node objects (fresh measurement) that keep only the selection. */
const keepSelection = (prev: GraphNode[], next: GraphNode[]): GraphNode[] => {
  const selected: string | undefined = prev.find((n) => n.selected)?.id;
  return next.map((n: GraphNode): GraphNode =>
    n.id === selected ? ({ ...n, selected: true } as GraphNode) : n,
  );
};

const minimapClass = (n: Node): string =>
  n.type === 'step' ? `mm mm-${(n.data as StepNodeData).status}` : 'mm mm-terminal';

export interface CanvasProps {
  graph: GraphResult;
  /** Changes whenever a different run is shown — selection is cleared and the view refits. */
  runKey: string;
  view: ViewMode;
  onToggleView: () => void;
  /** Every untaken loop, escape and jump drawn in full, instead of quiet. */
  allRoutes: boolean;
  onToggleAllRoutes: () => void;
  stateless: boolean;
  /** The selected card: what the inspector shows, and the pinned focus of the canvas. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  wrapRef: RefObject<HTMLDivElement | null>;
}

/**
 * The React Flow canvas with controlled nodes/edges (read-only pipeline graph). Hovering a
 * card focuses it (its neighbours stay, the rest steps back); clicking a card selects it,
 * which pins that focus until the same card is clicked again, the empty canvas is clicked
 * or Escape is pressed.
 */
export default function GraphCanvas({
  graph,
  runKey,
  view,
  onToggleView,
  allRoutes,
  onToggleAllRoutes,
  stateless,
  selectedId,
  onSelect,
  wrapRef,
}: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNode>(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<GraphEdge>(graph.edges);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoverClearTimer = useRef<number | undefined>(undefined);
  const lastRunKey = useRef<string>(runKey);
  const lastView = useRef<ViewMode>(view);
  const pendingFit = useRef<boolean>(false);
  const pendingInternals = useRef<boolean>(false);
  const updateNodeInternals = useUpdateNodeInternals();
  const initialized: boolean = useNodesInitialized();
  const fitGraph = useFitGraph(wrapRef, view === 'detailed');

  // Sync the controlled arrays whenever the base graph is rebuilt: a run switch (fresh
  // nodes, fresh selection), a card-mode switch (fresh nodes, selection kept, handles
  // re-measured) or a live refresh of this run (nodes adopted, viewport untouched).
  useEffect(() => {
    const switched: boolean = lastRunKey.current !== runKey;
    const remoded: boolean = lastView.current !== view;
    lastRunKey.current = runKey;
    lastView.current = view;
    if (switched) {
      const active: Element | null = document.activeElement;
      if (active instanceof HTMLElement && wrapRef.current?.contains(active)) active.blur();
      setHoveredId(null);
    }
    if (switched || remoded) pendingFit.current = true;
    if (remoded) pendingInternals.current = true;
    setNodes((prev) =>
      switched
        ? graph.nodes
        : remoded
          ? keepSelection(prev, graph.nodes)
          : adoptNodes(prev, graph.nodes),
    );
    setEdges(graph.edges);
  }, [graph, runKey, view, setNodes, setEdges, wrapRef]);

  // Fit only after the new nodes are committed to the store (this effect is keyed on the
  // committed `nodes`, and React Flow's own store update runs before it) — never on a live refresh.
  useEffect(() => {
    if (pendingInternals.current) {
      pendingInternals.current = false;
      updateNodeInternals(nodes.map((n) => n.id));
    }
    if (!pendingFit.current || !initialized) return;
    pendingFit.current = false;
    fitGraph(true);
  }, [nodes, initialized, fitGraph, updateNodeInternals]);

  // What React Flow last reported as selected. A `selectedId` that differs from it came
  // from outside the canvas (a log chip, a run switch) and is written into the nodes;
  // one that matches is React Flow's own click/keyboard selection and is left alone.
  // A canvas mounted with a selection (the Timeline tab sent a step here) applies it only once
  // React Flow has measured the cards: writing it earlier loops React Flow's own store updates.
  const reported = useRef<string | null>(null);
  const initializedRef = useRef<boolean>(initialized);
  initializedRef.current = initialized;
  useEffect(() => {
    if (!initialized || reported.current === selectedId) return;
    reported.current = selectedId;
    setNodes((prev) =>
      prev.map((n) =>
        n.selected === (n.id === selectedId)
          ? n
          : ({ ...n, selected: n.id === selectedId } as GraphNode),
      ),
    );
  }, [selectedId, setNodes, initialized]);

  const onSelectionChange = useCallback(
    ({ nodes: selected }: OnSelectionChangeParams): void => {
      const id: string | null = selected[0]?.id ?? null;
      // Before the cards are measured React Flow reports its empty start, not a click.
      if (!initializedRef.current) return;
      reported.current = id;
      onSelect(id);
    },
    [onSelect],
  );

  // Clicking the selected card again unpins it. React Flow itself leaves a click on a selected
  // node alone (without multi-select), so this is the only place that turns it into a deselect.
  const onNodeClick = useCallback(
    (_e: unknown, node: Node): void => {
      if (node.id === selectedId) onSelect(null);
    },
    [selectedId, onSelect],
  );

  // Escape clears the pin — unless the person is typing, or a document modal is up.
  useEffect(() => {
    if (selectedId === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || isTypingTarget(e.target)) return;
      onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, onSelect]);

  // The focus (hover, else the pinned selection) and the quiet routes are a thin overlay over
  // the controlled arrays so untouched nodes and edges keep their object identity (memoised
  // node components skip re-rendering).
  const viewGraph = useMemo(
    (): { nodes: GraphNode[]; edges: GraphEdge[] } =>
      applyFocus(nodes, edges, { hoveredId, pinnedId: initialized ? selectedId : null }, allRoutes),
    [nodes, edges, hoveredId, selectedId, allRoutes, initialized],
  );

  const enterNode = (id: string): void => {
    window.clearTimeout(hoverClearTimer.current);
    setHoveredId(id);
  };
  const scheduleHoverClear = (): void => {
    window.clearTimeout(hoverClearTimer.current);
    hoverClearTimer.current = window.setTimeout(() => setHoveredId(null), 140);
  };
  useEffect(() => () => window.clearTimeout(hoverClearTimer.current), []);

  return (
    <ReactFlow
      nodes={viewGraph.nodes}
      edges={viewGraph.edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onSelectionChange={onSelectionChange}
      onNodeClick={onNodeClick}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeMouseEnter={(_e, node) => enterNode(node.id)}
      onNodeMouseLeave={scheduleHoverClear}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      selectNodesOnDrag={false}
      autoPanOnNodeFocus={false}
      deleteKeyCode={null}
      fitView
      fitViewOptions={FIT}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
      <Controls showInteractive={false} position="top-right" orientation="horizontal" />
      <AutoMiniMap nodeClassName={minimapClass} />
      {stateless && (
        <Panel position="top-left" className="canvas-note">
          No state.json yet. This is the pipeline definition.
        </Panel>
      )}
      <Panel position="bottom-left">
        <Legend
          statuses={statusesPresent(graph.nodes)}
          view={view}
          onToggleView={onToggleView}
          allRoutes={allRoutes}
          onToggleAllRoutes={onToggleAllRoutes}
        />
      </Panel>
    </ReactFlow>
  );
}
