import type { ActorFact, Provider, UsageEvent } from "../../contract/usage-event.types.js";
import type {
  PipelineRun,
  PipelineStep,
} from "../../adapters/factory-state/factory-state.types.js";
import { topFolderOf } from "../../adapters/factory-state/read-factory-runs.js";
import { MAIN_ACTOR_ID } from "../../aggregation/hierarchy.js";
import type {
  FactoryRunCost,
  LinkedSession,
  SessionBundle,
  SessionClaims,
  StepActorRef,
  StepAttribution,
  StepCost,
} from "./factory.types.js";
import { blockFromEvents, isAdditive, modelsOf, ms, overlapMs, within } from "./factory.utils.js";

const RUN_SLACK_MS = 3 * 60 * 1000;
const OPEN_STATUSES = new Set<string>([
  "running",
  "in_progress",
  "in-progress",
  "active",
  "started",
]);
/** Set per attribution call; open-ended (still running) runs and steps extend to this instant. */
let nowMs = Date.now();
const STEP_SLACK_MS = 90 * 1000;
/** A subagent with nothing but a time overlap must spend at least this share of its life inside the step. */
const WINDOW_ONLY_MIN_FIT = 0.5;

type Interval = { from: number; to: number };
type StepMatch = { step: PipelineStep; attribution: StepAttribution; windowKey: string };

/**
 * Every pass window of a step. A still-running pass (the step is open and its latest start lies
 * after every closed window) runs to `now`.
 */
const stepIntervals = (step: PipelineStep): Interval[] => {
  const closed: Interval[] = step.windows
    .map((w): Interval => ({ from: ms(w.from), to: ms(w.to) }))
    .filter((i: Interval): boolean => Number.isFinite(i.from) && Number.isFinite(i.to));
  const started: number = ms(step.startedAt);
  const openPass: boolean =
    OPEN_STATUSES.has(step.status) &&
    Number.isFinite(started) &&
    !closed.some((i: Interval): boolean => i.from >= started - 1000);
  return openPass ? [...closed, { from: started, to: nowMs }] : closed;
};

const agentSteps = (run: PipelineRun): PipelineStep[] =>
  run.steps.filter((s: PipelineStep): boolean => s.agent !== "human");

const actorInterval = (fact: ActorFact | undefined, events: UsageEvent[]): Interval | null => {
  const times: number[] = events
    .map((e: UsageEvent): number => ms(e.timestamp))
    .filter(Number.isFinite);
  const from: number = Math.min(...(fact?.startedAt ? [ms(fact.startedAt)] : []), ...times);
  const to: number = Math.max(...(fact?.endedAt ? [ms(fact.endedAt)] : []), ...times);
  return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null;
};

/** Every id one provider session may be known by: the provider's own id and the namespaced run id. */
export const sessionKeys = (session: SessionBundle): string[] => {
  const provided: string | undefined =
    session.run?.providerSessionId ??
    session.events.find((e: UsageEvent): boolean => Boolean(e.run.providerSessionId))?.run
      .providerSessionId;
  const bare: string = session.runId.includes(":")
    ? session.runId.slice(session.runId.indexOf(":") + 1)
    : session.runId;
  return Array.from(
    new Set<string>([provided, session.runId, bare].filter((key): key is string => Boolean(key))),
  );
};

/**
 * What the run itself says about which session did which step. A session id recorded by exactly
 * one step is `pinned` to it: one headless process per step means the session IS the step's work.
 * An id several steps share (one orchestrator session that spawned subagents) is owned but not
 * pinned — those runs are still split up by the heuristics below.
 */
export const sessionOwnership = (
  run: PipelineRun,
): { pinned: Map<string, string>; own: Set<string> } => {
  const stepsById: Map<string, Set<string>> = run.steps.reduce(
    (acc: Map<string, Set<string>>, step: PipelineStep): Map<string, Set<string>> =>
      step.sessionIds.reduce(
        (inner: Map<string, Set<string>>, id: string): Map<string, Set<string>> =>
          inner.set(id, new Set<string>([...(inner.get(id) ?? []), step.name])),
        acc,
      ),
    new Map<string, Set<string>>(),
  );
  const pinned: Map<string, string> = new Map<string, string>();
  stepsById.forEach((names: Set<string>, id: string): void => {
    const only: string | undefined = names.size === 1 ? [...names][0] : undefined;
    if (only !== undefined) pinned.set(id, only);
  });
  return { pinned, own: new Set<string>(stepsById.keys()) };
};

const STEP_FOLDER = /^(\d{1,3})-([a-z][\w-]*)$/;

/**
 * Whether a run-folder subfolder belongs to the step: the step's recorded or declared output
 * folders first (a step's folder need not carry its name), the `<n>-<step>` convention second.
 */
const folderIsStep = (folder: string, step: PipelineStep): boolean =>
  step.outputFolders.includes(folder) || STEP_FOLDER.exec(folder)?.[2] === step.name;

/** `run/<pipeline>/<folder>`; a folder is a slug, never a file (`run/<pipeline>/.topic.txt` is not a run). */
const RUN_PATH = /\brun\/([\w-]+)\/([\w-]+)(?![\w.-])/g;
const namesARun = (p: string): boolean => /\brun\/[\w-]+\/[\w-]+(?![\w.-])/.test(p);

/**
 * The run-folder subfolders a path may point into, for a path inside this run. An absolute path
 * (or one naming `run/<pipeline>/<folder>`) resolves only through this run's marker; a relative
 * path offers every segment, because the prompt-ref regex can clip a run folder's own name onto
 * the front (`50-kz-2026-10-14/2-approve-hypothesis/decision.md`).
 */
const runFoldersOf = (p: string, run: PipelineRun): string[] => {
  const marker: string = `/${run.pipeline}/${run.runFolder}/`;
  const i: number = p.indexOf(marker);
  if (i >= 0 && runPathRe(run).test(p)) {
    const folder: string | undefined = topFolderOf(p.slice(i + marker.length));
    return folder ? [folder] : [];
  }
  if (p.startsWith("/") || namesARun(p)) return []; // elsewhere
  return p.split("/").filter((seg: string): boolean => seg.length > 0 && !seg.includes("*"));
};

const mentions = (fact: ActorFact | undefined): string[] => [
  ...(fact?.refs ?? []),
  ...(fact?.writes ?? []),
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `…/<pipeline>/<folder>` as a whole path segment: `georgia-2026-10-17` is not `georgia-2026-10-17-aborted-1`. */
const runPathRe = (run: PipelineRun): RegExp =>
  new RegExp(`/${escapeRe(run.pipeline)}/${escapeRe(run.runFolder)}(?![\\w.-])`);

const refsMentionRun = (refs: string[], run: PipelineRun): boolean =>
  refs.some((r: string): boolean => runPathRe(run).test(r));

/** Names a `run/<pipeline>/<folder>` that is not this one (another pipeline's run of the same name counts). */
const refsMentionOtherRun = (refs: string[], run: PipelineRun): boolean =>
  refs.some((r: string): boolean =>
    Array.from(r.matchAll(RUN_PATH)).some(
      (m: RegExpMatchArray): boolean => m[1] !== run.pipeline || m[2] !== run.runFolder,
    ),
  );

/** Whether any of the actor's paths resolves to a step folder of this run. */
const touchesRun = (paths: string[], run: PipelineRun): boolean =>
  paths.some((p: string): boolean =>
    runFoldersOf(p, run).some((f: string): boolean =>
      agentSteps(run).some((s: PipelineStep): boolean => folderIsStep(f, s)),
    ),
  );

const STEP_LIKE = /^\d{1,3}[a-z]?-[a-z][\w-]*$/;

/**
 * Whether the actor's paths name step folders (`6-calc-mediaplan/…`) that are not this run's: the
 * mark of another factory's step running in the same session. A scratch file is no evidence either way.
 */
const worksElsewhere = (paths: string[], run: PipelineRun): boolean =>
  paths.some((p: string): boolean => {
    const inRun: string[] = runFoldersOf(p, run);
    // Inside this run: its own step folders are not "elsewhere". Anywhere else: any step-like segment is.
    const segments: string[] = inRun.length > 0 || !p.startsWith("/") ? inRun : p.split("/");
    return segments.some(
      (f: string): boolean =>
        STEP_LIKE.test(f) &&
        !agentSteps(run).some((s: PipelineStep): boolean => folderIsStep(f, s)),
    );
  });

const wordIn = (needle: string, haystack: string | undefined): boolean =>
  haystack !== undefined && new RegExp(`(^|[^\\w-])${escapeRe(needle)}($|[^\\w-])`).test(haystack);

/** How much of its life a subagent spent inside one pass window of a step: the pass's own agent is at ~1. */
type Fit = { fit: number; fitSlack: number; index: number };

/** 3: the pass's own agent (≥ 0.9 inside); 2: mostly inside; 1: partly inside; 0: only within the recorder's slack. */
const fitLevel = (f: Fit): number =>
  f.fit >= 0.9 ? 3 : f.fit >= WINDOW_ONLY_MIN_FIT ? 2 : f.fit > 0 ? 1 : 0;

const bestWindow = (step: PipelineStep, interval: Interval | null): Fit => {
  if (!interval) return { fit: 0, fitSlack: 0, index: -1 };
  const span: number = Math.max(1, interval.to - interval.from);
  return stepIntervals(step).reduce(
    (best: Fit, si: Interval, index: number): Fit => {
      const fit: number = overlapMs(si, interval) / span;
      const fitSlack: number =
        overlapMs({ from: si.from - STEP_SLACK_MS, to: si.to + STEP_SLACK_MS }, interval) / span;
      return fit > best.fit || (fit === best.fit && fitSlack > best.fitSlack)
        ? { fit, fitSlack, index }
        : best;
    },
    { fit: 0, fitSlack: 0, index: -1 },
  );
};

export type Candidate = {
  step: PipelineStep;
  /** 4 wrote into the step's folder, 3 its task named the folder, 2 its description named the step, 1 agent name, 0 time only. */
  tier: number;
  level: number;
  fit: number;
  fitSlack: number;
  windowKey: string;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Every step one subagent could have worked for, best first. Signals: it wrote into the step's
 * output folder; its task prompt named the step's folder; its description named the step; the
 * declared agent name; and, before all of these, how much of its life fell inside one pass window
 * of the step — a step's own agent lives inside its pass, a reader of the step's files runs after
 * it. Human steps never match. Pass-window ownership is the caller's business.
 */
export const rankSteps = (
  run: PipelineRun,
  fact: ActorFact | undefined,
  interval: Interval | null,
  pinnedSteps: ReadonlySet<string>,
): Candidate[] => {
  const open: PipelineStep[] = agentSteps(run).filter(
    (s: PipelineStep): boolean => !pinnedSteps.has(s.name),
  );
  const nameDiscriminates: boolean =
    new Set<string>(open.map((s: PipelineStep): string => s.agent)).size > 1;
  const refFolders: string[] = (fact?.refs ?? []).flatMap((r: string): string[] =>
    runFoldersOf(r, run),
  );
  const writeFolders: string[] = (fact?.writes ?? []).flatMap((w: string): string[] =>
    runFoldersOf(w, run),
  );
  return open
    .map((step: PipelineStep): Candidate | null => {
      const wrote: boolean = writeFolders.some((f: string): boolean => folderIsStep(f, step));
      const named: boolean = refFolders.some((f: string): boolean => folderIsStep(f, step));
      // A one-word step name ("review") is too common a word in a description to count.
      const described: boolean = step.name.includes("-") && wordIn(step.name, fact?.description);
      const nameHit: boolean = nameDiscriminates && fact?.name === step.agent;
      const tier: number = wrote ? 4 : named ? 3 : described ? 2 : nameHit ? 1 : 0;
      const f: Fit = bestWindow(step, interval);
      const hasWindows: boolean = stepIntervals(step).length > 0;
      const eligible: boolean =
        tier >= 2
          ? !interval || !hasWindows || f.fitSlack > 0
          : tier === 1
            ? f.fitSlack > 0
            : f.fitSlack >= WINDOW_ONLY_MIN_FIT;
      if (!eligible) return null;
      return {
        step,
        tier,
        level: fitLevel(f),
        fit: round2(f.fit),
        fitSlack: round2(f.fitSlack),
        windowKey: `${step.name}#${f.index}`,
      };
    })
    .filter((c: Candidate | null): c is Candidate => c !== null)
    .sort(
      (a: Candidate, b: Candidate): number =>
        b.level - a.level ||
        b.tier - a.tier ||
        b.fit - a.fit ||
        b.fitSlack - a.fitSlack ||
        a.step.order - b.step.order,
    );
};

const attributionOf = (tier: number): StepAttribution =>
  tier === 4 ? "output-file" : tier >= 2 ? "prompt-ref" : tier === 1 ? "agent+window" : "window";

const ATTRIBUTION_RANK: Record<StepAttribution, number> = {
  "session-id": 5,
  "output-file": 4,
  "prompt-ref": 3,
  "agent+window": 2,
  window: 1,
  none: 0,
};

/**
 * Attributes usage from any number of provider sessions to one pipeline run. In order:
 *   the session id the run recorded for a step (exact — the step ran in that session),
 *   the session id the run recorded for itself (exact — the orchestrator; its subagents are then
 *   split over the steps: output folder written > folder or step named in the task > agent name +
 *   pass window > pass window; nested subagents inherit the nearest attributed ancestor, at any
 *   depth), main-harness usage → orchestrator, harnesses without subagent identity → steps by window.
 * Nothing is ever forced onto a step: unmatched usage inside the run window stays `unattributed`.
 * A run that named its own sessions takes nothing else: someone else's session that merely
 * overlapped it in the same folder is not this run's cost.
 */
export const attributeRunCost = (
  run: PipelineRun,
  sessions: SessionBundle[],
  now: string,
  claims: SessionClaims = new Map<string, string>(),
): FactoryRunCost => {
  nowMs = ms(now);
  const runFrom: number = ms(run.startedAt);
  const runTo: number = OPEN_STATUSES.has(run.status) ? nowMs : ms(run.endedAt);
  const notes: string[] = [];
  const stepEvents: Map<string, UsageEvent[]> = new Map<string, UsageEvent[]>(
    run.steps.map((s): [string, UsageEvent[]] => [s.name, []]),
  );
  const stepActors: Map<string, StepActorRef[]> = new Map<string, StepActorRef[]>(
    run.steps.map((s): [string, StepActorRef[]] => [s.name, []]),
  );
  const stepAttribution: Map<string, StepAttribution> = new Map<string, StepAttribution>();
  const orchestrator: UsageEvent[] = [];
  const unattributed: UsageEvent[] = [];
  const linked: LinkedSession[] = [];

  if (!Number.isFinite(runFrom) || !Number.isFinite(runTo)) {
    notes.push("run has no start/end timestamps; nothing can be attributed by time");
  }

  const { pinned, own } = sessionOwnership(run);
  const ownRun: Set<string> = new Set<string>(run.sessionIds);
  const pinnedSteps: Set<string> = new Set<string>(pinned.values());
  const namedSessions: boolean = pinned.size > 0 || ownRun.size > 0;

  const noteAttribution = (step: string, attribution: StepAttribution): void => {
    const current: StepAttribution | undefined = stepAttribution.get(step);
    if (!current || ATTRIBUTION_RANK[attribution] > ATTRIBUTION_RANK[current])
      stepAttribution.set(step, attribution);
  };

  for (const session of sessions) {
    const keys: string[] = sessionKeys(session);
    const isOwnStep: boolean = keys.some((key: string): boolean => own.has(key));
    const isOwnRun: boolean = keys.some((key: string): boolean => ownRun.has(key));
    const ownedElsewhere: boolean =
      !isOwnStep &&
      !isOwnRun &&
      keys.some((key: string): boolean => {
        const owner: string | undefined = claims.get(key);
        return owner !== undefined && owner !== run.runId;
      });
    if (ownedElsewhere) continue; // another run recorded this session as its own
    if (!isOwnStep && !isOwnRun && namedSessions) continue; // this run named its sessions; not one of them

    const additive: UsageEvent[] = session.events.filter(isAdditive);
    const pinnedStep: string | undefined = keys.reduce(
      (found: string | undefined, key: string): string | undefined => found ?? pinned.get(key),
      undefined,
    );
    if (pinnedStep !== undefined) {
      if (additive.length === 0) continue;
      // The whole session is that step: its own calls and any subagent it spawned, window or not.
      stepEvents.get(pinnedStep)?.push(...additive);
      stepAttribution.set(pinnedStep, "session-id");
      const facts: Map<string, ActorFact> = new Map<string, ActorFact>(
        session.actors.map((a: ActorFact): [string, ActorFact] => [a.id, a]),
      );
      const refs: StepActorRef[] = stepActors.get(pinnedStep) ?? [];
      Array.from(
        new Set<string>(
          additive.map(
            (e: UsageEvent): string =>
              e.actor.id ?? (e.actor.kind === "main" ? MAIN_ACTOR_ID : "unknown"),
          ),
        ),
      ).forEach((id: string): void => {
        const fact: ActorFact | undefined = facts.get(id);
        refs.push({
          provider: session.provider,
          sessionRunId: session.runId,
          id,
          ...(fact?.name ? { name: fact.name } : {}),
          kind: fact?.kind ?? (id === MAIN_ACTOR_ID ? "main" : "subagent"),
        });
      });
      linked.push({
        provider: session.provider,
        sessionRunId: session.runId,
        ...(session.run?.providerSessionId
          ? { providerSessionId: session.run.providerSessionId }
          : {}),
        linkedBy: "state-session-id",
        requestCount: additive.length,
      });
      continue;
    }

    const inWindow: UsageEvent[] = additive.filter((e: UsageEvent): boolean =>
      within(ms(e.timestamp), runFrom, runTo, RUN_SLACK_MS),
    );
    if (
      !isOwnRun &&
      inWindow.length === 0 &&
      !session.actors.some((a: ActorFact): boolean => refsMentionRun(mentions(a), run))
    )
      continue;
    if (isOwnRun && additive.length === 0) continue;

    const facts: Map<string, ActorFact> = new Map<string, ActorFact>(
      session.actors.map((a): [string, ActorFact] => [a.id, a]),
    );
    const byActor: Map<string, UsageEvent[]> = new Map<string, UsageEvent[]>();
    additive.forEach((e: UsageEvent): void => {
      const id: string = e.actor.id ?? (e.actor.kind === "main" ? MAIN_ACTOR_ID : "unknown");
      byActor.set(id, [...(byActor.get(id) ?? []), e]);
    });
    const subagentIds: string[] = Array.from(
      new Set<string>([...facts.keys(), ...byActor.keys()]),
    ).filter((id: string): boolean => id !== MAIN_ACTOR_ID);
    const hasSubagents: boolean = subagentIds.length > 0;
    const intervalOf = (id: string): Interval | null =>
      actorInterval(facts.get(id), byActor.get(id) ?? []);

    const assigned: Map<string, StepMatch> = new Map<string, StepMatch>();
    /** Subagents that drove several steps (a factory run from inside a subagent): orchestration, not a step. */
    const coordinators: Set<string> = new Set<string>();
    /** One owner per pass window: the first subagent the evidence put there. Its descendants may share it. */
    const owners: Map<string, { id: string; tier: number }> = new Map<
      string,
      { id: string; tier: number }
    >();
    let linkedBy: LinkedSession["linkedBy"] | null = isOwnRun ? "state-session-id" : null;
    let foreign = 0;
    let lateWriters = 0;
    let readersOnly = 0;
    const parentOf = (id: string): string | undefined => {
      const parent: string | undefined = facts.get(id)?.parentId;
      return parent !== undefined && parent !== MAIN_ACTOR_ID && facts.has(parent)
        ? parent
        : undefined;
    };
    const isDescendantOf = (id: string, ancestor: string): boolean => {
      const seen: Set<string> = new Set<string>();
      let cursor: string | undefined = parentOf(id);
      while (cursor !== undefined && !seen.has(cursor)) {
        if (cursor === ancestor) return true;
        seen.add(cursor);
        cursor = parentOf(cursor);
      }
      return false;
    };
    /**
     * Whose work an actor is, from its own paths. What it wrote decides; what it read only counts
     * when it wrote nothing decisive (a step of another run may read this run's files as input).
     * An actor with no verdict of its own takes the nearest ancestor's: a subtree belongs together.
     */
    const ownVerdict = (id: string): "mine" | "other" | undefined => {
      const fact: ActorFact | undefined = facts.get(id);
      const writes: string[] = fact?.writes ?? [];
      const refs: string[] = fact?.refs ?? [];
      if (refsMentionRun(writes, run) || touchesRun(writes, run)) return "mine";
      if (refsMentionOtherRun(writes, run) || worksElsewhere(writes, run)) return "other";
      // Reading is weaker evidence: only another run named outright counts (a task may read a
      // knowledge or example folder that merely looks like a step).
      if (refsMentionOtherRun(refs, run) && !refsMentionRun(refs, run)) return "other";
      if (refsMentionRun(refs, run) || touchesRun(refs, run)) return "mine";
      return undefined;
    };
    const verdicts: Map<string, "mine" | "other" | undefined> = new Map<
      string,
      "mine" | "other" | undefined
    >(
      subagentIds.map((id: string): [string, "mine" | "other" | undefined] => [id, ownVerdict(id)]),
    );
    const verdictOf = (id: string): "mine" | "other" | undefined => {
      const seen: Set<string> = new Set<string>();
      let cursor: string | undefined = id;
      while (cursor !== undefined && !seen.has(cursor)) {
        const own: "mine" | "other" | undefined = verdicts.get(cursor);
        if (own !== undefined) return own;
        seen.add(cursor);
        cursor = parentOf(cursor);
      }
      return undefined;
    };
    const eligible: string[] = subagentIds.filter((id: string): boolean => {
      const verdict: "mine" | "other" | undefined = verdictOf(id);
      if (verdict === "other") {
        foreign += 1; // another run's work (its own paths say so, or its ancestor's)
        return false;
      }
      const interval: Interval | null = intervalOf(id);
      return !(
        interval &&
        verdict !== "mine" &&
        !within(interval.from, runFrom, runTo, RUN_SLACK_MS)
      ); // outside this run
    });
    /** Spawned by the main conversation or by a coordinator: one of the steps' own agents, if anything. */
    const isTopLevel = (id: string): boolean => {
      const parent: string | undefined = parentOf(id);
      return parent === undefined || coordinators.has(parent);
    };
    /**
     * The candidate an actor may take under the ownership rule: a window nobody owns, or one that
     * its own ancestor or descendant owns (one agent tree works inside one step); never one an
     * unrelated actor owns.
     */
    const allowed =
      (id: string, minTier: number, maxTier: number) =>
      (c: Candidate): boolean => {
        if (c.tier < minTier || c.tier > maxTier) return false;
        const owner: { id: string; tier: number } | undefined = owners.get(c.windowKey);
        return owner === undefined || isDescendantOf(id, owner.id) || isDescendantOf(owner.id, id);
      };
    const take = (id: string, c: Candidate): void => {
      assigned.set(id, {
        step: c.step,
        attribution: attributionOf(c.tier),
        windowKey: c.windowKey,
      });
      if (!owners.has(c.windowKey)) owners.set(c.windowKey, { id, tier: c.tier });
      if (!isOwnRun) {
        if (c.tier >= 2) linkedBy = "actor-refs";
        else if (!linkedBy) linkedBy = "actor-window";
      }
    };
    /**
     * Greedy over every open actor: the strongest (time fit, then evidence) pair in the whole
     * session is assigned first, so a pass's own agent claims its window before a reader of the
     * step's files that merely overlapped it.
     */
    const assignGreedy = (ids: string[], minTier: number, maxTier: number): void => {
      for (;;) {
        let best: { id: string; c: Candidate; start: number } | null = null;
        for (const id of ids) {
          if (assigned.has(id) || coordinators.has(id)) continue;
          const c: Candidate | undefined = rankSteps(
            run,
            facts.get(id),
            intervalOf(id),
            pinnedSteps,
          ).find(allowed(id, minTier, maxTier));
          if (!c) continue;
          const start: number = intervalOf(id)?.from ?? Number.MAX_SAFE_INTEGER;
          const better: boolean =
            !best ||
            c.level > best.c.level ||
            (c.level === best.c.level &&
              (c.tier > best.c.tier ||
                (c.tier === best.c.tier &&
                  (c.fit > best.c.fit || (c.fit === best.c.fit && start < best.start)))));
          if (better) best = { id, c, start };
        }
        if (!best) return;
        take(best.id, best.c);
      }
    };
    /**
     * An actor whose own children were matched to two or more different steps, and that lived
     * through at least half of the run, is driving the run, not doing a step.
     */
    const markCoordinators = (): void => {
      const runSpan: number = Math.max(1, runTo - runFrom);
      subagentIds.forEach((id: string): void => {
        if (assigned.has(id)) return;
        const interval: Interval | null = intervalOf(id);
        if (!interval || overlapMs(interval, { from: runFrom, to: runTo }) / runSpan < 0.5) return;
        const childSteps: Set<string> = new Set<string>(
          subagentIds
            .filter((child: string): boolean => parentOf(child) === id)
            .map((child: string): string | undefined => assigned.get(child)?.step.name)
            .filter((name: string | undefined): name is string => name !== undefined),
        );
        if (childSteps.size >= 2) {
          coordinators.add(id);
          notes.push(
            `subagent ${facts.get(id)?.description ?? id} drove ${childSteps.size} steps: counted as orchestrator`,
          );
        }
      });
    };
    /** The nearest attributed ancestor, walking the parent chain to any depth; a coordinator ends the walk. */
    const inheritedMatch = (id: string): StepMatch | undefined => {
      const seen: Set<string> = new Set<string>();
      let parent: string | undefined = parentOf(id);
      while (parent !== undefined && !seen.has(parent) && !coordinators.has(parent)) {
        seen.add(parent);
        const match: StepMatch | undefined = assigned.get(parent);
        if (match) return match;
        parent = parentOf(parent);
      }
      return undefined;
    };
    const inherit = (): void => {
      subagentIds.forEach((id: string): void => {
        if (assigned.has(id) || coordinators.has(id)) return;
        const match: StepMatch | undefined = inheritedMatch(id);
        if (match) assigned.set(id, match);
      });
    };
    // 1. Hard evidence at any depth: the files a subagent wrote, the folders or step its task named.
    assignGreedy(eligible, 2, 4);
    // 2. A subagent whose children went to different steps is a coordinator: its usage is orchestration.
    markCoordinators();
    // 3. Top-level subagents by agent name and pass window (free windows only); nested ones inherit the
    //    nearest attributed ancestor; a nested agent with no attributed ancestor tries on its own.
    assignGreedy(eligible.filter(isTopLevel), 0, 1);
    inherit();
    assignGreedy(eligible, 0, 1);
    inherit();
    if (foreign > 0)
      notes.push(`${foreign} subagent(s) in this session worked for another run and were left out`);

    if (!linkedBy) {
      if (session.perAgentUsage) continue; // this harness names its subagents and none belong to this run
      // harness without subagent identity: its own usage during a step window is that step's work
      const anyStepOverlap: boolean = inWindow.some((e: UsageEvent): boolean =>
        agentSteps(run).some(
          (s: PipelineStep): boolean =>
            !pinnedSteps.has(s.name) &&
            stepIntervals(s).some((si) => within(ms(e.timestamp), si.from, si.to, STEP_SLACK_MS)),
        ),
      );
      if (!anyStepOverlap) continue;
      linkedBy = "window-only";
    }

    const provider: Provider = session.provider;
    linked.push({
      provider,
      sessionRunId: session.runId,
      ...(session.run?.providerSessionId
        ? { providerSessionId: session.run.providerSessionId }
        : {}),
      linkedBy,
      requestCount: inWindow.length,
    });

    byActor.forEach((events: UsageEvent[], id: string): void => {
      if (id === MAIN_ACTOR_ID) {
        events
          .filter((e: UsageEvent): boolean => within(ms(e.timestamp), runFrom, runTo, RUN_SLACK_MS))
          .forEach((e: UsageEvent): void => {
            if (hasSubagents) {
              orchestrator.push(e);
              return;
            }
            const t: number = ms(e.timestamp);
            const step: PipelineStep | undefined = agentSteps(run).find(
              (s: PipelineStep): boolean =>
                !pinnedSteps.has(s.name) &&
                stepIntervals(s).some((si) => within(t, si.from, si.to, STEP_SLACK_MS)),
            );
            if (!step) {
              orchestrator.push(e);
              return;
            }
            stepEvents.get(step.name)?.push(e);
            noteAttribution(step.name, "window");
            const refs: StepActorRef[] = stepActors.get(step.name) ?? [];
            if (!refs.some((r) => r.sessionRunId === session.runId && r.id === MAIN_ACTOR_ID)) {
              refs.push({ provider, sessionRunId: session.runId, id: MAIN_ACTOR_ID, kind: "main" });
            }
          });
        return;
      }
      const match: StepMatch | undefined = assigned.get(id);
      const fact: ActorFact | undefined = facts.get(id);
      if (coordinators.has(id)) {
        orchestrator.push(
          ...events.filter((e: UsageEvent): boolean =>
            within(ms(e.timestamp), runFrom, runTo, RUN_SLACK_MS),
          ),
        );
        return;
      }
      if (match) {
        stepEvents.get(match.step.name)?.push(...events);
        noteAttribution(match.step.name, match.attribution);
        stepActors.get(match.step.name)?.push({
          provider,
          sessionRunId: session.runId,
          id,
          ...(fact?.name ? { name: fact.name } : {}),
          kind: fact?.kind ?? "subagent",
        });
        return;
      }
      if (!eligible.includes(id)) return;
      const interval: Interval | null = actorInterval(fact, events);
      const wroteHere: boolean = touchesRun(fact?.writes ?? [], run);
      const readOnly: boolean = !wroteHere && (fact?.refs ?? []).length > 0;
      if (readOnly) {
        // Named this run's files but wrote nothing into them and fitted no pass: a reader from
        // elsewhere (another run's step taking this run's output as input), not this run's work.
        readersOnly += 1;
        return;
      }
      if (interval && within(interval.from, runFrom, runTo, RUN_SLACK_MS)) {
        unattributed.push(...events);
        notes.push(
          `actor ${fact?.name ?? id} (${provider}) ran inside the window but matched no step`,
        );
      } else if (wroteHere) {
        // Wrote into this run's folders outside its recorded window: an earlier attempt in the same
        // folder, or work after the run closed. Counted, visibly, not pinned to a step it did not run in.
        unattributed.push(...events);
        lateWriters += 1;
      }
    });
    if (lateWriters > 0)
      notes.push(
        `${lateWriters} subagent(s) wrote into this run's folders outside its window (an earlier attempt in the same folder?): counted as unattributed`,
      );
    if (readersOnly > 0)
      notes.push(
        `${readersOnly} subagent(s) only read this run's files and fitted no pass window: left out`,
      );
  }

  const steps: StepCost[] = run.steps.map((s: PipelineStep): StepCost => {
    const events: UsageEvent[] = stepEvents.get(s.name) ?? [];
    return {
      step: s.name,
      order: s.order,
      agent: s.agent,
      status: s.status,
      passes: s.passes,
      ...(s.startedAt ? { startedAt: s.startedAt } : {}),
      ...(s.endedAt ? { endedAt: s.endedAt } : {}),
      ...(s.durationSeconds !== undefined ? { durationSeconds: s.durationSeconds } : {}),
      attribution: events.length > 0 ? (stepAttribution.get(s.name) ?? "window") : "none",
      actors: stepActors.get(s.name) ?? [],
      models: modelsOf(events),
      cost: blockFromEvents(events),
    };
  });
  const all: UsageEvent[] = [
    ...orchestrator,
    ...unattributed,
    ...run.steps.flatMap((s) => stepEvents.get(s.name) ?? []),
  ];
  const missing: string[] = steps
    .filter((s) => s.agent !== "human" && s.status === "completed" && s.cost.requestCount === 0)
    .map((s) => s.step);
  if (missing.length > 0) notes.push(`completed steps with no usage found: ${missing.join(", ")}`);

  return {
    schemaVersion: "1",
    generatedAt: now,
    runId: run.runId,
    pipeline: run.pipeline,
    runDir: run.runDir,
    runFolder: run.runFolder,
    status: run.status,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.endedAt ? { endedAt: run.endedAt } : {}),
    ...(run.durationSeconds !== undefined ? { durationSeconds: run.durationSeconds } : {}),
    params: run.params,
    providers: Array.from(new Set<Provider>(linked.map((l) => l.provider))),
    sessions: linked,
    totals: blockFromEvents(all),
    orchestrator: blockFromEvents(orchestrator),
    steps,
    unattributed: blockFromEvents(unattributed),
    notes: Array.from(new Set<string>(notes)),
  };
};
