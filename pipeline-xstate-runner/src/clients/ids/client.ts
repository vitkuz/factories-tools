import { randomBytes } from 'node:crypto';
import type { HexGenerator } from './types.js';

export const createHexGenerator = (): HexGenerator => (): string => randomBytes(3).toString('hex');

/** Always the same digits: tests and replays. */
export const createFixedHexGenerator =
  (hex: string): HexGenerator =>
  (): string =>
    hex;
