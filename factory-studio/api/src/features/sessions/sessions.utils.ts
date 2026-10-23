import type { ZodSafeParseResult } from 'zod';
import type { HerdrPane, HerdrWorkspace } from '../../clients/herdr/herdr.types.js';
import { harnessSchema, sessionMetaSchema } from './sessions.schema.js';
import type { FactoryParam, ParamValue } from '../pipelines/pipelines.types.js';
import type {
  FactorySession,
  Harness,
  ParamIssue,
  ResolveParamsResult,
  ResolvedParam,
  SessionMeta,
} from './sessions.types.js';

export const SESSION_PREFIX = 'factory-';
const FACTORY_SUFFIX = '-factory';

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

/** A value that reads as one word as it is: no quoting needed. */
const BARE_VALUE = /^[A-Za-z0-9_.,:/@%+-]+$/;

/**
 * A param value as the runner reads it after `name=`. A plain word stays bare; anything else
 * (spaces, quotes, newlines, `$`, non-ASCII, empty) goes in POSIX double quotes with `\`, `"`,
 * `$` and `` ` `` escaped. The runner keeps a quoted value verbatim and hands it to the recorder
 * as `--param name="value"`, so it must also be one safe shell word there. Pure.
 */
export const formatParamValue = (value: ParamValue): string => {
  const text: string = String(value);
  return BARE_VALUE.test(text) ? text : `"${text.replace(/[\\"$`]/g, '\\$&')}"`;
};

/** `name=value`, quoted as `formatParamValue` says. */
export const formatParamArg = ([name, value]: ResolvedParam): string =>
  `${name}=${formatParamValue(value)}`;

/**
 * The prompt for a start with params: `/<id> name=value ...` — exactly the `name=value`
 * overrides `any-factory` takes — then, after a blank line, the person's extra instructions.
 */
export const buildFactoryParamsPrompt = (
  factoryId: string,
  params: readonly ResolvedParam[],
  extra: string,
): string => {
  const head: string = [`/${factoryId}`, ...params.map(formatParamArg)].join(' ');
  return extra === '' ? head : `${head}\n\nExtra instructions: ${extra}`;
};

const TRUE_WORDS: readonly string[] = ['true', '1', 'yes'];
const FALSE_WORDS: readonly string[] = ['false', '0', 'no'];

const issue = (name: string, message: string): ParamIssue => ({
  path: ['params', name],
  message,
});

/**
 * A value takes its default's type, the way the runner's recorder coerces `--param`: a boolean
 * from true/false/1/0/yes/no, a number that is a number (whole when the default is whole), text
 * as it is. An empty default means required: the value must not be blank.
 */
const coerceParam = (param: FactoryParam, value: ParamValue): ParamValue | ParamIssue => {
  const text: string = String(value);
  if (param.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    const lower: string = text.trim().toLowerCase();
    if (TRUE_WORDS.includes(lower)) return true;
    if (FALSE_WORDS.includes(lower)) return false;
    return issue(param.name, `"${text}" is not a boolean`);
  }
  if (param.type === 'number') {
    const parsed: number = typeof value === 'number' ? value : Number(text);
    if (typeof value === 'boolean' || text.trim() === '' || !Number.isFinite(parsed)) {
      return issue(param.name, `"${text}" is not a number`);
    }
    if (Number.isInteger(param.default) && !Number.isInteger(parsed)) {
      return issue(param.name, `"${text}" is not a whole number`);
    }
    return parsed;
  }
  if (param.required && text.trim() === '') return issue(param.name, 'is required');
  return text;
};

const isIssue = (value: ParamValue | ParamIssue): value is ParamIssue =>
  typeof value === 'object' && value !== null;

/**
 * Checks the params a start was given against the ones `pipeline.json` declares: every name
 * must be declared, every value must take its default's type, every required one must be there.
 * The answer lists every declared param in declaration order (a missing optional one at its
 * default), so the runner gets the whole set and the main param leads. Pure.
 */
export const resolveStartParams = (
  declared: readonly FactoryParam[],
  given: Readonly<Record<string, ParamValue>>,
): ResolveParamsResult => {
  const names: string[] = declared.map((param: FactoryParam): string => param.name);
  const unknown: ParamIssue[] = Object.keys(given)
    .filter((name: string): boolean => !names.includes(name))
    .map((name: string): ParamIssue => issue(name, 'is not a param of this factory'));
  const values: (ResolvedParam | ParamIssue)[] = declared.map(
    (param: FactoryParam): ResolvedParam | ParamIssue => {
      const value: ParamValue | ParamIssue = Object.hasOwn(given, param.name)
        ? coerceParam(param, given[param.name] as ParamValue)
        : param.required
          ? issue(param.name, 'is required')
          : param.default;
      return isIssue(value) ? value : [param.name, value];
    },
  );
  const issues: ParamIssue[] = [
    ...unknown,
    ...values.filter(
      (value: ResolvedParam | ParamIssue): value is ParamIssue => !Array.isArray(value),
    ),
  ];
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    params: values.filter((value: ResolvedParam | ParamIssue): value is ResolvedParam =>
      Array.isArray(value),
    ),
  };
};

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

/** `<session>.meta.json`, beside the prompt: what herdr's workspace label cannot carry. */
export const metaFileName = (session: string): string => `${session}.meta.json`;

export const buildSessionMeta = (
  args: Pick<SessionMeta, 'session' | 'factoryId' | 'harness'>,
  startedAt: Date,
): SessionMeta => ({ ...args, startedAt: startedAt.toISOString() });

/** `null` when the document is not a session meta: the session is then described from its name. */
export const parseSessionMeta = (value: unknown): SessionMeta | null => {
  const parsed: ZodSafeParseResult<SessionMeta> = sessionMetaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/**
 * A workspace with no readable meta was started by hand or by an older build; the id is then
 * read back out of the name as best it can be, the harness is `unknown` and the age starts now.
 */
export const toFactorySession = (
  workspace: HerdrWorkspace,
  pane: HerdrPane | undefined,
  meta: SessionMeta | null,
  now: Date,
): FactorySession => {
  const startedAt: Date = meta ? new Date(meta.startedAt) : now;
  const started: Date = Number.isNaN(startedAt.getTime()) ? now : startedAt;
  const ageSeconds: number = Math.max(0, Math.floor((now.getTime() - started.getTime()) / 1000));
  return {
    session: workspace.label,
    factoryId: meta?.factoryId ?? factoryIdFromName(workspace.label),
    harness: meta ? toHarness(meta.harness) : 'unknown',
    startedAt: started.toISOString(),
    ageSeconds,
    age: formatAge(ageSeconds),
    status: pane?.status ?? workspace.status,
    workspaceId: workspace.workspaceId,
    ...(pane ? { paneId: pane.paneId } : {}),
    ...(pane?.agentSessionId ? { claudeSessionId: pane.agentSessionId } : {}),
  };
};

/** Does `target` name this session's factory, with or without the `-factory` suffix? */
export const matchesFactoryId = (session: FactorySession, target: string): boolean =>
  session.factoryId === target || stripFactorySuffix(session.factoryId) === target;

/** Single-quote a string for POSIX sh. The only thing the shell ever sees from a caller. */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

export const settingsFileName = (session: string): string => `${session}.settings.json`;

/**
 * Every hook runs the same script; it tells them apart by `hook_event_name` on stdin.
 * SessionStart reports the transcript path (for the live chat), the two on AskUserQuestion
 * carry the question to the app and back.
 */
export const buildHookSettings = (
  nodePath: string,
  hookScript: string,
): Record<string, unknown> => {
  const command: string = `${shellQuote(nodePath)} ${shellQuote(hookScript)}`;
  return {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command, timeout: 15 }] }],
      PreToolUse: [
        { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command, timeout: 3600 }] },
      ],
      PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command }] }],
    },
  };
};

/** What a session's processes get besides the shell's own: the hook finds the API through it. */
export const buildSessionEnv = (
  base: Readonly<Record<string, string>>,
  session: string,
): Record<string, string> => ({ ...base, STUDIO_SESSION_ID: session });
