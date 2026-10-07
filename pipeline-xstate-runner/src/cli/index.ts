import { CommanderError } from 'commander';
import { EXIT } from './cli.utils.js';
import type { Output } from './cli.utils.js';
import { createHandlers } from './handlers.js';
import { buildProgram } from './program.js';

const output: Output = {
  out: (text: string): void => console.log(text),
  err: (text: string): void => console.error(text),
};

const main = async (): Promise<number> => {
  const program = buildProgram(createHandlers(output), output);
  try {
    await program.parseAsync(process.argv);
  } catch (error: unknown) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? EXIT.ok : EXIT.refused;
    throw error;
  }
  return program.exitCodeOf();
};

process.exitCode = await main();
