// Learned from factories-tools/run-state/src/clients/clock/clock.utils.ts (runIdFor)
/** run-20261007T131500-a1b2c3: the moment the run opened, then six hex digits. */
export const runIdFor = (openedAt: string, hex: string): string =>
  `run-${openedAt.replace(/[-:]/g, '').slice(0, 15)}-${hex}`;
