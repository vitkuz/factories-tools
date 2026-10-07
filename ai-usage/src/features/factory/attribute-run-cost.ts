import type { ActorFact, Provider, UsageEvent } from "../../contract/usage-event.types.js";
import type {
  PipelineRun,
  PipelineStep,
} from "../../adapters/factory-state/factory-state.types.js";
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

type Interval = { from: number; to: number };
type StepMatch = { step: PipelineStep; attribution: StepAttribution };

const stepIntervals = (step: PipelineStep): Interval[] =>
  (step.windows.length === 0 && step.startedAt && OPEN_STATUSES.has(step.status)
    ? [{ from: step.startedAt, to: new Date(nowMs).toISOString() }]
    : step.windows
  )
    .map((w): Interval => ({ from: ms(w.from), to: ms(w.to) }))
    .filter((i: Interval): boolean => Number.isFinite(i.from) && Number.isFinite(i.to));

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

const overlapWith = (step: PipelineStep, interval: Interval | null, slackMs: number): number =>
  interval
    ? stepIntervals(step).reduce(
        (acc: number, si: Interval): number =>
          acc + overlapMs({ from: si.from - slackMs, to: si.to + slackMs }, interval),
        0,
      )
    : 0;

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

const STEP_REF = /(?:^|[\/\s"'`(])(\d{1,3})-([a-z][\w-]*)\//g;

/**
 * A subagent's prompt names the files it reads (outputs of EARLIER steps, lower folder numbers) and the
 * file it writes (its own folder, the highest number). Returns the referenced folder number for this step,
 * so the caller can pick the highest. Folder numbers are step indexes, never the wave `order`.
 */
const refScore = (refs: string[], step: PipelineStep): number =>
  refs.reduce((best: number, ref: string): number => {
    let score: number = best;
    for (const m of ref.matchAll(STEP_REF)) {
      if (m[2] === step.name) score = Math.max(score, Number(m[1]));
    }
    return score;
  }, 0);

const refsMentionRun = (refs: string[], run: PipelineRun): boolean =>
  refs.some(
    (r: string): boolean =>
      r.includes(`/${run.pipeline}/${run.runFolder}`) || r.endsWith(`/${run.runFolder}`),
  );

const refsMentionOtherRun = (refs: string[], run: PipelineRun): boolean =>
  refs.some(
    (r: string): boolean => /\brun\/[\w.-]+\/[\w.-]+/.test(r) && !r.includes(`/${run.runFolder}`),
  );

/**
 * Prompt references win (the harness told the subagent which output file to write), then the declared
 * agent name plus time overlap, then time overlap alone. Human steps never receive usage.
 * `claimed` holds steps already taken by a stronger match so parallel siblings do not pile onto one step.
 */
const matchStep = (
  run: PipelineRun,
  fact: ActorFact | undefined,
  interval: Interval | null,
  claimed: Set<string>,
  refsOnly: boolean,
  pinnedSteps: ReadonlySet<string>,
): StepMatch | null => {
  const open: PipelineStep[] = agentSteps(run).filter(
    (s: PipelineStep): boolean => !pinnedSteps.has(s.name),
  );
  const refs: string[] = fact?.refs ?? [];
  const byRef: PipelineStep[] = open
    .map((step: PipelineStep) => ({
      step,
      score: refScore(refs, step),
      overlap: overlapWith(step, interval, STEP_SLACK_MS),
      nameHit: fact?.name === step.agent ? 1 : 0,
    }))
    .filter((c) => c.score > 0)
    .sort(
      (a, b): number =>
        b.nameHit - a.nameHit ||
        b.score - a.score ||
        b.overlap - a.overlap ||
        b.step.order - a.step.order,
    )
    .map((c) => c.step);
  const refStep: PipelineStep | undefined = byRef[0];
  if (refStep) return { step: refStep, attribution: "prompt-ref" };
  if (refsOnly || !interval) return null;

  // The harness may run a step with an agent other than the declared one (Copilot "research" for a
  // general-purpose step); a name that matches no step is treated as unknown rather than as a veto.
  const nameKnown: boolean =
    Boolean(fact?.name) && open.some((s: PipelineStep): boolean => s.agent === fact?.name);
  const candidates: PipelineStep[] = nameKnown
    ? open.filter((s: PipelineStep): boolean => s.agent === fact?.name)
    : open;
  const scored: Array<{ step: PipelineStep; overlap: number; free: number }> = candidates
    .map((step: PipelineStep) => ({
      step,
      overlap: overlapWith(step, interval, 0),
      free: claimed.has(step.name) ? 0 : 1,
    }))
    .filter((c) => overlapWith(c.step, interval, STEP_SLACK_MS) > 0)
    .sort(
      (a, b): number => b.free - a.free || b.overlap - a.overlap || a.step.order - b.step.order,
    );
  const best = scored[0];
  if (!best) return null;
  const span: number = Math.max(1, interval.to - interval.from);
  if (!nameKnown && overlapWith(best.step, interval, STEP_SLACK_MS) / span < 0.5) return null;
  return { step: best.step, attribution: nameKnown ? "agent+window" : "window" };
};

/**
 * Attributes usage from any number of provider sessions to one pipeline run. In order:
 *   the session id the run recorded for a step (exact — the step ran in that session),
 *   then, for runs that recorded none, the guesses: subagent actors → steps (prompt refs >
 *   agent name + time overlap > time overlap), nested actors → their parent's step,
 *   main-harness usage → orchestrator, harnesses without subagent identity → steps by window.
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
  const pinnedSteps: Set<string> = new Set<string>(pinned.values());

  for (const session of sessions) {
    const keys: string[] = sessionKeys(session);
    const isOwn: boolean = keys.some((key: string): boolean => own.has(key));
    const ownedElsewhere: boolean =
      !isOwn &&
      keys.some((key: string): boolean => {
        const owner: string | undefined = claims.get(key);
        return owner !== undefined && owner !== run.runId;
      });
    if (ownedElsewhere) continue; // another run recorded this session as its own
    if (!isOwn && pinned.size > 0) continue; // this run named its sessions; this is not one of them

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
      inWindow.length === 0 &&
      !session.actors.some((a: ActorFact): boolean => refsMentionRun(a.refs ?? [], run))
    )
      continue;

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

    const assigned: Map<string, StepMatch> = new Map<string, StepMatch>();
    const claimed: Set<string> = new Set<string>();
    let linkedBy: LinkedSession["linkedBy"] | null = null;
    const eligible: string[] = subagentIds.filter((id: string): boolean => {
      const fact: ActorFact | undefined = facts.get(id);
      const refs: string[] = fact?.refs ?? [];
      if (refsMentionOtherRun(refs, run) && !refsMentionRun(refs, run)) return false; // belongs to a different run
      const interval: Interval | null = actorInterval(fact, byActor.get(id) ?? []);
      return !(
        interval &&
        !refsMentionRun(refs, run) &&
        !within(interval.from, runFrom, runTo, RUN_SLACK_MS)
      ); // outside this run
    });
    // round 1: prompt references. round 2: agent name / time windows for top-level actors only.
    // Nested actors then inherit their parent's step; whatever is still loose gets a window match last.
    const isNested = (id: string): boolean => {
      const parent: string | undefined = facts.get(id)?.parentId;
      return parent !== undefined && parent !== MAIN_ACTOR_ID && facts.has(parent);
    };
    const tryAssign = (id: string, refsOnly: boolean): void => {
      if (assigned.has(id)) return;
      const fact: ActorFact | undefined = facts.get(id);
      const interval: Interval | null = actorInterval(fact, byActor.get(id) ?? []);
      const match: StepMatch | null = matchStep(
        run,
        fact,
        interval,
        claimed,
        refsOnly,
        pinnedSteps,
      );
      if (!match) return;
      assigned.set(id, match);
      claimed.add(match.step.name);
      if (match.attribution === "prompt-ref") linkedBy = "actor-refs";
      else if (!linkedBy) linkedBy = "actor-window";
    };
    const inherit = (): void => {
      for (let round = 0; round < 6; round += 1) {
        subagentIds.forEach((id: string): void => {
          if (assigned.has(id)) return;
          const parent: string | undefined = facts.get(id)?.parentId;
          const parentMatch: StepMatch | undefined = parent ? assigned.get(parent) : undefined;
          if (parentMatch) assigned.set(id, parentMatch);
        });
      }
    };
    eligible.forEach((id: string): void => tryAssign(id, true));
    eligible
      .filter((id: string): boolean => !isNested(id))
      .forEach((id: string): void => tryAssign(id, false));
    inherit();
    eligible.forEach((id: string): void => tryAssign(id, false));
    inherit();

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
            if (!stepAttribution.has(step.name)) stepAttribution.set(step.name, "window");
            const refs: StepActorRef[] = stepActors.get(step.name) ?? [];
            if (!refs.some((r) => r.sessionRunId === session.runId && r.id === MAIN_ACTOR_ID)) {
              refs.push({ provider, sessionRunId: session.runId, id: MAIN_ACTOR_ID, kind: "main" });
            }
          });
        return;
      }
      const match: StepMatch | undefined = assigned.get(id);
      const fact: ActorFact | undefined = facts.get(id);
      if (match) {
        stepEvents.get(match.step.name)?.push(...events);
        const current: StepAttribution | undefined = stepAttribution.get(match.step.name);
        if (!current || (current !== "prompt-ref" && match.attribution === "prompt-ref"))
          stepAttribution.set(match.step.name, match.attribution);
        stepActors.get(match.step.name)?.push({
          provider,
          sessionRunId: session.runId,
          id,
          ...(fact?.name ? { name: fact.name } : {}),
          kind: fact?.kind ?? "subagent",
        });
        return;
      }
      const interval: Interval | null = actorInterval(fact, events);
      if (
        interval &&
        within(interval.from, runFrom, runTo, RUN_SLACK_MS) &&
        !refsMentionOtherRun(fact?.refs ?? [], run)
      ) {
        unattributed.push(...events);
        notes.push(
          `actor ${fact?.name ?? id} (${provider}) ran inside the window but matched no step`,
        );
      }
    });
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
