import type { z } from 'zod';
import type {
  edgeKindSchema,
  edgeLaneSchema,
  graphEdgeSchema,
  graphModelSchema,
  graphNodeSchema,
  nodeKindSchema,
} from './graph.schema.js';

export type NodeKind = z.infer<typeof nodeKindSchema>;
export type EdgeKind = z.infer<typeof edgeKindSchema>;
export type EdgeLane = z.infer<typeof edgeLaneSchema>;
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type GraphModel = z.infer<typeof graphModelSchema>;
