import type {
  ActorFact,
  CostCertainty,
  Provider,
  ProviderUnit,
  RunFact,
  UsageEvent,
} from "../../contract/usage-event.types.js";
import type { TokenTotals } from "../../contract/usage-summary.types.js";

/** One model's share of a block: which model did how much of the work, from the usage records. */
export type ModelCost = {
  model: string;
  requestCount: number;
  totals: TokenTotals;
  estimatedListPriceUsd?: number;
  unpricedTokens: number;
};

export type CostBlock = {
  requestCount: number;
  totals: TokenTotals;
  estimatedListPriceUsd?: number;
  reportedCostUsd?: number;
  billedUsd?: number;
  providerUnits: ProviderUnit[];
  certainty: CostCertainty;
  unpricedTokens: number;
  /** Per model, most tokens first. Sums to the block. */
  byModel: ModelCost[];
};

/**
 * How a step's usage was identified. `session-id` is the only one that is not a guess; `output-file`
 * (the subagent wrote into the step's output folder) is the strongest of the guesses, then
 * `prompt-ref` (its task named the folder), then the declared agent name plus the pass window, then
 * the pass window alone.
 */
export type StepAttribution =
  "session-id" | "output-file" | "prompt-ref" | "agent+window" | "window" | "none";

export type StepActorRef = {
  provider: Provider;
  sessionRunId: string;
  id: string;
  name?: string;
  kind: string;
};

export type StepCost = {
  step: string;
  order: number;
  agent: string;
  status: string;
  passes: number;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  attribution: StepAttribution;
  actors: StepActorRef[];
  models: string[];
  cost: CostBlock;
};

export type LinkedSession = {
  provider: Provider;
  sessionRunId: string;
  providerSessionId?: string;
  linkedBy: "state-session-id" | "actor-refs" | "actor-window" | "window-only";
  requestCount: number;
};

export type FactoryRunCost = {
  schemaVersion: "1";
  generatedAt: string;
  runId: string;
  pipeline: string;
  runDir: string;
  runFolder: string;
  status: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  params: Record<string, unknown>;
  providers: Provider[];
  sessions: LinkedSession[];
  totals: CostBlock;
  orchestrator: CostBlock;
  steps: StepCost[];
  /** Usage inside the run window from linked sessions that could not be tied to a step. */
  unattributed: CostBlock;
  notes: string[];
};

/**
 * Which pipeline run recorded which provider session id, across one factory root: `sessionId` →
 * `runId`. A session another run recorded is never attributed here, whatever the clock says.
 */
export type SessionClaims = ReadonlyMap<string, string>;

/** Everything one provider session contributes, pre-grouped by the caller. */
export type SessionBundle = {
  run: RunFact | undefined;
  runId: string;
  provider: Provider;
  project?: string;
  /** Whether this provider can name subagents at all (from adapter capabilities). Decides if time-only linking is allowed. */
  perAgentUsage: boolean;
  events: UsageEvent[];
  actors: ActorFact[];
};

export type FactoryState = {
  schemaVersion: "1";
  updatedAt: string;
  roots: string[];
  runs: FactoryRunCost[];
};
