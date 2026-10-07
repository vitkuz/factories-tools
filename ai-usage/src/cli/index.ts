import { Command } from "commander";
import { createContainer, type Container } from "./container.js";
import { ingestUsage, rebuildState, repriceUsage } from "../features/ingest/index.js";
import {
  byCustomer,
  byDay,
  byProject,
  byProvider,
  filterRuns,
  formatGroupTable,
  formatRunSummary,
  formatRunsTable,
  type ReportFilter,
} from "../features/report/index.js";
import { runWrapped } from "../features/run/index.js";
import { addCustomerRule } from "../features/customers/index.js";
import {
  formatFactoryRun,
  formatFactoryRunsTable,
  refreshFactoryCosts,
  type FactoryRunCost,
  type FactoryState,
} from "../features/factory/index.js";
import path from "node:path";
import type { RunUsageSummary } from "../contract/usage-summary.types.js";
import type { UsageState } from "../storage/usage-store.js";
import { logger } from "../shared/utils/logger.js";

const providerAlias: Record<string, string> = {
  claude: "anthropic-claude",
  codex: "openai-codex",
  copilot: "github-copilot",
  antigravity: "google-antigravity",
  agy: "google-antigravity",
};

const parseProviders = (value: string | undefined): string[] | undefined =>
  value ? value.split(",").map((v: string): string => v.trim()) : undefined;

const loadState = async (container: Container, refresh: boolean): Promise<UsageState> => {
  if (refresh) return (await ingestUsage(container)).state;
  return (await container.store.loadState()) ?? (await rebuildState(container.store));
};

const toFilter = (opts: Record<string, string | undefined>): ReportFilter => ({
  ...(opts.provider ? { provider: providerAlias[opts.provider] ?? opts.provider } : {}),
  ...(opts.customer ? { customer: opts.customer } : {}),
  ...(opts.project ? { project: opts.project } : {}),
  ...(opts.since ? { since: opts.since } : {}),
  ...(opts.until ? { until: opts.until } : {}),
  ...(opts.run ? { runId: opts.run } : {}),
});

export const buildProgram = (): Command => {
  const program: Command = new Command();
  program
    .name("ai-usage")
    .description(
      "Unified usage & cost tracking for GitHub Copilot CLI, Claude Code and OpenAI Codex CLI",
    )
    .option("-P, --providers <list>", "comma list: claude,codex,copilot,antigravity (default all)");

  program
    .command("ingest")
    .description("Read new telemetry from all providers into the state directory")
    .option("--project <prefix>", "only sessions whose cwd starts with prefix")
    .option(
      "--rebuild",
      "discard the event log and cursors and re-read every source (customer mappings and labels are kept)",
    )
    .action(async (opts: { project?: string; rebuild?: boolean }): Promise<void> => {
      const container: Container = await createContainer({
        ...(parseProviders(program.opts().providers)
          ? { providers: parseProviders(program.opts().providers) as string[] }
          : {}),
        ...(opts.project ? { projectFilter: [opts.project] } : {}),
      });
      if (opts.rebuild) {
        const fsp = await import("node:fs/promises");
        await Promise.all(
          [
            container.store.paths.events,
            container.store.paths.checkpoints,
            container.store.paths.actors,
            container.store.paths.runs,
          ].map((p: string) => fsp.rm(p, { force: true })),
        );
        logger.info("rebuilding from sources", { home: container.store.homeDir });
      }
      const result = await ingestUsage(container);
      logger.info("ingest complete", {
        appended: result.appended,
        skipped: result.skipped,
        perProvider: result.perProvider,
        runs: result.state.runs.length,
        state: container.store.paths.state,
      });
    });

  program
    .command("report")
    .description("Print usage/cost for runs (reads state.json; --refresh ingests first)")
    .option("--refresh", "ingest before reporting")
    .option("--provider <p>", "claude|codex|copilot")
    .option("--customer <name>")
    .option("--project <prefix>")
    .option("--since <iso>")
    .option("--until <iso>")
    .option("--run <id-or-fragment>", "show one run in detail")
    .option("--by <dim>", "customer|provider|project|day")
    .option("--json", "raw JSON output")
    .option("--limit <n>", "max rows", "50")
    .action(async (opts: Record<string, string | boolean | undefined>): Promise<void> => {
      const container: Container = await createContainer({
        ...(parseProviders(program.opts().providers)
          ? { providers: parseProviders(program.opts().providers) as string[] }
          : {}),
      });
      const state: UsageState = await loadState(container, Boolean(opts.refresh));
      const stringOpts: Record<string, string | undefined> = Object.fromEntries(
        Object.entries(opts).map(([k, v]): [string, string | undefined] => [
          k,
          typeof v === "string" ? v : undefined,
        ]),
      );
      const runs: RunUsageSummary[] = filterRuns(toFilter(stringOpts))(state.runs);
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(opts.run ? runs : { updatedAt: state.updatedAt, runs }, null, 2) + "\n",
        );
        return;
      }
      if (opts.run) {
        process.stdout.write(runs.map(formatRunSummary).join("\n\n") + "\n");
        return;
      }
      const by: string | undefined = typeof opts.by === "string" ? opts.by : undefined;
      if (by) {
        const grouper =
          by === "customer"
            ? byCustomer
            : by === "provider"
              ? byProvider
              : by === "project"
                ? byProject
                : byDay;
        process.stdout.write(formatGroupTable(by, grouper(runs)) + "\n");
        return;
      }
      const limit: number = Number(opts.limit ?? 50);
      process.stdout.write(formatRunsTable(runs.slice(0, limit)) + "\n");
      process.stdout.write(`\n${runs.length} runs (state updated ${state.updatedAt})\n`);
    });

  program
    .command("watch")
    .description("Ingest continuously")
    .option("--interval <seconds>", "poll interval", "30")
    .action(async (opts: { interval: string }): Promise<void> => {
      const container: Container = await createContainer({
        ...(parseProviders(program.opts().providers)
          ? { providers: parseProviders(program.opts().providers) as string[] }
          : {}),
      });
      const interval: number = Math.max(5, Number(opts.interval)) * 1000;
      const tick = async (): Promise<void> => {
        try {
          const result = await ingestUsage(container);
          if (result.appended > 0)
            logger.info("ingested", { appended: result.appended, runs: result.state.runs.length });
        } catch (error) {
          logger.error("ingest failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };
      await tick();
      setInterval((): void => {
        void tick();
      }, interval);
    });

  program
    .command("run")
    .description(
      "Run a CLI command and print the usage it generated: ai-usage run --customer acme -- claude -p 'hi'",
    )
    .option("--customer <name>", "tag the run(s) with a customer")
    .option("--label <text>", "free-form label for the run(s)")
    .argument("<command...>", "command to execute")
    .action(
      async (command: string[], opts: { customer?: string; label?: string }): Promise<void> => {
        const container: Container = await createContainer();
        const result = await runWrapped({
          ...container,
          command,
          cwd: process.cwd(),
          ...(opts.customer ? { customer: opts.customer } : {}),
          ...(opts.label ? { label: opts.label } : {}),
        });
        process.stdout.write(
          "\n" +
            (result.runs.length === 0
              ? "no usage attributed to this command (telemetry may lag; run `ai-usage report --refresh`)\n"
              : result.runs.map(formatRunSummary).join("\n\n") + "\n"),
        );
        process.exitCode = result.exitCode;
      },
    );

  const customers: Command = program
    .command("customers")
    .description("Map working directories to customers");
  customers
    .command("add")
    .argument("<name>")
    .argument("<cwdPrefix>")
    .description("Attribute every run whose cwd starts with prefix to the customer")
    .action(async (name: string, cwdPrefix: string): Promise<void> => {
      const container: Container = await createContainer();
      const config = await container.store.loadConfig();
      await container.store.saveConfig(addCustomerRule(config, name, cwdPrefix));
      await rebuildState(container.store);
      logger.info("customer rule saved", { name, cwdPrefix });
    });
  customers.command("list").action(async (): Promise<void> => {
    const container: Container = await createContainer();
    const config = await container.store.loadConfig();
    process.stdout.write(JSON.stringify(config.customers, null, 2) + "\n");
  });

  const factory: Command = program
    .command("factory")
    .description(
      "Per-pipeline-run cost attribution for agent factories (run/<pipeline>/<run>/.state.json)",
    );
  factory
    .command("add")
    .argument("<root>", "factory root directory (contains run/)")
    .description(
      "Register a factory root; every ingest then refreshes its per-run costs and writes <run>/cost.json",
    )
    .action(async (root: string): Promise<void> => {
      const container: Container = await createContainer();
      const config = await container.store.loadConfig();
      const abs: string = path.resolve(root);
      const factories = [...(config.factories ?? []).filter((f) => f.root !== abs), { root: abs }];
      await container.store.saveConfig({ ...config, factories });
      const state: FactoryState = await refreshFactoryCosts({
        store: container.store,
        roots: factories.map((f) => f.root),
        writeSidecars: true,
      });
      logger.info("factory registered", {
        root: abs,
        runs: state.runs.filter((r) => r.runDir.startsWith(abs)).length,
      });
    });
  factory
    .command("report")
    .description("Cost per pipeline run, per step, per harness")
    .option("--root <dir>", "only this factory root")
    .option("--pipeline <id>", "only this pipeline")
    .option("--run <fragment>", "one run in detail (folder name fragment)")
    .option("--refresh", "recompute from the event log first (also rewrites cost.json sidecars)")
    .option("--no-write", "with --refresh: do not write cost.json sidecars")
    .option("--json", "raw JSON")
    .action(
      async (opts: {
        root?: string;
        pipeline?: string;
        run?: string;
        refresh?: boolean;
        write?: boolean;
        json?: boolean;
      }): Promise<void> => {
        const container: Container = await createContainer();
        const config = await container.store.loadConfig();
        const roots: string[] = opts.root
          ? [path.resolve(opts.root)]
          : (config.factories ?? []).map((f) => f.root);
        if (roots.length === 0) {
          process.stdout.write("no factory registered. Run: ai-usage factory add <root>\n");
          return;
        }
        const state: FactoryState | null =
          opts.refresh || opts.root
            ? await refreshFactoryCosts({
                store: container.store,
                roots,
                writeSidecars: opts.write !== false,
              })
            : await container.store.loadFactoryState();
        const runs: FactoryRunCost[] = (state?.runs ?? []).filter(
          (r: FactoryRunCost): boolean =>
            roots.some((root: string): boolean => r.runDir.startsWith(root)) &&
            (!opts.pipeline || r.pipeline === opts.pipeline) &&
            (!opts.run || r.runFolder.includes(opts.run) || r.runId.includes(opts.run)),
        );
        if (opts.json) {
          process.stdout.write(
            JSON.stringify(opts.run ? runs : { updatedAt: state?.updatedAt, runs }, null, 2) + "\n",
          );
          return;
        }
        if (opts.run) {
          process.stdout.write(runs.map(formatFactoryRun).join("\n\n") + "\n");
          return;
        }
        process.stdout.write(
          formatFactoryRunsTable(runs) +
            "\n\n" +
            `${runs.length} runs (factory state updated ${state?.updatedAt ?? "-"})\n`,
        );
      },
    );

  program
    .command("reprice")
    .description(
      "Recompute estimated list prices for all stored events from the current rate cards",
    )
    .action(async (): Promise<void> => {
      const container: Container = await createContainer();
      const state: UsageState = await repriceUsage(container);
      logger.info("repriced", { runs: state.runs.length });
    });

  program
    .command("paths")
    .description("Show where state is stored")
    .action(async (): Promise<void> => {
      const container: Container = await createContainer();
      process.stdout.write(JSON.stringify(container.store.paths, null, 2) + "\n");
    });

  return program;
};

export const runCli = async (argv: string[]): Promise<void> => {
  await buildProgram().parseAsync(argv);
};

const invokedDirectly: boolean =
  process.argv[1] !== undefined && /cli[\\/]index\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  runCli(process.argv).catch((error: unknown): void => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
