import { describe, expect, it } from "vitest";
import { attributeRunCost, bundleSessions, sessionClaims } from "../src/features/factory/index.js";
import { parsePipelineState } from "../src/adapters/factory-state/index.js";
import type { ActorFact, RunFact } from "../src/contract/usage-event.types.js";
import type { SessionClaims } from "../src/features/factory/index.js";
import { makeEvent } from "./helpers.js";

const T = (m: number): string => new Date(Date.UTC(2026, 8, 1, 10, m)).toISOString();

const state = {
  pipelineName: "canonical-factory",
  status: "COMPLETED",
  createdAt: T(0),
  updatedAt: T(60),
  steps: {
    "fetch-ticket": {
      order: 1,
      agent: "clerk",
      status: "COMPLETED",
      startedAt: T(1),
      completedAt: T(3),
      outputs: ["1-fetch-ticket/ticket.md"],
      passes: 1,
    },
    "scout-backend": {
      order: 2,
      agent: "scout",
      status: "COMPLETED",
      startedAt: T(4),
      completedAt: T(14),
      outputs: ["2-scout-backend/backend-report.md"],
      passes: 1,
    },
    "scout-frontend": {
      order: 3,
      agent: "scout",
      status: "COMPLETED",
      startedAt: T(4),
      completedAt: T(15),
      outputs: ["3-scout-frontend/frontend-report.md"],
      passes: 1,
    },
    "verify-plan": {
      order: 4,
      agent: "human",
      status: "COMPLETED",
      startedAt: T(16),
      completedAt: T(40),
      outputs: [],
      passes: 1,
    },
    build: {
      order: 5,
      agent: "builder",
      status: "COMPLETED",
      startedAt: T(41),
      completedAt: T(58),
      outputs: ["5-build/changes.md"],
      passes: 1,
    },
  },
};
const run = parsePipelineState(state, {
  root: "/f",
  runDir: "/f/run/canonical-factory/feat-2026-09-01",
  stateFile: "/f/run/canonical-factory/feat-2026-09-01/.state.json",
});

const claudeRun: RunFact = {
  runId: "anthropic-claude:s1",
  provider: "anthropic-claude",
  providerSessionId: "s1",
  project: "/f",
  billingMode: "subscription",
};
const ev = (
  key: string,
  actor: string,
  minute: number,
  tokens = 1000,
  provider: "anthropic-claude" | "google-gemini" = "anthropic-claude",
  runId = "anthropic-claude:s1",
) =>
  makeEvent({
    key,
    provider,
    timestamp: T(minute),
    run: { runId, providerSessionId: runId.split(":")[1] as string, project: "/f" },
    actor: actor === "main" ? { kind: "main", id: "main" } : { kind: "subagent", id: actor },
    usage: { scope: "request", inputTokens: tokens, outputTokens: 0, totalTokens: tokens },
    billing: {
      mode: "subscription",
      certainty: "local-estimate",
      estimatedListPriceUsd: tokens / 1e6,
    },
  });

const actors: ActorFact[] = [
  {
    runId: "anthropic-claude:s1",
    provider: "anthropic-claude",
    id: "A",
    kind: "subagent",
    name: "clerk",
    parentId: "main",
    startedAt: T(1),
    endedAt: T(3),
    refs: ["run/canonical-factory/feat-2026-09-01", "1-fetch-ticket/ticket.md"],
  },
  {
    runId: "anthropic-claude:s1",
    provider: "anthropic-claude",
    id: "B",
    kind: "subagent",
    name: "scout",
    parentId: "main",
    startedAt: T(4),
    endedAt: T(14),
    refs: ["2-scout-backend/backend-report.md"],
  },
  {
    runId: "anthropic-claude:s1",
    provider: "anthropic-claude",
    id: "C",
    kind: "subagent",
    name: "scout",
    parentId: "main",
    startedAt: T(4),
    endedAt: T(15),
  }, // no refs: agent + window
  {
    runId: "anthropic-claude:s1",
    provider: "anthropic-claude",
    id: "C1",
    kind: "subagent",
    name: "general-purpose",
    parentId: "C",
    startedAt: T(6),
    endedAt: T(9),
  }, // nested → parent's step
  {
    runId: "anthropic-claude:s1",
    provider: "anthropic-claude",
    id: "Z",
    kind: "subagent",
    name: "scout",
    parentId: "main",
    startedAt: T(90),
    endedAt: T(95),
  }, // after the run
];

describe("factory attribution", () => {
  it("maps subagents to steps by prompt refs, agent+window, nesting; main → orchestrator; outside window excluded", () => {
    const events = [
      ev("m1", "main", 0, 500),
      ev("m2", "main", 20, 500),
      ev("m3", "main", 99, 500),
      ev("a1", "A", 2, 100),
      ev("b1", "B", 5, 2000),
      ev("b2", "B", 10, 2000),
      ev("c1", "C", 5, 3000),
      ev("c11", "C1", 7, 700),
      ev("z1", "Z", 91, 9000),
    ];
    const sessions = bundleSessions("/f", events, actors, [claudeRun]);
    const cost = attributeRunCost(run!, sessions, "now");
    const step = (n: string) => cost.steps.find((s) => s.step === n)!;
    expect(step("fetch-ticket").cost.totals.totalTokens).toBe(100);
    expect(step("fetch-ticket").attribution).toBe("prompt-ref");
    expect(step("scout-backend").cost.totals.totalTokens).toBe(4000);
    expect(step("scout-frontend").cost.totals.totalTokens).toBe(3700);
    expect(step("scout-frontend").attribution).toBe("agent+window");
    expect(step("verify-plan").cost.requestCount).toBe(0);
    expect(cost.orchestrator.totals.totalTokens).toBe(1000);
    expect(cost.totals.totals.totalTokens).toBe(100 + 4000 + 3700 + 1000);
    expect(cost.unattributed.requestCount).toBe(0);
    expect(cost.sessions[0]?.linkedBy).toBe("actor-refs");
    expect(cost.totals.estimatedListPriceUsd).toBeCloseTo(8800 / 1e6, 10);
  });

  it("a harness without subagent identity is attributed by step windows", () => {
    const gem: RunFact = {
      runId: "google-gemini:g1",
      provider: "google-gemini",
      providerSessionId: "g1",
      project: "/f",
      billingMode: "subscription",
    };
    const events = [
      ev("g1", "main", 2, 100, "google-gemini", "google-gemini:g1"),
      ev("g2", "main", 10, 200, "google-gemini", "google-gemini:g1"),
      ev("g3", "main", 30, 50, "google-gemini", "google-gemini:g1"),
    ];
    const cost = attributeRunCost(run!, bundleSessions("/f", events, [], [gem]), "now");
    expect(cost.sessions[0]?.linkedBy).toBe("window-only");
    expect(cost.steps.find((s) => s.step === "fetch-ticket")?.cost.totals.totalTokens).toBe(100);
    // minute 10 overlaps both scouts; first by order wins, attribution marked as window
    expect(cost.steps.find((s) => s.step === "scout-backend")?.attribution).toBe("window");
    expect(cost.orchestrator.totals.totalTokens).toBe(50); // minute 30: human step, no agent step → orchestrator
  });

  it("a session in the window with subagents that belong to another run is not linked", () => {
    const other: ActorFact[] = [
      {
        runId: "anthropic-claude:s1",
        provider: "anthropic-claude",
        id: "X",
        kind: "subagent",
        name: "scout",
        parentId: "main",
        startedAt: T(5),
        endedAt: T(12),
        refs: ["run/canonical-factory/other-run"],
      },
    ];
    const events = [ev("m1", "main", 5, 500), ev("x1", "X", 6, 700)];
    const cost = attributeRunCost(run!, bundleSessions("/f", events, other, [claudeRun]), "now");
    expect(cost.sessions).toHaveLength(0);
    expect(cost.totals.requestCount).toBe(0);
  });

  it("parses both state-file shapes", () => {
    const generic = parsePipelineState(
      {
        pipeline: "x",
        status: "done",
        startAt: "2026-09-02T14:34:52+00:00",
        endAt: "2026-09-02T17:17:43+00:00",
        durationSeconds: 9771,
        steps: {
          a: {
            index: 1,
            agent: "general-purpose",
            status: "done",
            startAt: "2026-09-02T14:36:20+00:00",
            endAt: "2026-09-02T14:48:35+00:00",
            history: [{ startAt: "2026-09-02T14:36:20+00:00", endAt: "2026-09-02T14:48:35+00:00" }],
          },
        },
      },
      { root: "/f", runDir: "/f/run/x/r", stateFile: "s" },
    );
    expect(generic?.startedAt).toBe("2026-09-02T14:34:52.000Z");
    expect(generic?.steps[0]?.windows).toHaveLength(1);
    expect(run?.steps.map((s) => s.name)).toEqual([
      "fetch-ticket",
      "scout-backend",
      "scout-frontend",
      "verify-plan",
      "build",
    ]);
  });
});

/**
 * What `pipeline-runner` writes: one headless process per step, so every step records the provider
 * session it ran in, and a step that looped records one session per pass in the history.
 */
const runnerState = {
  pipelineName: "harness-smoke",
  status: "COMPLETED",
  createdAt: T(0),
  updatedAt: T(30),
  steps: {
    one: {
      order: 1,
      agent: "general-purpose",
      status: "COMPLETED",
      startedAt: T(1),
      completedAt: T(5),
      sessionId: "p1",
      passes: 1,
    },
    two: {
      order: 2,
      agent: "general-purpose",
      status: "COMPLETED",
      startedAt: T(6),
      completedAt: T(9),
      sessionId: "p3",
      passes: 2,
    },
  },
  history: [
    { timestamp: T(5), type: "STEP_EVENT", step: "one", message: "", details: { sessionId: "p1" } },
    { timestamp: T(7), type: "STEP_EVENT", step: "two", message: "", details: { sessionId: "p2" } },
    { timestamp: T(9), type: "STEP_EVENT", step: "two", message: "", details: { sessionId: "p3" } },
  ],
};
const runnerRun = parsePipelineState(runnerState, {
  root: "/f",
  runDir: "/f/run/harness-smoke/smoke-2026-09-01",
  stateFile: "/f/run/harness-smoke/smoke-2026-09-01/state.json",
});

const sessionRun = (id: string, project: string | null = "/f"): RunFact => ({
  runId: `anthropic-claude:${id}`,
  provider: "anthropic-claude",
  providerSessionId: id,
  ...(project === null ? {} : { project }),
  billingMode: "subscription",
});

describe("attribution by the session id the run recorded", () => {
  const events = [
    ev("p1a", "main", 2, 100, "anthropic-claude", "anthropic-claude:p1"),
    ev("p2a", "main", 7, 200, "anthropic-claude", "anthropic-claude:p2"),
    ev("p3a", "main", 8, 400, "anthropic-claude", "anthropic-claude:p3"),
  ];
  const runs = [sessionRun("p1"), sessionRun("p2"), sessionRun("p3")];
  const claims = sessionClaims([runnerRun!]);
  const step = (cost: ReturnType<typeof attributeRunCost>, n: string) =>
    cost.steps.find((s) => s.step === n)!;

  it("gives each step its own session, and a looped step every pass it ran", () => {
    const cost = attributeRunCost(
      runnerRun!,
      bundleSessions("/f", events, [], runs, claims),
      "now",
      claims,
    );

    expect(step(cost, "one").cost.totals.totalTokens).toBe(100);
    expect(step(cost, "one").attribution).toBe("session-id");
    // pass 1 (p2) from the history, pass 2 (p3) from the step record
    expect(step(cost, "two").cost.totals.totalTokens).toBe(600);
    expect(cost.sessions.every((s) => s.linkedBy === "state-session-id")).toBe(true);
    expect(cost.orchestrator.requestCount).toBe(0);
    expect(cost.notes).toEqual([]);
  });

  it("leaves out a session that merely overlapped in the same folder", () => {
    const mine = ev("mine", "main", 4, 999999, "anthropic-claude", "anthropic-claude:interactive");
    const cost = attributeRunCost(
      runnerRun!,
      bundleSessions("/f", [...events, mine], [], [...runs, sessionRun("interactive")], claims),
      "now",
      claims,
    );

    expect(cost.totals.totals.totalTokens).toBe(700);
    expect(cost.sessions.map((s) => s.providerSessionId).sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("never takes a session another run recorded", () => {
    const theirs: SessionClaims = new Map<string, string>([["p2", "harness-smoke/other-run"]]);
    const cost = attributeRunCost(
      run!,
      bundleSessions("/f", events, [], runs, theirs),
      "now",
      theirs,
    );

    expect(cost.sessions.some((s) => s.providerSessionId === "p2")).toBe(false);
  });

  it("keeps a claimed session whose telemetry names no working directory", () => {
    // Antigravity records no cwd: without the claim these sessions belong to no factory root.
    const homeless = events.map((e) =>
      makeEvent({
        ...e,
        key: e.eventKey,
        run: { runId: e.run.runId, providerSessionId: e.run.providerSessionId as string },
      }),
    );
    const noProject = [sessionRun("p1", null), sessionRun("p2", null), sessionRun("p3", null)];

    expect(bundleSessions("/f", homeless, [], noProject)).toHaveLength(0);
    expect(
      attributeRunCost(
        runnerRun!,
        bundleSessions("/f", homeless, [], noProject, claims),
        "now",
        claims,
      ).totals.totals.totalTokens,
    ).toBe(700);
  });

  it("reads the ids from the step record and the history", () => {
    expect(runnerRun?.steps.map((s) => s.sessionIds)).toEqual([["p1"], ["p3", "p2"]]);
    expect(sessionClaims([runnerRun!]).get("p2")).toBe("harness-smoke/smoke-2026-09-01");
  });
});
