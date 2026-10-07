/**
 * The two `@xyflow/react` types the Studio's graph module imports, reduced to the fields the
 * pure layout code reads and writes. Only a type import in the Studio too — no React here.
 */

export interface XYPosition {
  x: number;
  y: number;
}

export interface Node<D extends Record<string, unknown>, T extends string> {
  id: string;
  type: T;
  position: XYPosition;
  width?: number;
  height?: number;
  data: D;
}

export interface Edge<D extends Record<string, unknown>, T extends string> {
  id: string;
  source: string;
  target: string;
  type?: T;
  sourceHandle?: string;
  targetHandle?: string;
  data?: D;
  className?: string;
  focusable?: boolean;
}
