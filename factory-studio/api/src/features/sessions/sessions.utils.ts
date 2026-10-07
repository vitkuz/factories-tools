import type { ZodSafeParseResult } from 'zod';
import type { TmuxSessionInfo } from '../../clients/tmux/tmux.types.js';
import { harnessSchema } from './sessions.schema.js';
import type { FactorySession, Harness } from './sessions.types.js';

export const SESSION_PREFIX = 'factory-';
const FACTORY_SUFFIX = '-factory';

/** The labels a factory session carries as tmux user options. */
export const LABEL_HARNESS = 'harness';
export const LABEL_FACTORY_ID = 'factory_id';
export const SESSION_LABELS: readonly string[] = [LABEL_HARNESS, LABEL_FACTORY_ID];

/** `canonical-factory` -> `canonical`, so the session name does not say "factory" twice. */
export const stripFactorySuffix = (id: string): string =>
  id.endsWith(FACTORY_SUFFIX) ? id.slice(0, -FACTORY_SUFFIX.length) : id;

/** `factory-<id without -factory>-<first 8 of the uuid>`. */
export const buildSessionName = (factoryId: string, uuid: string): string =>
  `${SESSION_PREFIX}${stripFactorySuffix(factoryId)}-${uuid.replace(/-/g, '').slice(0, 8)}`;

export const isFactorySession = (name: string): boolean => name.startsWith(SESSION_PREFIX);

/** The one prompt the harness gets: the skill invocation, then the user's message. */
export const buildFactoryPrompt = (factoryId: string, prompt: string): string =>
  `/${factoryId} ${prompt}`;

export const formatAge = (seconds: number): string => {
  const total: number = Math.max(0, Math.floor(seconds));
  const days: number = Math.floor(total / 86_400);
  const hours: number = Math.floor((total % 86_400) / 3_600);
  const minutes: number = Math.floor((total % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
};

const toHarness = (value: string): Harness | 'unknown' => {
  const parsed: ZodSafeParseResult<Harness> = harnessSchema.safeParse(value);
  return parsed.success ? parsed.data : 'unknown';
};

/**
 * A session with no `factory_id` label was started by hand or by an older build; the id is
 * then read back out of the name as best it can be, and the harness is `unknown`.
 */
const factoryIdFromName = (name: string): string => {
  const withoutPrefix: string = name.slice(SESSION_PREFIX.length);
  const withoutUuid: string = withoutPrefix.replace(/-[0-9a-f]{8}$/, '');
  return `${withoutUuid}${FACTORY_SUFFIX}`;
};

export const toFactorySession = (info: TmuxSessionInfo, now: Date): FactorySession => {
  const ageSeconds: number = Math.max(
    0,
    Math.floor((now.getTime() - info.createdAt.getTime()) / 1000),
  );
  const labelledId: string = info.labels[LABEL_FACTORY_ID] ?? '';
  return {
    session: info.name,
    factoryId: labelledId !== '' ? labelledId : factoryIdFromName(info.name),
    harness: toHarness(info.labels[LABEL_HARNESS] ?? ''),
    startedAt: info.createdAt.toISOString(),
    ageSeconds,
    age: formatAge(ageSeconds),
  };
};

/** Does `target` name this session's factory, with or without the `-factory` suffix? */
export const matchesFactoryId = (session: FactorySession, target: string): boolean =>
  session.factoryId === target || stripFactorySuffix(session.factoryId) === target;

/** Single-quote a string for POSIX sh. The only thing the shell ever sees from a caller. */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
