import type { Theme } from '../render.types.js';

/**
 * Semantic tokens → colours. The SVG never holds a colour literal outside this file: its
 * `<style>` block declares these as CSS variables and every shape keys on a class.
 */
export interface ThemeTokens {
  canvas: string;
  card: string;
  cardBorder: string;
  ink: string;
  ink2: string;
  /** The agent name: the one non-status use of chroma, as in the Studio. */
  agent: string;
  /** Edges off the happy path, and the arrowheads that go with them. */
  edge: string;
  /** START edges and each step's first forward-going event. */
  edgeHappy: string;
  /** The human gate: border, glyph and its "waits for a person" line. */
  human: string;
  /** Unreachable step badge and border. */
  warn: string;
  /** `--highlight` emphasis. */
  highlight: string;
  modelFable: string;
  modelOpus: string;
  modelSonnet: string;
  modelHaiku: string;
  modelOther: string;
}

const LIGHT: ThemeTokens = {
  canvas: '#ffffff',
  card: '#f7f9fc',
  cardBorder: '#cfd6e0',
  ink: '#1f2733',
  ink2: '#5b6778',
  agent: '#1f8f5a',
  edge: '#aeb8c6',
  edgeHappy: '#3b4656',
  human: '#d98c1f',
  warn: '#e0483e',
  highlight: '#2f7ff0',
  modelFable: '#c2338a',
  modelOpus: '#7c5cff',
  modelSonnet: '#2f7ff0',
  modelHaiku: '#1f9d55',
  modelOther: '#6b7686',
};

// TODO(M4): `dark` (the Studio's own palette: ground #151b26, raised #242f40, line #334154 …) and `mono` (print greys).
const THEMES: Partial<Record<Theme, ThemeTokens>> = { light: LIGHT };

export const tokensFor = (theme: Theme): ThemeTokens | undefined => THEMES[theme];
