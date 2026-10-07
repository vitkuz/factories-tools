import { spawn, spawnSync } from 'node:child_process';
import { z } from 'zod';
import { createAppError } from '../shared/utils/error.utils.js';

/** Commander gives a string; this reads it as one of an enum, with a usable complaint. */
export const enumOption =
  <T extends string>(flag: string, schema: z.ZodEnum<Record<T, T>>) =>
  (value: string): T => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw createAppError('OPTION_INVALID', `${flag} does not take "${value}"`, [
        `one of: ${schema.options.join(', ')}`,
      ]);
    }
    return parsed.data;
  };

/** `--hide loops,max` → `['loops', 'max']`, each checked against the enum. */
export const listOption =
  <T extends string>(flag: string, schema: z.ZodEnum<Record<T, T>>) =>
  (value: string): T[] =>
    value
      .split(',')
      .map((part: string): string => part.trim())
      .filter(Boolean)
      .map(enumOption(flag, schema));

export const csvOption = (value: string): string[] =>
  value
    .split(',')
    .map((part: string): string => part.trim())
    .filter(Boolean);

/** `wslview` on WSL, `xdg-open` elsewhere; says so when neither is there, never fails the run. */
export const openFile = (file: string): string | undefined => {
  const openers: readonly string[] = ['wslview', 'xdg-open', 'open'];
  const opener: string | undefined = openers.find(
    (name: string): boolean => spawnSync('which', [name], { stdio: 'ignore' }).status === 0,
  );
  if (opener === undefined) return undefined;
  spawn(opener, [file], { stdio: 'ignore', detached: true }).unref();
  return opener;
};
