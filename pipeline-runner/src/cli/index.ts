#!/usr/bin/env node
import { Command } from 'commander';
import { isAppError } from '../shared/utils/error.utils.js';
import { registerResolveCommand } from './commands/resolve.command.js';
import { registerResumeCommand, registerRunCommand } from './commands/run.command.js';

const program: Command = new Command()
  .name('pipeline-runner')
  .description(
    'Runs a factory pipeline.json deterministically: the graph decides what runs next, not a harness.',
  )
  .version('0.1.0');

[registerResolveCommand, registerRunCommand, registerResumeCommand].forEach(
  (register: (program: Command) => Command): Command => register(program),
);

/** An error raised on purpose is a message and its issues; anything else keeps its stack. */
const fail = (error: unknown): void => {
  if (!isAppError(error)) throw error;
  process.stderr.write(
    `error: ${error.message}\n${error.issues.map((issue: string): string => `  - ${issue}\n`).join('')}`,
  );
  process.exitCode = 1;
};

program.parseAsync(process.argv).catch(fail);
