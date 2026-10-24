import { END_ID, type Box, type EdgeData, type GraphEdge, type Point } from './graph.types';
import { labelRowWidth, widestPillWidth } from './text';

/**
 * Orthogonal routing over the layout grid. Columns are waves and rows are the stack index
 * inside a column, aligned across columns, so every *gap* between two rows and every
 * *channel* between two columns is free of cards. Each edge becomes a short list of
 * segments over that grid, lanes are allocated per gap and per channel, the gaps and
 * channels grow to fit their lanes and labels, and only then are pixels assigned:
 *
 * - a row edge (adjacent columns) leaves the source's right side and enters the target's
 *   left side, with one vertical in the channel between them when the rows differ;
 *   verticals from one source (a fan-out) or into one target (a fan-in) share a trunk;
 * - a loop (back edge) leaves the source's bottom, runs left along the gap below the source
 *   row, drops through the channel right of the target column into the gap below the
 *   target row, and enters the target's bottom;
 * - an escape (`max`) leaves the source's top, runs right along the gap above the source
 *   row, moves through the channel left of the target column into the gap above the
 *   target row, and enters the target's top. A jump (forward over more than one column)
 *   does the same but travels along the top gap, above every row, climbing to it through
 *   the channel right of its source. Into END the last channel comes down to the row line
 *   and the edge enters END from the left.
 *
 * Nothing here is drawn: the result is positions, polylines and label anchors. Pure.
 */

/* ---- lane metrics */
/** Room between a card edge and the first lane of a gap. */
export const GAP_PAD = 14;
/** Thickness of a lane carrying a one-row pill row. */
export const LANE_THICKNESS = 24;
/** One row of a wrapped pill row. */
const PILL_ROW_H = 20;
const MAX_LABEL_ROWS = 3;
/** The least distance between parallel verticals in a channel (more when their pills need it). */
export const CHANNEL_LANE_PITCH = 18;
/** Room a pill keeps from the next trunk or card, each side. */
const LABEL_CLEARANCE = 12;
/** Where loops leave (bottom) and escapes enter (top) a card, as a fraction of its width. */
export const FAR_FRACTION = 0.8;
/** Where loops enter (bottom) and escapes leave (top) a card. */
export const NEAR_FRACTION = 0.2;
/** Permutations are tried up to this many trunks per channel; beyond it the model order stays. */
const MAX_PERMUTED_TRUNKS = 6;
/** The top gap: above row 0. */
const TOP_GAP = -1;

export interface GridCard {
  id: string;
  col: number;
  row: number;
  width: number;
  height: number;
}

export interface GridSettings {
  /** The smallest gap between two rows (with or without lanes). */
  stackGap: number;
  /** The smallest width of the channel after column `c` (room for the row pills). */
  channelWidth: (c: number) => number;
}

export interface RoutedGraph {
  /** Top-left of every card, by id. */
  positions: Record<string, Point>;
  /** The edges with `points`, `label`, `laneY` and `labelMaxWidth` filled in. */
  edges: GraphEdge[];
  /** Cards and lanes together. */
  bounds: Box;
}

/* ------------------------------------------------------------------ ordinal space */

/** Ordinal x of a column's near (20 %) point, far (80 %) point, and of the channel after it. */
const nearXo = (c: number): number => 4 * c + 1;
const farXo = (c: number): number => 4 * c + 2;
const channelXo = (c: number): number => 4 * c + 3.5;
/** Ordinal y of a row line and of a gap (gap `g` lies under row `g`; gap −1 is above row 0). */
const rowYo = (r: number): number => 2 * r + 1;
const gapYo = (g: number): number => 2 * g + 2;

type Side = 'left' | 'right';

/** A horizontal that meets a channel trunk: at which ordinal y, and on which side of the trunk it lies. */
interface Meeting {
  y: number;
  side: Side;
}

interface RowSpec {
  kind: 'row';
  edge: GraphEdge;
  src: GridCard;
  tgt: GridCard;
}

/** One horizontal run of an off-row edge: along gap `gap`, between two ordinal x, on the lane of `key`. */
interface Run {
  gap: number;
  a: number;
  b: number;
  key: string;
}

/** One vertical of an off-row edge: in channel `channel`, between two ordinal y (a gap or END's row), on trunk `key`. */
interface Climb {
  channel: number;
  from: number;
  to: number;
  key: string;
}

interface OffSpec {
  kind: 'loop' | 'escape';
  edge: GraphEdge;
  src: GridCard;
  tgt: GridCard;
  /** Lanes of this source and kind travel together. */
  key: string;
  /** The horizontals, in travel order; the last one carries the pills (the first one into END). */
  runs: Run[];
  /** The verticals, in travel order: `runs[i]` and `runs[i + 1]` are joined by `climbs[i]`. */
  climbs: Climb[];
  toEnd: boolean;
}

type Spec = RowSpec | OffSpec;

/** Lane keys: an edge's exit run travels with its source's other edges of that kind, its entry run with the target's. */
const sourceKey = (card: GridCard, kind: OffSpec['kind']): string => `s:${card.id}:${kind}`;
const targetKey = (card: GridCard, kind: OffSpec['kind']): string => `t:${card.id}:${kind}`;
/** The lane every END-bound jump shares along the top gap: one exit rail instead of a lane per source. */
const END_RAIL = `t:${END_ID}:escape`;

const loopSpec = (edge: GraphEdge, src: GridCard, tgt: GridCard): OffSpec => {
  const key: string = sourceKey(src, 'loop');
  const exitGap: number = src.row;
  const entryGap: number = tgt.row;
  const exitXo: number = farXo(src.col);
  const entryXo: number = nearXo(tgt.col);
  const base: Omit<OffSpec, 'runs' | 'climbs'> = {
    kind: 'loop',
    edge,
    src,
    tgt,
    key,
    toEnd: false,
  };
  if (exitGap === entryGap) {
    return { ...base, runs: [{ gap: exitGap, a: exitXo, b: entryXo, key }], climbs: [] };
  }
  const channel: number = tgt.col;
  const into: string = targetKey(tgt, 'loop');
  return {
    ...base,
    runs: [
      { gap: exitGap, a: exitXo, b: channelXo(channel), key },
      { gap: entryGap, a: channelXo(channel), b: entryXo, key: into },
    ],
    climbs: [{ channel, from: gapYo(exitGap), to: gapYo(entryGap), key: into }],
  };
};

const escapeSpec = (edge: GraphEdge, src: GridCard, tgt: GridCard, span: number): OffSpec => {
  const toEnd: boolean = tgt.id === END_ID;
  const key: string = sourceKey(src, 'escape');
  const into: string = toEnd ? END_RAIL : targetKey(tgt, 'escape');
  const exitGap: number = src.row - 1;
  const exitXo: number = nearXo(src.col);
  const entryXo: number = farXo(tgt.col);
  const before: number = tgt.col - 1;
  const base: Omit<OffSpec, 'runs' | 'climbs'> = { kind: 'escape', edge, src, tgt, key, toEnd };
  // A jump travels along the top gap; an escape to the next column stays beside its rows.
  const viaTop: boolean = span > 1 && exitGap !== TOP_GAP;
  const runs: Run[] = [];
  const climbs: Climb[] = [];
  let gap: number = exitGap;
  let xo: number = exitXo;
  if (viaTop) {
    runs.push({ gap, a: xo, b: channelXo(src.col), key });
    climbs.push({ channel: src.col, from: gapYo(gap), to: gapYo(TOP_GAP), key });
    gap = TOP_GAP;
    xo = channelXo(src.col);
  }
  if (toEnd) {
    // Along the top gap every END-bound jump rides the one exit rail.
    runs.push({ gap, a: xo, b: channelXo(before), key: gap === TOP_GAP ? END_RAIL : key });
    climbs.push({ channel: before, from: gapYo(gap), to: rowYo(0), key: into });
    return { ...base, runs, climbs };
  }
  const entryGap: number = tgt.row - 1;
  if (gap === entryGap) {
    runs.push({ gap, a: xo, b: entryXo, key });
    return { ...base, runs, climbs };
  }
  runs.push({ gap, a: xo, b: channelXo(before), key });
  climbs.push({ channel: before, from: gapYo(gap), to: gapYo(entryGap), key: into });
  runs.push({ gap: entryGap, a: channelXo(before), b: entryXo, key: into });
  return { ...base, runs, climbs };
};

const specOf =
  (cardOf: (id: string) => GridCard) =>
  (edge: GraphEdge): Spec => {
    const data: EdgeData = edge.data as EdgeData;
    const src: GridCard = cardOf(edge.source);
    const tgt: GridCard = cardOf(edge.target);
    const span: number = tgt.col - src.col;
    if (data.kind !== 'max' && (data.loop || span <= 0)) return loopSpec(edge, src, tgt);
    if (data.kind === 'max' || span > 1) return escapeSpec(edge, src, tgt, span);
    return { kind: 'row', edge, src, tgt };
  };

/** The run the pills sit on: the last one, or the first one when the edge ends on END's row line. */
const labelRun = (s: OffSpec): Run => (s.toEnd ? s.runs[0] : s.runs[s.runs.length - 1]);

/* ------------------------------------------------------------------ channels */

interface Trunk {
  key: string;
  lo: number;
  hi: number;
  meetings: Meeting[];
}

/** Crossings between the trunks of one channel when trunk `i` sits at position `pos[i]`. */
const crossingsOf = (trunks: readonly Trunk[], pos: readonly number[]): number => {
  let n: number = 0;
  trunks.forEach((a: Trunk, i: number): void => {
    trunks.forEach((b: Trunk, j: number): void => {
      if (i === j) return;
      for (const m of b.meetings) {
        if (m.y <= a.lo || m.y >= a.hi) continue;
        if (m.side === 'left' ? pos[i] < pos[j] : pos[i] > pos[j]) n += 1;
      }
    });
  });
  return n;
};

const permutations = (n: number): number[][] => {
  if (n <= 1) return [[...Array(n).keys()]];
  return permutations(n - 1).flatMap((p: number[]): number[][] =>
    [...Array(n).keys()].map((at: number): number[] => [...p.slice(0, at), n - 1, ...p.slice(at)]),
  );
};

/** Position of every trunk across the channel, left to right: the order with the fewest crossings. */
const orderTrunks = (trunks: readonly Trunk[]): number[] => {
  const identity: number[] = trunks.map((_t: Trunk, i: number): number => i);
  if (trunks.length > MAX_PERMUTED_TRUNKS) return identity;
  // `perm[p]` is the trunk at position p; invert to a position per trunk.
  const asPositions = (perm: readonly number[]): number[] => {
    const pos: number[] = [];
    perm.forEach((trunk: number, p: number): void => {
      pos[trunk] = p;
    });
    return pos;
  };
  let best: number[] = identity;
  let bestCost: number = crossingsOf(trunks, identity);
  for (const perm of permutations(trunks.length)) {
    const pos: number[] = asPositions(perm);
    const cost: number = crossingsOf(trunks, pos);
    if (cost < bestCost) {
      best = pos;
      bestCost = cost;
    }
  }
  return best;
};

interface ChannelPlan {
  /** Position across the channel per trunk key. */
  position: Map<string, number>;
  count: number;
  /** Room each trunk needs: the widest pill row hanging on a bent edge, halved, plus clearance. */
  pitch: number;
}

const mergeTrunk = (
  into: Map<string, Trunk>,
  key: string,
  lo: number,
  hi: number,
  meetings: Meeting[],
): void => {
  const prev: Trunk | undefined = into.get(key);
  into.set(key, {
    key,
    lo: Math.min(prev?.lo ?? lo, lo),
    hi: Math.max(prev?.hi ?? hi, hi),
    meetings: [...(prev?.meetings ?? []), ...meetings],
  });
};

/** Row edges per source and per target, over the whole graph (a source's row edges all share one channel). */
interface FanCounts {
  out: Map<string, number>;
  in: Map<string, number>;
}

const fanCounts = (specs: readonly Spec[]): FanCounts => {
  const out: Map<string, number> = new Map();
  const into: Map<string, number> = new Map();
  for (const s of specs) {
    if (s.kind !== 'row') continue;
    out.set(s.src.id, (out.get(s.src.id) ?? 0) + 1);
    into.set(s.tgt.id, (into.get(s.tgt.id) ?? 0) + 1);
  }
  return { out, in: into };
};

/** The trunk a row edge's vertical joins: its source's fan-out, else its target's fan-in, else its own. */
const rowTrunkKey = (spec: RowSpec, fans: FanCounts): string =>
  (fans.out.get(spec.src.id) ?? 0) > 1
    ? `s:${spec.src.id}`
    : (fans.in.get(spec.tgt.id) ?? 0) > 1
      ? `t:${spec.tgt.id}`
      : `e:${spec.edge.id}`;

const planChannels = (specs: readonly Spec[], fans: FanCounts): Map<number, ChannelPlan> => {
  const byChannel: Map<number, Map<string, Trunk>> = new Map();
  const bentLabel: Map<number, number> = new Map();
  const trunksOf = (c: number): Map<string, Trunk> => {
    const prev: Map<string, Trunk> | undefined = byChannel.get(c);
    if (prev) return prev;
    const fresh: Map<string, Trunk> = new Map();
    byChannel.set(c, fresh);
    return fresh;
  };
  const widen = (into: Map<number, number>, c: number, w: number): void => {
    into.set(c, Math.max(into.get(c) ?? 0, w));
  };
  for (const s of specs) {
    if (s.kind === 'row') {
      const c: number = s.src.col;
      const w: number = labelRowWidth(s.edge.data as EdgeData);
      // A straight edge's pills sit mid-channel; the column gap already makes room for them.
      if (s.src.row === s.tgt.row) continue;
      widen(bentLabel, c, w);
      const a: number = rowYo(s.src.row);
      const b: number = rowYo(s.tgt.row);
      mergeTrunk(trunksOf(c), rowTrunkKey(s, fans), Math.min(a, b), Math.max(a, b), [
        { y: a, side: 'left' },
        { y: b, side: 'right' },
      ]);
      continue;
    }
    s.climbs.forEach((climb: Climb, i: number): void => {
      // The run before the climb arrives on one side of the trunk, the run after leaves on the other.
      const arriving: Side = s.runs[i].b > s.runs[i].a ? 'left' : 'right';
      const leaving: Side = s.runs[i + 1]
        ? s.runs[i + 1].b > s.runs[i + 1].a
          ? 'right'
          : 'left'
        : 'right';
      mergeTrunk(
        trunksOf(climb.channel),
        climb.key,
        Math.min(climb.from, climb.to),
        Math.max(climb.from, climb.to),
        [
          { y: climb.from, side: arriving },
          { y: climb.to, side: leaving },
        ],
      );
    });
  }
  const plans: Map<number, ChannelPlan> = new Map();
  for (const c of byChannel.keys()) {
    const list: Trunk[] = [...(byChannel.get(c)?.values() ?? [])];
    const order: number[] = orderTrunks(list);
    const bent: number = bentLabel.get(c) ?? 0;
    plans.set(c, {
      position: new Map(list.map((t: Trunk, i: number): [string, number] => [t.key, order[i]])),
      count: list.length,
      pitch: Math.max(CHANNEL_LANE_PITCH, bent / 2 + LABEL_CLEARANCE),
    });
  }
  return plans;
};

/* ------------------------------------------------------------------ gaps */

type GapSide = 'down' | 'up';

interface GapItem {
  key: string;
  lo: number;
  hi: number;
  thickness: number;
}

interface Lane {
  index: number;
  thickness: number;
}

interface GapPlan {
  /** Lane per item key, per side. */
  lanes: Map<GapSide, Map<string, Lane>>;
  /** Thickness per lane index, per side. */
  stacks: Map<GapSide, number[]>;
}

const gapItemKey = (gap: number, side: GapSide, key: string): string => `${gap}|${side}|${key}`;

/** Greedy interval colouring: shortest spans take the lanes nearest the cards. */
const allocateLanes = (items: readonly GapItem[]): { lane: Map<string, Lane>; stack: number[] } => {
  const ordered: GapItem[] = [...items].sort(
    (a: GapItem, b: GapItem): number =>
      a.hi - a.lo - (b.hi - b.lo) || a.lo - b.lo || a.key.localeCompare(b.key),
  );
  const lanes: GapItem[][] = [];
  const lane: Map<string, Lane> = new Map();
  for (const item of ordered) {
    const free: number = lanes.findIndex((taken: GapItem[]): boolean =>
      taken.every((o: GapItem): boolean => o.hi < item.lo || o.lo > item.hi),
    );
    const index: number = free === -1 ? lanes.length : free;
    if (free === -1) lanes.push([]);
    lanes[index].push(item);
    lane.set(item.key, { index, thickness: 0 });
  }
  const stack: number[] = lanes.map((taken: GapItem[]): number =>
    Math.max(LANE_THICKNESS, ...taken.map((o: GapItem): number => o.thickness)),
  );
  for (const [key, l] of lane) lane.set(key, { ...l, thickness: stack[l.index] });
  return { lane, stack };
};

/* ------------------------------------------------------------------ labels */

interface LabelPlan {
  rows: number;
  maxWidth: number | undefined;
}

/** A pill row wider than the segment it sits on wraps, up to three rows. */
const planLabel = (data: EdgeData, segment: number): LabelPlan => {
  const width: number = labelRowWidth(data);
  const room: number = segment - 8;
  if (width <= room || data.kind === 'start') return { rows: 1, maxWidth: undefined };
  const maxWidth: number = Math.max(room, widestPillWidth(data));
  return { rows: Math.min(MAX_LABEL_ROWS, Math.ceil(width / maxWidth)), maxWidth };
};

const labelThickness = (plan: LabelPlan): number =>
  plan.rows === 1 ? LANE_THICKNESS : plan.rows * PILL_ROW_H + 4;

/* ------------------------------------------------------------------ the route */

/**
 * Lay the cards on the grid and route every edge. `cards` carry their column, row and size;
 * START is column 0 and END the last column, both on row 0.
 */
export const routeGraph = (
  cards: readonly GridCard[],
  edges: readonly GraphEdge[],
  settings: GridSettings,
): RoutedGraph => {
  const byId: Map<string, GridCard> = new Map(
    cards.map((c: GridCard): [string, GridCard] => [c.id, c]),
  );
  const cardOf = (id: string): GridCard => {
    const card: GridCard | undefined = byId.get(id);
    if (!card) throw new Error(`routeGraph: no card ${id}`);
    return card;
  };
  const specs: Spec[] = edges.map(specOf(cardOf));
  const fans: FanCounts = fanCounts(specs);
  const maxCol: number = Math.max(0, ...cards.map((c: GridCard): number => c.col));
  const maxRow: number = Math.max(0, ...cards.map((c: GridCard): number => c.row));

  /* ---- channels: trunk order and width, then column x */
  const channels: Map<number, ChannelPlan> = planChannels(specs, fans);
  const colWidth: number[] = [...Array(maxCol + 1).keys()].map((c: number): number =>
    Math.max(
      0,
      ...cards.filter((k: GridCard): boolean => k.col === c).map((k: GridCard): number => k.width),
    ),
  );
  const channelWidth = (c: number): number => {
    const plan: ChannelPlan | undefined = channels.get(c);
    const trunks: number = plan?.count ?? 0;
    return Math.max(settings.channelWidth(c), trunks > 0 ? (trunks + 1) * (plan?.pitch ?? 0) : 0);
  };
  const colX: number[] = [];
  for (let c = 0; c <= maxCol; c += 1) {
    colX[c] = c === 0 ? 0 : colX[c - 1] + colWidth[c - 1] + channelWidth(c - 1);
  }
  const channelLeft = (c: number): number => colX[c] + colWidth[c];
  /** The slot width of a channel: between two trunks, or a trunk and a card. */
  const slotWidth = (c: number): number => channelWidth(c) / ((channels.get(c)?.count ?? 0) + 1);
  const trunkX = (c: number, key: string): number => {
    const position: number = channels.get(c)?.position.get(key) ?? 0;
    return channelLeft(c) + slotWidth(c) * (position + 1);
  };
  const cardX = (card: GridCard): number => colX[card.col] + (colWidth[card.col] - card.width) / 2;
  const pointX = (card: GridCard, fraction: number): number => cardX(card) + card.width * fraction;
  /** Pixel x of an ordinal x: a card's near / far point, or a channel's trunk for `key`. */
  const ordinalX = (xo: number, key: string): number => {
    const c: number = Math.floor(xo / 4);
    const slot: number = xo - 4 * c;
    if (slot === 3.5) return trunkX(c, key);
    const card: GridCard | undefined = cards.find(
      (k: GridCard): boolean => k.col === c && k.row === 0,
    );
    const width: number = card?.width ?? colWidth[c];
    const left: number = colX[c] + (colWidth[c] - width) / 2;
    return left + width * (slot === 1 ? NEAR_FRACTION : FAR_FRACTION);
  };

  /* ---- labels: where an off-row edge's pills sit, and how wide that run is */
  const runLength = (s: OffSpec, run: Run): number => {
    const key = (xo: number): string => {
      const c: number = Math.floor(xo / 4);
      const climb: Climb | undefined = s.climbs.find((k: Climb): boolean => k.channel === c);
      return climb ? climb.key : s.key;
    };
    return Math.abs(ordinalX(run.a, key(run.a)) - ordinalX(run.b, key(run.b)));
  };
  /** The off-row edges whose pills share this one's run: same gap and lane, overlapping stretch. */
  const labelSiblings = (s: OffSpec): OffSpec[] => {
    const own: Run = labelRun(s);
    return specs.filter((o: Spec): o is OffSpec => {
      if (o.kind === 'row') return false;
      const run: Run = labelRun(o);
      return (
        run.gap === own.gap &&
        run.key === own.key &&
        Math.min(run.a, run.b) <= Math.max(own.a, own.b) &&
        Math.min(own.a, own.b) <= Math.max(run.a, run.b)
      );
    });
  };
  const labels: Map<string, LabelPlan> = new Map(
    specs.flatMap((s: Spec): [string, LabelPlan][] => {
      if (s.kind === 'row') return [];
      const share: number = labelSiblings(s).length;
      const room: number = runLength(s, labelRun(s)) / share;
      return [[s.edge.id, planLabel(s.edge.data as EdgeData, room)]];
    }),
  );

  /* ---- gaps: items per (gap, side, key), lanes, thickness */
  const items: Map<string, GapItem> = new Map();
  const addItem = (
    gap: number,
    side: GapSide,
    key: string,
    a: number,
    b: number,
    thickness: number,
  ): void => {
    const id: string = gapItemKey(gap, side, key);
    const prev: GapItem | undefined = items.get(id);
    items.set(id, {
      key: id,
      lo: Math.min(prev?.lo ?? a, a, b),
      hi: Math.max(prev?.hi ?? b, a, b),
      thickness: Math.max(prev?.thickness ?? 0, thickness),
    });
  };
  for (const s of specs) {
    if (s.kind === 'row') continue;
    const side: GapSide = s.kind === 'loop' ? 'down' : 'up';
    const thick: number = labelThickness(labels.get(s.edge.id) as LabelPlan);
    const carrier: Run = labelRun(s);
    for (const run of s.runs) {
      addItem(run.gap, side, run.key, run.a, run.b, run === carrier ? thick : LANE_THICKNESS);
    }
  }
  const gaps: Map<number, GapPlan> = new Map();
  for (let g = TOP_GAP; g <= maxRow; g += 1) {
    const plan: GapPlan = { lanes: new Map(), stacks: new Map() };
    for (const side of ['down', 'up'] as GapSide[]) {
      const prefix: string = `${g}|${side}|`;
      const own: GapItem[] = [...items.values()].filter((i: GapItem): boolean =>
        i.key.startsWith(prefix),
      );
      const { lane, stack } = allocateLanes(own);
      plan.lanes.set(side, lane);
      plan.stacks.set(side, stack);
    }
    gaps.set(g, plan);
  }
  const stackHeight = (g: number, side: GapSide): number =>
    (gaps.get(g)?.stacks.get(side) ?? []).reduce((sum: number, t: number): number => sum + t, 0);
  const gapHeight = (g: number): number => {
    const down: number = stackHeight(g, 'down');
    const up: number = stackHeight(g, 'up');
    if (g < 0) return up > 0 ? GAP_PAD + up : 0;
    if (g >= maxRow) return down > 0 ? GAP_PAD + down : 0;
    return Math.max(settings.stackGap, GAP_PAD + down + up + GAP_PAD);
  };

  /* ---- rows: aligned across columns, the main row centred on y = 0 */
  const rowHeight: number[] = [...Array(maxRow + 1).keys()].map((r: number): number =>
    Math.max(
      0,
      ...cards.filter((k: GridCard): boolean => k.row === r).map((k: GridCard): number => k.height),
    ),
  );
  const rowTop: number[] = [];
  for (let r = 0; r <= maxRow; r += 1) {
    rowTop[r] = r === 0 ? -rowHeight[0] / 2 : rowTop[r - 1] + rowHeight[r - 1] + gapHeight(r - 1);
  }
  const rowCentre = (r: number): number => rowTop[r] + rowHeight[r] / 2;
  const cardY = (card: GridCard): number =>
    rowTop[card.row] + (rowHeight[card.row] - card.height) / 2;
  const laneY = (g: number, side: GapSide, key: string): number => {
    const plan: GapPlan | undefined = gaps.get(g);
    const lane: Lane | undefined = plan?.lanes.get(side)?.get(gapItemKey(g, side, key));
    const stack: number[] = plan?.stacks.get(side) ?? [];
    const index: number = lane?.index ?? 0;
    const before: number = stack
      .slice(0, index)
      .reduce((sum: number, t: number): number => sum + t, 0);
    const half: number = (lane?.thickness ?? LANE_THICKNESS) / 2;
    if (side === 'down') return rowTop[g] + rowHeight[g] + GAP_PAD + before + half;
    const bottom: number = g + 1 <= maxRow ? rowTop[g + 1] : rowTop[maxRow] + rowHeight[maxRow];
    return bottom - GAP_PAD - before - half;
  };
  /** Pixel y of an ordinal y: a row line, or a lane in a gap for `key`. */
  const ordinalY = (yo: number, side: GapSide, key: string): number =>
    yo % 2 === 1 ? rowCentre((yo - 1) / 2) : laneY((yo - 2) / 2, side, key);

  /* ---- points */
  const positions: Record<string, Point> = Object.fromEntries(
    cards.map((c: GridCard): [string, Point] => [c.id, { x: cardX(c), y: cardY(c) }]),
  );

  const routeRow = (s: RowSpec): { points: Point[]; label: Point } => {
    const ySrc: number = rowCentre(s.src.row);
    const yTgt: number = rowCentre(s.tgt.row);
    const from: Point = { x: cardX(s.src) + s.src.width, y: ySrc };
    const to: Point = { x: cardX(s.tgt), y: yTgt };
    const c: number = s.src.col;
    if (s.src.row === s.tgt.row) {
      return { points: [from, to], label: { x: (from.x + to.x) / 2, y: ySrc } };
    }
    const key: string = rowTrunkKey(s, fans);
    const lx: number = trunkX(c, key);
    // The pills hang on the trunk beside a card: the target for a fan-out, the source for a fan-in —
    // the end that is this edge's own — a quarter card in from its row line, so no two meet and none
    // lands in a gap where lanes run.
    const fanIn: boolean = key.startsWith('t:');
    const anchorY: number = fanIn ? ySrc : yTgt;
    const towards: number = fanIn ? yTgt : ySrc;
    const anchor: GridCard = fanIn ? s.src : s.tgt;
    const q: number = Math.min(anchor.height / 4, Math.abs(ySrc - yTgt) / 2);
    const labelY: number = anchorY + (towards > anchorY ? q : -q);
    return {
      points: [from, { x: lx, y: ySrc }, { x: lx, y: yTgt }, to],
      label: { x: lx, y: labelY },
    };
  };

  /**
   * Where a run's pills go: over the middle of the column nearest the run's centre, when the run
   * covers that whole column — the gap under a card is free of trunks, a channel is not — else
   * the run's centre.
   */
  const snapToColumn = (a: number, b: number): number => {
    const lo: number = Math.min(a, b);
    const hi: number = Math.max(a, b);
    const mid: number = (a + b) / 2;
    const covered: number[] = [...Array(maxCol + 1).keys()].filter(
      (c: number): boolean => lo <= colX[c] && hi >= colX[c] + colWidth[c],
    );
    if (covered.length === 0) return mid;
    const centre = (c: number): number => colX[c] + colWidth[c] / 2;
    return centre(
      covered.reduce((best: number, c: number): number =>
        Math.abs(centre(c) - mid) < Math.abs(centre(best) - mid) ? c : best,
      ),
    );
  };

  /**
   * Where this edge's pills go along its run when siblings share it: one after another, so two
   * exits from one source (REJECT and max) or two escapes into one target never print on each
   * other. Into END the row starts after the riser; elsewhere it is centred on `centre`.
   */
  const labelX = (s: OffSpec, from: number, centre: number): number => {
    const siblings: OffSpec[] = labelSiblings(s);
    const widths: number[] = siblings.map((o: OffSpec): number => {
      const plan: LabelPlan | undefined = labels.get(o.edge.id);
      return plan?.maxWidth ?? labelRowWidth(o.edge.data as EdgeData);
    });
    const at: number = siblings.indexOf(s);
    const before: number = widths
      .slice(0, at)
      .reduce((sum: number, w: number): number => sum + w + 6, 0);
    const total: number = widths.reduce((sum: number, w: number): number => sum + w + 6, -6);
    const start: number = s.toEnd ? from + 10 : centre - total / 2;
    return start + before + widths[at] / 2;
  };

  const routeOff = (s: OffSpec): { points: Point[]; label: Point; laneY: number } => {
    const side: GapSide = s.kind === 'loop' ? 'down' : 'up';
    const exitX: number = pointX(s.src, s.kind === 'loop' ? FAR_FRACTION : NEAR_FRACTION);
    const srcEdgeY: number = s.kind === 'loop' ? cardY(s.src) + s.src.height : cardY(s.src);
    const points: Point[] = [{ x: exitX, y: srcEdgeY }];
    s.runs.forEach((run: Run, i: number): void => {
      const y: number = laneY(run.gap, side, run.key);
      const climb: Climb | undefined = s.climbs[i];
      points.push({ x: ordinalX(run.a, i > 0 ? s.climbs[i - 1].key : s.key), y });
      points.push({ x: ordinalX(run.b, climb ? climb.key : s.key), y });
      if (climb) {
        const next: Run | undefined = s.runs[i + 1];
        const x: number = trunkX(climb.channel, climb.key);
        points.push({
          x,
          y: next ? laneY(next.gap, side, next.key) : ordinalY(climb.to, side, s.key),
        });
      }
    });
    const last: Point = points[points.length - 1];
    if (s.toEnd) {
      points.push({ x: cardX(s.tgt), y: last.y });
    } else {
      const entryX: number = pointX(s.tgt, s.kind === 'loop' ? NEAR_FRACTION : FAR_FRACTION);
      const tgtEdgeY: number = s.kind === 'loop' ? cardY(s.tgt) + s.tgt.height : cardY(s.tgt);
      points.push({ x: entryX, y: tgtEdgeY });
    }
    const carrier: Run = labelRun(s);
    const carrierIndex: number = s.runs.indexOf(carrier);
    // Each run contributes two points after the exit point (plus one per climb before it).
    const start: number = 1 + carrierIndex * 3;
    const a: Point = points[start];
    const b: Point = points[start + 1];
    const x: number = labelX(s, a.x, snapToColumn(a.x, b.x));
    return { points, label: { x, y: a.y }, laneY: laneY(s.runs[0].gap, side, s.runs[0].key) };
  };

  const routed: GraphEdge[] = specs.map((s: Spec): GraphEdge => {
    const data: EdgeData = s.edge.data as EdgeData;
    if (s.kind === 'row') {
      const { points, label } = routeRow(s);
      return { ...s.edge, data: { ...data, points, label } };
    }
    const { points, label, laneY: y } = routeOff(s);
    const plan: LabelPlan | undefined = labels.get(s.edge.id);
    return {
      ...s.edge,
      data: { ...data, points, label, laneY: y, labelMaxWidth: plan?.maxWidth },
    };
  });

  const top: number = rowTop[0] - gapHeight(TOP_GAP);
  const bottom: number = rowTop[maxRow] + rowHeight[maxRow] + gapHeight(maxRow);
  const right: number = colX[maxCol] + colWidth[maxCol];
  return { positions, edges: routed, bounds: { x: 0, y: top, width: right, height: bottom - top } };
};

/* ------------------------------------------------------------------ drawing helpers (pure) */

/** Drop repeated points and points on a straight run, so corners are real corners. */
export const simplifyPoints = (points: readonly Point[]): Point[] =>
  points.reduce((acc: Point[], p: Point): Point[] => {
    const last: Point | undefined = acc[acc.length - 1];
    if (last && last.x === p.x && last.y === p.y) return acc;
    const prev: Point | undefined = acc[acc.length - 2];
    if (
      last &&
      prev &&
      ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))
    ) {
      return [...acc.slice(0, -1), p];
    }
    return [...acc, p];
  }, []);

/** An SVG path along the polyline with corners rounded by `radius` (less on short runs). */
export const roundedPath = (points: readonly Point[], radius: number): string => {
  const pts: Point[] = simplifyPoints(points);
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  const parts: string[] = [`M ${pts[0].x} ${pts[0].y}`];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const prev: Point = pts[i - 1];
    const at: Point = pts[i];
    const next: Point = pts[i + 1];
    const inLen: number = Math.hypot(at.x - prev.x, at.y - prev.y);
    const outLen: number = Math.hypot(next.x - at.x, next.y - at.y);
    const r: number = Math.min(radius, inLen / 2, outLen / 2);
    const inX: number = at.x - ((at.x - prev.x) / inLen) * r;
    const inY: number = at.y - ((at.y - prev.y) / inLen) * r;
    const outX: number = at.x + ((next.x - at.x) / outLen) * r;
    const outY: number = at.y + ((next.y - at.y) / outLen) * r;
    parts.push(`L ${inX} ${inY}`, `Q ${at.x} ${at.y} ${outX} ${outY}`);
  }
  const end: Point = pts[pts.length - 1];
  parts.push(`L ${end.x} ${end.y}`);
  return parts.join(' ');
};

export type Heading = 'right' | 'left' | 'down' | 'up';

/** The direction the polyline travels on its last run (where the arrowhead points). */
export const lastHeading = (points: readonly Point[]): Heading => {
  const pts: Point[] = simplifyPoints(points);
  const end: Point | undefined = pts[pts.length - 1];
  const before: Point | undefined = pts[pts.length - 2];
  if (!end || !before) return 'right';
  if (end.x !== before.x) return end.x > before.x ? 'right' : 'left';
  return end.y > before.y ? 'down' : 'up';
};
