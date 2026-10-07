import {
  getNodesBounds,
  getViewportForBounds,
  type Node,
  type Rect,
  type Viewport,
} from '@xyflow/react';
import { toPng } from 'html-to-image';

const PNG_MAX_WIDTH = 4096;
const PNG_MAX_HEIGHT = 4096;
const PNG_PADDING = 0.08;
const BACKGROUND = '#0e1116';

export const download = (filename: string, href: string): void => {
  const anchor: HTMLAnchorElement = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
};

export const downloadText = (filename: string, text: string, type: string): void => {
  const url: string = URL.createObjectURL(new Blob([text], { type }));
  download(filename, url);
  URL.revokeObjectURL(url);
};

/**
 * Render the whole graph — every node, not just the visible part — to a PNG.
 * The viewport element is drawn at a transform that frames the bounds of all
 * nodes, which is the recipe react flow's own "download image" example uses.
 */
export const exportPng = async (nodes: Node[], filename: string): Promise<void> => {
  const viewport: HTMLElement | null = document.querySelector('.react-flow__viewport');
  if (!viewport) throw new Error('the canvas is not mounted');

  const bounds: Rect = getNodesBounds(nodes);
  // lanes run above and below the cards: leave room for them
  const framed: Rect = {
    x: bounds.x - 180,
    y: bounds.y - 140,
    width: bounds.width + 360,
    height: bounds.height + 280,
  };
  const scale: number = Math.min(1, PNG_MAX_WIDTH / framed.width, PNG_MAX_HEIGHT / framed.height);
  const width: number = Math.round(framed.width * scale);
  const height: number = Math.round(framed.height * scale);
  const view: Viewport = getViewportForBounds(framed, width, height, 0.05, 2, PNG_PADDING);

  const dataUrl: string = await toPng(viewport, {
    backgroundColor: BACKGROUND,
    width,
    height,
    pixelRatio: 2,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
    },
  });
  download(filename, dataUrl);
};
