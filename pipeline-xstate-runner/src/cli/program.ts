import { Command } from 'commander';
import type { Output } from './cli.utils.js';
import { collect, collectParam } from './cli.utils.js';
import type {
  AnswerCommandOptions,
  EngineOptions,
  ResolveCommandOptions,
  RunCommandOptions,
} from './cli.utils.js';

/** What each subcommand hands to the composition root once commander has parsed it. */
export interface Handlers {
  validate: (pipeline: string | undefined, options: EngineOptions) => Promise<number>;
  resolve: (pipeline: string | undefined, options: ResolveCommandOptions) => Promise<number>;
  run: (pipeline: string, options: RunCommandOptions) => Promise<number>;
  resume: (runDir: string, options: EngineOptions) => Promise<number>;
  answer: (
    runDir: string,
    step: string,
    event: string,
    options: AnswerCommandOptions,
  ) => Promise<number>;
  show: (runDir: string, options: EngineOptions) => Promise<number>;
  replay: (runDir: string, options: EngineOptions) => Promise<number>;
  compile: (pipeline: string | undefined, options: EngineOptions) => Promise<number>;
  listGuards: () => number;
  listHarnesses: (options: EngineOptions) => number;
}

const PIPELINE_ARG =
  'an id (factories.local/<id>, then factories/<id>), a folder, or a pipeline.json';
const RUN_DIR_ARG = 'the run folder (state.json, snapshot.json and events.jsonl live there)';

/** The engine options every command takes; a command reads the ones it needs. */
const withEngineOptions = (command: Command): Command =>
  command
    .option(
      '--root <dir>',
      'what {{rootPath}} resolves to (default: the nearest folder above cwd holding .claude/)',
    )
    .option('--harness <name>', 'claude | scripted (default: PIPELINE_HARNESS, then claude)')
    .option(
      '--default-model <id>',
      'the model for steps that name none (default: PIPELINE_DEFAULT_MODEL)',
    )
    .option(
      '--permission-mode <mode>',
      'how headless steps answer permission prompts (default: PIPELINE_PERMISSION_MODE, then bypassPermissions)',
    )
    .option(
      '--step-timeout <minutes>',
      'kill a step that runs longer than this (default: STEP_TIMEOUT_MINUTES, 90)',
    )
    .option(
      '--max-step-passes <n>',
      'fuse: fail the run when one step would start more often than this (default 12)',
    )
    .option(
      '--human <mode>',
      'terminal | park: ask at the terminal, or park the run and exit 3 (default: terminal with a TTY, else park)',
    )
    .option(
      '--inspect <sink>',
      'terminal | jsonl: stream every machine event to stderr, or to ./inspect.jsonl',
    )
    .option('--script <file>', 'the answers of the scripted harness (--harness scripted)')
    .option('--json', 'print the result as JSON', false);

/** The program, plus the exit code of the one command that ran. */
export type Program = Command & { exitCodeOf: () => number };

export const buildProgram = (handlers: Handlers, output: Output): Program => {
  const exits: number[] = [];
  const done = (code: Promise<number> | number): Promise<void> =>
    Promise.resolve(code).then((value: number): void => void exits.push(value));

  const program: Command = new Command()
    .name('xstate-runner')
    .description(
      'Runs a factory pipeline.json as an XState actor system: one run machine, one spawned step actor per pass, every routing decision a named pure guard. Writes <runDir>/state.json (factories/state.schema.json), events.jsonl and snapshot.json.',
    )
    .option('--list-guards', 'print every named guard of every machine, in order, and exit')
    .option('--list-harnesses', 'print every installed harness and its capabilities, and exit')
    .exitOverride()
    .configureOutput({ writeErr: (text: string): boolean => process.stderr.write(text) });

  withEngineOptions(
    program
      .command('validate')
      .description(
        "Validate a pipeline: the Zod shape, then the graph rules. The kit's verdict and exit codes (0 ok, 1 errors, 2 usage).",
      ),
  )
    .argument('[pipeline]', PIPELINE_ARG)
    .action((pipeline: string | undefined, options: EngineOptions) =>
      done(handlers.validate(pipeline, options)),
    );

  withEngineOptions(
    program
      .command('resolve')
      .description(
        "Print the resolved pipeline (params, variables, absolute paths). --prompt <step> prints that step's task message. Spawns nothing.",
      ),
  )
    .argument('[pipeline]', PIPELINE_ARG)
    .option('-p, --param <name=value>', 'a param; repeat for several', collectParam, {})
    .option('--prompt <step>', "print that step's first-pass task message instead of the JSON")
    .action((pipeline: string | undefined, options: ResolveCommandOptions) =>
      done(handlers.resolve(pipeline, options)),
    );

  withEngineOptions(
    program
      .command('run')
      .description(
        'Run a pipeline from START to END. Exit 0 only when COMPLETED; 3 when parked for a person.',
      ),
  )
    .argument('<pipeline>', PIPELINE_ARG)
    .option('-p, --param <name=value>', 'a param; repeat for several', collectParam, {})
    .action((pipeline: string, options: RunCommandOptions) =>
      done(handlers.run(pipeline, options)),
    );

  withEngineOptions(
    program
      .command('resume')
      .description(
        'Continue a run from its snapshot: what was running or interrupted runs again as a new pass.',
      ),
  )
    .argument('<runDir>', RUN_DIR_ARG)
    .action((runDir: string, options: EngineOptions) => done(handlers.resume(runDir, options)));

  withEngineOptions(
    program.command('answer').description('Answer a parked human step, then continue the run.'),
  )
    .argument('<runDir>', RUN_DIR_ARG)
    .argument('<step>', 'the human step the run waits at')
    .argument('<event>', "one of the step's events")
    .option(
      '--note <text>',
      'what the person adds: the brief of the next pass when the answer routes back',
    )
    .option(
      '--output <file>',
      'a file the person produced, relative to the run folder (repeat)',
      collect,
      [],
    )
    .action((runDir: string, step: string, event: string, options: AnswerCommandOptions) =>
      done(handlers.answer(runDir, step, event, options)),
    );

  withEngineOptions(
    program.command('show').description("Print the run's state.json in its written form."),
  )
    .argument('<runDir>', RUN_DIR_ARG)
    .action((runDir: string, options: EngineOptions) => done(handlers.show(runDir, options)));

  withEngineOptions(
    program
      .command('replay')
      .description(
        'Re-feed events.jsonl into a run machine with inert actors; it must reproduce state.json.',
      ),
  )
    .argument('<runDir>', RUN_DIR_ARG)
    .action((runDir: string, options: EngineOptions) => done(handlers.replay(runDir, options)));

  withEngineOptions(
    program
      .command('compile')
      .description(
        'Print a visual statechart of the pipeline (for the Stately visualiser). Never used to run.',
      ),
  )
    .argument('[pipeline]', PIPELINE_ARG)
    .action((pipeline: string | undefined, options: EngineOptions) =>
      done(handlers.compile(pipeline, options)),
    );

  program.action((): void => {
    const options = program.opts<{ listGuards?: boolean; listHarnesses?: boolean }>();
    if (options.listGuards === true) exits.push(handlers.listGuards());
    else if (options.listHarnesses === true) exits.push(handlers.listHarnesses({}));
    else output.out(program.helpInformation().trimEnd());
  });

  return Object.assign(program, { exitCodeOf: (): number => exits[0] ?? 0 });
};
