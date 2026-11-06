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

/**
 * What the any-factory runner records today: one orchestrator session (its id in PIPELINE_INIT),
 * every pass as STEP_START/STEP_EVENT in the run history, output folders that need not carry the
 * step's name, and subagents nested several levels deep.
 */
const R = (m: number, s = 0): string => new Date(Date.UTC(2026, 10, 1, 15, m, s)).toISOString();
const kpState = {
  pipelineName: "kp",
  status: "COMPLETED",
  createdAt: R(0),
  updatedAt: R(16),
  steps: {
    "prepare-kp": {
      order: 2,
      agent: "general-purpose",
      status: "COMPLETED",
      startedAt: R(0),
      completedAt: R(4),
      outputs: ["2-prepare-kp/fields.json"],
      passes: 1,
    },
    "check-facts": {
      order: 3,
      agent: "general-purpose",
      status: "COMPLETED",
      startedAt: R(4),
      completedAt: R(6),
      outputs: ["3-check-facts/edit-report-1.md"],
      passes: 1,
    },
    "build-demo": {
      order: 7,
      agent: "general-purpose",
      status: "COMPLETED",
      startedAt: R(12),
      completedAt: R(14),
      outputs: ["7-brand/*", "7-build-demo/index.html"],
      passes: 2,
    },
    "verify-demo-landing": {
      order: 8,
      agent: "general-purpose",
      status: "COMPLETED",
      startedAt: R(14),
      completedAt: R(16),
      outputs: ["7-verify-demo/report-1.md", "7-verify-demo/report-2.md"],
      passes: 2,
    },
    "review-gaps": {
      order: 5,
      agent: "human",
      status: "COMPLETED",
      startedAt: R(6),
      completedAt: R(10),
    },
  },
  history: [
    { timestamp: R(0), type: "PIPELINE_INIT", message: "", details: { sessionId: "orch" } },
    { timestamp: R(0), type: "STEP_START", step: "prepare-kp", message: "" },
    {
      timestamp: R(4),
      type: "STEP_EVENT",
      step: "prepare-kp",
      message: "",
      details: { event: "DONE" },
    },
    { timestamp: R(4), type: "STEP_START", step: "check-facts", message: "" },
    {
      timestamp: R(6),
      type: "STEP_EVENT",
      step: "check-facts",
      message: "",
      details: { event: "PASS" },
    },
    { timestamp: R(6), type: "STEP_START", step: "review-gaps", message: "" },
    { timestamp: R(10), type: "HUMAN_ANSWER", step: "review-gaps", message: "" },
    { timestamp: R(6), type: "STEP_START", step: "build-demo", message: "" },
    {
      timestamp: R(10),
      type: "STEP_EVENT",
      step: "build-demo",
      message: "",
      details: { event: "DONE" },
    },
    { timestamp: R(10), type: "STEP_START", step: "verify-demo-landing", message: "" },
    {
      timestamp: R(12),
      type: "STEP_EVENT",
      step: "verify-demo-landing",
      message: "",
      details: { event: "REVISE" },
    },
    { timestamp: R(12), type: "STEP_START", step: "build-demo", message: "", details: { pass: 2 } },
    {
      timestamp: R(14),
      type: "STEP_EVENT",
      step: "build-demo",
      message: "",
      details: { event: "DONE" },
    },
    {
      timestamp: R(14),
      type: "STEP_START",
      step: "verify-demo-landing",
      message: "",
      details: { pass: 2 },
    },
    {
      timestamp: R(16),
      type: "STEP_EVENT",
      step: "verify-demo-landing",
      message: "",
      details: { event: "DONE" },
    },
    { timestamp: R(16), type: "PIPELINE_COMPLETE", message: "" },
  ],
};
const kpDir = "/f/run/kp/acme-2026-11-01";
const kpRun = parsePipelineState(kpState, {
  root: "/f",
  runDir: kpDir,
  stateFile: `${kpDir}/state.json`,
  pipeline: { steps: { "verify-demo-landing": { output: ["7-verify-demo/report-*.md"] } } },
});

const kpActor = (
  id: string,
  from: number,
  to: number,
  extra: Partial<ActorFact> = {},
  runId = "anthropic-claude:orch",
): ActorFact => ({
  runId,
  provider: "anthropic-claude",
  id,
  kind: "subagent",
  name: "general-purpose",
  parentId: "main",
  startedAt: R(from, 5),
  endedAt: R(to, -5),
  ...extra,
});
const kpEv = (
  key: string,
  actor: string,
  minute: number,
  tokens: number,
  model: string,
  runId = "anthropic-claude:orch",
) =>
  makeEvent({
    key,
    timestamp: R(minute, 30),
    run: { runId, providerSessionId: runId.split(":")[1] as string, project: "/f" },
    actor: actor === "main" ? { kind: "main", id: "main" } : { kind: "subagent", id: actor },
    model: { reported: model },
    usage: { scope: "request", inputTokens: tokens, outputTokens: 0, totalTokens: tokens },
    billing: {
      mode: "subscription",
      certainty: "local-estimate",
      estimatedListPriceUsd: tokens / 1e6,
    },
  });

describe("reading the runner's state", () => {
  it("rebuilds every pass window from the run history, the run's own session id, and output folders from outputs and the pipeline snapshot", () => {
    const step = (n: string) => kpRun!.steps.find((s) => s.name === n)!;
    expect(kpRun?.sessionIds).toEqual(["orch"]);
    expect(step("build-demo").windows).toEqual([
      { from: R(6), to: R(10) },
      { from: R(12), to: R(14) },
    ]);
    expect(step("verify-demo-landing").windows).toHaveLength(2);
    expect(step("build-demo").outputFolders).toEqual(["7-brand", "7-build-demo"]);
    expect(step("verify-demo-landing").outputFolders).toEqual(["7-verify-demo"]);
    expect(sessionClaims([kpRun!]).size).toBe(0); // a run-level id is not a step claim
  });
});

describe("attribution inside one orchestrator session", () => {
  const orchRun = sessionRun("orch");
  const actors: ActorFact[] = [
    // prepare-kp: its task lists the NEXT step's folder as an input (the loop's feedback file)
    kpActor("prep", 0, 4, {
      description: "prepare-kp for acme",
      refs: [
        "run/kp/acme-2026-11-01",
        "1-get-lead/lead.json",
        "3-check-facts/edit-report-*.md",
        "2-prepare-kp/fields.json",
      ],
      writes: [`${kpDir}/2-prepare-kp/fields.json`],
    }),
    // check-facts edits the previous step's file as well as writing its own report
    kpActor("check", 4, 6, {
      description: "check-facts for acme",
      refs: ["2-prepare-kp/fields.json", "3-check-facts/edit-report-1.md"],
      writes: [`${kpDir}/3-check-facts/edit-report-1.md`, `${kpDir}/2-prepare-kp/fields.json`],
    }),
    kpActor("build1", 6, 10, {
      description: "build demo acme",
      refs: ["7-build-demo/index.html", "7-verify-demo/report-*.md"],
      writes: [`${kpDir}/7-build-demo/index.html`],
    }),
    // nested under build1 (depth 2) and under that (depth 3): neither names a step
    kpActor("brand", 7, 9, {
      parentId: "build1",
      description: "capture brand",
      writes: [`${kpDir}/7-brand/brand.json`],
    }),
    kpActor("brand-helper", 8, 9, { parentId: "brand", description: "screenshot" }),
    // verify pass 1: the folder it writes (7-verify-demo) does not carry the step's name, and its task
    // names the build folder it reads; no writes recorded
    kpActor("verify1", 10, 12, {
      description: "verify demo pass 1",
      refs: ["7-build-demo/index.html", "6-research/brief.md"],
    }),
    kpActor("build2", 12, 14, {
      description: "build demo revision",
      refs: ["7-build-demo/index.html", "7-verify-demo/report-1.md"],
      writes: [`${kpDir}/7-build-demo/index.html`],
    }),
    kpActor("verify2", 14, 16, {
      description: "verify demo pass 2",
      refs: ["7-build-demo/index.html"],
      writes: [`${kpDir}/7-verify-demo/report-2.md`],
    }),
  ];
  const events = [
    kpEv("m0", "main", 0, 100, "claude-opus-5-5"),
    kpEv("m1", "main", 15, 100, "claude-opus-5-5"),
    kpEv("m2", "main", 25, 100, "claude-opus-5-5"), // after the run (+3 min slack): not the run's
    kpEv("p1", "prep", 1, 1000, "claude-sonnet-5-5"),
    kpEv("c1", "check", 5, 500, "claude-sonnet-5-5"),
    kpEv("b1", "build1", 7, 2000, "claude-opus-5-5"),
    kpEv("br1", "brand", 8, 300, "claude-opus-5-5"),
    kpEv("bh1", "brand-helper", 8, 50, "claude-haiku-5-5"),
    kpEv("v1", "verify1", 11, 400, "claude-sonnet-5-5"),
    kpEv("b2", "build2", 13, 800, "claude-opus-5-5"),
    kpEv("v2", "verify2", 15, 200, "claude-sonnet-5-5"),
  ];
  // an interactive session in the same folder at the same time, with a subagent that even names a step folder
  const other: RunFact = sessionRun("chat");
  const otherActors: ActorFact[] = [
    kpActor("dev", 2, 9, { refs: ["2-prepare-kp/fields.json"] }, "anthropic-claude:chat"),
  ];
  const otherEvents = [
    kpEv("x1", "main", 3, 9000, "claude-opus-5-5", "anthropic-claude:chat"),
    kpEv("x2", "dev", 5, 9000, "claude-opus-5-5", "anthropic-claude:chat"),
  ];

  const sessions = bundleSessions(
    "/f",
    [...events, ...otherEvents],
    [...actors, ...otherActors],
    [orchRun, other],
  );
  const cost = attributeRunCost(kpRun!, sessions, R(60));
  const step = (n: string) => cost.steps.find((s) => s.step === n)!;

  it("links the orchestrator session by the id the run recorded and takes no other session", () => {
    expect(cost.sessions.map((s) => [s.providerSessionId, s.linkedBy])).toEqual([
      ["orch", "state-session-id"],
    ]);
    expect(cost.totals.totals.totalTokens).toBe(
      200 + 1000 + 500 + 2000 + 300 + 50 + 400 + 800 + 200,
    );
    expect(cost.orchestrator.totals.totalTokens).toBe(200);
    expect(cost.unattributed.requestCount).toBe(0);
  });

  it("gives a step its own agent even when the task names a later step's folder: the pass window decides", () => {
    expect(step("prepare-kp").cost.totals.totalTokens).toBe(1000);
    expect(step("prepare-kp").attribution).toBe("output-file");
    expect(step("check-facts").cost.totals.totalTokens).toBe(500);
  });

  it("finds a step whose output folder does not carry its name, and does not hand its agent to the step it read from", () => {
    expect(step("verify-demo-landing").cost.totals.totalTokens).toBe(400 + 200);
    expect(
      step("verify-demo-landing")
        .actors.map((a) => a.id)
        .sort(),
    ).toEqual(["verify1", "verify2"]);
    expect(
      step("build-demo")
        .actors.map((a) => a.id)
        .sort(),
    ).toEqual(["brand", "brand-helper", "build1", "build2"]);
  });

  it("nested subagents at any depth inherit the step of the nearest attributed ancestor", () => {
    expect(step("build-demo").cost.totals.totalTokens).toBe(2000 + 300 + 50 + 800);
    expect(step("review-gaps").cost.requestCount).toBe(0);
  });

  it("splits every block by model, from the usage records", () => {
    expect(step("build-demo").cost.byModel.map((m) => [m.model, m.totals.totalTokens])).toEqual([
      ["claude-opus-5-5", 3100],
      ["claude-haiku-5-5", 50],
    ]);
    expect(step("build-demo").models.sort()).toEqual(["claude-haiku-5-5", "claude-opus-5-5"]);
    expect(cost.orchestrator.byModel).toEqual([
      expect.objectContaining({ model: "claude-opus-5-5", requestCount: 2 }),
    ]);
    const sum = cost.totals.byModel.reduce((n, m) => n + m.totals.totalTokens, 0);
    expect(sum).toBe(cost.totals.totals.totalTokens);
  });
});

describe("a run driven from inside a subagent, readers from elsewhere, earlier attempts", () => {
  const twoStep = parsePipelineState(
    {
      pipelineName: "qr",
      status: "COMPLETED",
      createdAt: R(0),
      updatedAt: R(10),
      steps: {
        a: {
          order: 1,
          agent: "general-purpose",
          status: "COMPLETED",
          startedAt: R(0),
          completedAt: R(5),
          outputs: ["1-a/x.md"],
          passes: 1,
        },
        b: {
          order: 2,
          agent: "general-purpose",
          status: "COMPLETED",
          startedAt: R(5),
          completedAt: R(10),
          outputs: ["2-b/y.md"],
          passes: 1,
        },
      },
    },
    { root: "/f", runDir: "/f/run/qr/t-2026-11-01", stateFile: "s" },
  );
  const dir = "/f/run/qr/t-2026-11-01";
  const actors: ActorFact[] = [
    kpActor(
      "runner",
      0,
      10,
      { description: "run the qr factory", refs: ["run/qr/t-2026-11-01"] },
      "anthropic-claude:s",
    ),
    kpActor(
      "A",
      0,
      5,
      { parentId: "runner", description: "step a", writes: [`${dir}/1-a/x.md`] },
      "anthropic-claude:s",
    ),
    kpActor(
      "B",
      5,
      10,
      {
        parentId: "runner",
        description: "step b",
        refs: ["1-a/x.md"],
        writes: [`${dir}/2-b/y.md`],
      },
      "anthropic-claude:s",
    ),
    // another factory's step reading this run's output while b runs: wrote nothing here
    kpActor(
      "reader",
      6,
      9,
      {
        description: "KP step 7: demo buyer",
        refs: ["run/qr/t-2026-11-01", "1-a/x.md", "2-b/y.md"],
      },
      "anthropic-claude:s",
    ),
    // a step of another run in the same session, by the folders it wrote
    kpActor(
      "elsewhere",
      6,
      9,
      { description: "KP step 6", writes: ["6-calc-mediaplan/mediaplan.md"] },
      "anthropic-claude:s",
    ),
    // an earlier attempt in the same run folder, an hour before the recorded run
    kpActor(
      "early",
      -60,
      -55,
      { description: "step a", writes: [`${dir}/1-a/x.md`] },
      "anthropic-claude:s",
    ),
  ];
  const events = [
    kpEv("r1", "runner", 1, 100, "claude-opus-5-5", "anthropic-claude:s"),
    kpEv("r2", "runner", 7, 100, "claude-opus-5-5", "anthropic-claude:s"),
    kpEv("a1", "A", 2, 1000, "claude-sonnet-5-5", "anthropic-claude:s"),
    kpEv("b1", "B", 7, 2000, "claude-sonnet-5-5", "anthropic-claude:s"),
    kpEv("rd", "reader", 7, 5000, "claude-opus-5-5", "anthropic-claude:s"),
    kpEv("el", "elsewhere", 7, 7000, "claude-opus-5-5", "anthropic-claude:s"),
    kpEv("ea", "early", -58, 300, "claude-sonnet-5-5", "anthropic-claude:s"),
  ];
  const cost = attributeRunCost(
    twoStep!,
    bundleSessions("/f", events, actors, [sessionRun("s")]),
    R(60),
  );
  const step = (n: string) => cost.steps.find((s) => s.step === n)!;

  it("a subagent whose children did different steps is the orchestrator", () => {
    expect(step("a").cost.totals.totalTokens).toBe(1000);
    expect(step("b").cost.totals.totalTokens).toBe(2000);
    expect(cost.orchestrator.totals.totalTokens).toBe(200);
    expect(cost.notes).toContain(
      "subagent run the qr factory drove 2 steps: counted as orchestrator",
    );
  });

  it("leaves out a reader of this run's files that fitted no pass, and another run's step, both named in the notes", () => {
    expect(cost.notes).toContain(
      "1 subagent(s) only read this run's files and fitted no pass window: left out",
    );
    expect(cost.notes).toContain(
      "1 subagent(s) in this session worked for another run and were left out",
    );
    expect(cost.totals.totals.totalTokens).toBe(1000 + 2000 + 200 + 300);
  });

  it("counts an earlier attempt that wrote into the run folder as unattributed, not as a step", () => {
    expect(cost.unattributed.totals.totalTokens).toBe(300);
    expect(
      cost.notes.some((n) =>
        n.startsWith("1 subagent(s) wrote into this run's folders outside its window"),
      ),
    ).toBe(true);
  });
});
