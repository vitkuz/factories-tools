import path from 'node:path';
import type { ZodSafeParseResult } from 'zod';
import { contentBlockSchema, subagentMetaSchema, transcriptRecordSchema } from './chat.schema.js';
import type {
  ChatItem,
  ChatLimits,
  ContentBlock,
  LineSource,
  MapContext,
  SplitLines,
  SubagentMeta,
  TranscriptFiles,
  TranscriptLine,
  TranscriptRecord,
} from './chat.types.js';

/** What an item carries in the live stream; a person asks for the rest with "show more". */
export const DEFAULT_LIMITS: ChatLimits = { text: 12_000, input: 2_000, output: 2_000 };

/** Effectively no cut: what the "show more" read uses. */
export const FULL_LIMITS: ChatLimits = { text: 2_000_000, input: 2_000_000, output: 2_000_000 };

const NEWLINE = 0x0a;

/* ---------------------------------------------------------------- lines */

/**
 * Cuts `chunk` (read from the file at `start`, after `carry` from the previous read) into
 * complete lines with their byte positions. The unterminated tail is handed back to carry
 * into the next read. Positions are bytes, so a later read of one line is exact. Pure.
 */
export const splitLines = (carry: Buffer, carryStart: number, chunk: Buffer): SplitLines => {
  const buffer: Buffer = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
  const ends: number[] = [];
  for (let at = buffer.indexOf(NEWLINE); at !== -1; at = buffer.indexOf(NEWLINE, at + 1)) {
    ends.push(at);
  }
  const lines: TranscriptLine[] = ends
    .map((end: number, i: number): TranscriptLine => {
      const from: number = i === 0 ? 0 : (ends[i - 1] as number) + 1;
      return {
        text: buffer.subarray(from, end).toString('utf8'),
        start: carryStart + from,
        end: carryStart + end,
      };
    })
    .filter((line: TranscriptLine): boolean => line.text.trim() !== '');
  const restFrom: number = ends.length === 0 ? 0 : (ends[ends.length - 1] as number) + 1;
  return {
    lines,
    rest: Buffer.from(buffer.subarray(restFrom)),
    restStart: carryStart + restFrom,
  };
};

/** One transcript line to a record; `null` for a line that is not JSON or has no `type`. Pure. */
export const parseRecord = (line: string): TranscriptRecord | null => {
  try {
    const parsed: ZodSafeParseResult<TranscriptRecord> = transcriptRecordSchema.safeParse(
      JSON.parse(line),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const parseSubagentMeta = (value: unknown): SubagentMeta | null => {
  const parsed: ZodSafeParseResult<SubagentMeta> = subagentMetaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/* ---------------------------------------------------------------- text helpers */

export interface Cut {
  text: string;
  cut: boolean;
}

/** The first `limit` characters, with a note of how much was left out. Pure. */
export const truncate = (text: string, limit: number): Cut =>
  text.length <= limit
    ? { text, cut: false }
    : {
        text: `${text.slice(0, limit)}\n… ${(text.length - limit).toLocaleString('en-US')} more characters`,
        cut: true,
      };

const asBlocks = (content: unknown): ContentBlock[] =>
  Array.isArray(content)
    ? content
        .map((raw: unknown): ContentBlock | null => {
          const parsed: ZodSafeParseResult<ContentBlock> = contentBlockSchema.safeParse(raw);
          return parsed.success ? parsed.data : null;
        })
        .filter((block: ContentBlock | null): block is ContentBlock => block !== null)
    : [];

/** A tool result's content (a string, or text and image blocks) as plain text. Pure. */
export const resultText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  return asBlocks(content)
    .map((block: ContentBlock): string =>
      block.type === 'text' ? (block.text ?? '') : `[${block.type}]`,
    )
    .join('\n');
};

const oneLine = (text: string, limit: number): string => {
  const flat: string = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
};

const SUMMARY_KEYS: readonly string[] = [
  'description',
  'command',
  'file_path',
  'path',
  'pattern',
  'url',
  'query',
  'skill',
  'prompt',
];

/**
 * A tool call in one short line: the field that says what it does (a Bash command, a file
 * path, a subagent's description…), else the first string field, else nothing. Pure.
 */
export const summarizeInput = (tool: string, input: unknown): string => {
  if (typeof input !== 'object' || input === null) return '';
  const record: Record<string, unknown> = input as Record<string, unknown>;
  if (tool === 'AskUserQuestion' && Array.isArray(record.questions)) {
    const first: unknown = record.questions[0];
    const question: unknown =
      typeof first === 'object' && first !== null
        ? (first as Record<string, unknown>).question
        : '';
    const more: number = record.questions.length - 1;
    return oneLine(`${String(question)}${more > 0 ? ` (+${more} more)` : ''}`, 160);
  }
  const key: string | undefined = SUMMARY_KEYS.find(
    (name: string): boolean => typeof record[name] === 'string' && record[name] !== '',
  );
  if (key !== undefined) return oneLine(String(record[key]), 160);
  const firstText: unknown = Object.values(record).find(
    (value: unknown): boolean => typeof value === 'string',
  );
  return typeof firstText === 'string' ? oneLine(firstText, 160) : '';
};

const prettyJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
};

const TAG = (name: string): RegExp => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`);

const tagValue = (text: string, name: string): string | null => TAG(name).exec(text)?.[1] ?? null;

/** `1m 55s`, `12s`, `850ms`. Pure. */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds: number = Math.round(ms / 1000);
  const minutes: number = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
};

/* ---------------------------------------------------------------- records -> items */

/** `main:0:1234` — where the whole item can be read again. */
export const formatRef = (line: LineSource): string => `${line.source}:${line.start}:${line.end}`;

export const parseRef = (ref: string): LineSource | null => {
  const match: RegExpExecArray | null = /^([A-Za-z0-9_-]+):(\d+):(\d+)$/.exec(ref);
  if (match === null) return null;
  const start: number = Number(match[2]);
  const end: number = Number(match[3]);
  return end >= start ? { source: match[1] as string, start, end } : null;
};

type Draft = Omit<ChatItem, 'id' | 'ts' | 'agentId' | 'parentToolUseId' | 'ref'> & {
  cut?: boolean;
};

const finish =
  (record: TranscriptRecord, ctx: MapContext) =>
  (draft: Draft, index: number): ChatItem => {
    const { cut, ...item }: Draft = draft;
    const owner: string = ctx.agent?.agentId ?? 'main';
    return {
      ...item,
      id: `${owner}.${record.uuid ?? `${ctx.line.start}`}.${index}`,
      ts: record.timestamp ?? '',
      ...(ctx.agent
        ? {
            agentId: ctx.agent.agentId,
            ...(ctx.agent.parentToolUseId ? { parentToolUseId: ctx.agent.parentToolUseId } : {}),
          }
        : {}),
      ...(cut ? { ref: formatRef(ctx.line) } : {}),
    };
  };

/** A user's typed slash command, as the transcript wraps it, back to `/name args`. */
const commandText = (text: string): string | null => {
  const name: string | null = tagValue(text, 'command-name');
  if (name === null) return null;
  const args: string = (tagValue(text, 'command-args') ?? '').trim();
  return `${name.startsWith('/') ? name : `/${name}`}${args === '' ? '' : ` ${args}`}`;
};

/** A string the user record carries: a command, a background task notice, local output, or words. */
const userStringDraft = (text: string, ctx: MapContext): Draft | null => {
  const command: string | null = commandText(text);
  if (command !== null) return { kind: 'user', text: command };
  if (text.includes('<task-notification>')) {
    const summary: string = tagValue(text, 'summary') ?? 'A background task finished';
    const status: string = tagValue(text, 'status') ?? '';
    return { kind: 'system', text: `${summary}${status === '' ? '' : ` (${status})`}` };
  }
  const stdout: string | null = tagValue(text, 'local-command-stdout');
  if (stdout !== null) {
    const cut: { text: string; cut: boolean } = truncate(stdout.trim(), ctx.limits.output);
    return cut.text === '' ? null : { kind: 'system', text: cut.text, cut: cut.cut };
  }
  if (/^\s*<(local-command-caveat|system-reminder)>/.test(text)) return null;
  if (/^\[Request interrupted/.test(text.trim())) return { kind: 'system', text: text.trim() };
  const cut: { text: string; cut: boolean } = truncate(text, ctx.limits.text);
  return cut.text.trim() === '' ? null : { kind: 'user', text: cut.text, cut: cut.cut };
};

const userDrafts = (record: TranscriptRecord, ctx: MapContext): Draft[] => {
  const content: unknown = record.message?.content;
  if (record.isCompactSummary) {
    const cut: { text: string; cut: boolean } = truncate(resultText(content), ctx.limits.output);
    return [{ kind: 'system', text: 'Conversation compacted', output: cut.text, cut: cut.cut }];
  }
  // Skill bodies, hook context and the like: the model reads them, a person does not need to.
  if (record.isMeta) return [];
  // A subagent's opening message is its prompt, already shown on the call that started it.
  if (ctx.agent && typeof content === 'string') return [];
  if (typeof content === 'string') {
    const draft: Draft | null = userStringDraft(content, ctx);
    return draft ? [draft] : [];
  }
  return asBlocks(content).flatMap((block: ContentBlock): Draft[] => {
    if (block.type === 'tool_result') {
      const toolUseId: string = block.tool_use_id ?? '';
      const tool: string | undefined = ctx.toolNames.get(toolUseId);
      const cut: { text: string; cut: boolean } = truncate(
        resultText(block.content),
        ctx.limits.output,
      );
      return [
        {
          kind: 'tool_result',
          text: '',
          toolUseId,
          ...(tool ? { tool } : {}),
          output: cut.text,
          ...(block.is_error ? { isError: true } : {}),
          cut: cut.cut,
        },
      ];
    }
    if (block.type === 'text' && !ctx.agent) {
      const draft: Draft | null = userStringDraft(block.text ?? '', ctx);
      return draft ? [draft] : [];
    }
    if (block.type === 'image' && !ctx.agent) return [{ kind: 'user', text: '[image]' }];
    return [];
  });
};

const assistantDrafts = (record: TranscriptRecord, ctx: MapContext): Draft[] =>
  asBlocks(record.message?.content).flatMap((block: ContentBlock): Draft[] => {
    if (block.type === 'text') {
      const cut: { text: string; cut: boolean } = truncate(block.text ?? '', ctx.limits.text);
      return cut.text.trim() === '' ? [] : [{ kind: 'assistant', text: cut.text, cut: cut.cut }];
    }
    if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      const cut: { text: string; cut: boolean } = truncate(block.thinking ?? '', ctx.limits.text);
      return [
        {
          kind: 'thinking',
          text: cut.text,
          ...(record.thinkingDurationMs !== undefined
            ? { durationMs: record.thinkingDurationMs }
            : {}),
          cut: cut.cut,
        },
      ];
    }
    if ((block.type === 'tool_use' || block.type === 'server_tool_use') && block.name) {
      const cut: { text: string; cut: boolean } = truncate(
        prettyJson(block.input ?? {}),
        ctx.limits.input,
      );
      return [
        {
          kind: 'tool_call',
          text: summarizeInput(block.name, block.input),
          tool: block.name,
          toolUseId: block.id ?? '',
          input: cut.text,
          cut: cut.cut,
        },
      ];
    }
    return [];
  });

const SYSTEM_SILENT: readonly string[] = ['stop_hook_summary', 'api_error'];

const systemDrafts = (record: TranscriptRecord, ctx: MapContext): Draft[] => {
  if (record.subtype === 'turn_duration') {
    return record.durationMs === undefined
      ? []
      : [{ kind: 'system', text: `Turn finished · ${formatDuration(record.durationMs)}` }];
  }
  if (record.subtype === 'compact_boundary') return [];
  if (SYSTEM_SILENT.includes(record.subtype ?? '')) return [];
  const text: string = typeof record.content === 'string' ? record.content : '';
  if (text.trim() === '') return [];
  const cut: { text: string; cut: boolean } = truncate(text, ctx.limits.text);
  return [{ kind: 'system', text: cut.text, cut: cut.cut }];
};

/**
 * One transcript record to the chat rows it shows as: an assistant message to one row per
 * text, thinking and tool_use block; a user message to the typed words or the tool results it
 * carries; a few system records to a line. Everything else (attachments, API bookkeeping,
 * mode switches, snapshots, records of a type this version does not know) to none. Pure.
 */
export const recordToItems = (record: TranscriptRecord, ctx: MapContext): ChatItem[] => {
  const drafts: Draft[] =
    record.type === 'assistant'
      ? assistantDrafts(record, ctx)
      : record.type === 'user'
        ? userDrafts(record, ctx)
        : record.type === 'system'
          ? systemDrafts(record, ctx)
          : [];
  return drafts.map(finish(record, ctx));
};

/** The tool_use ids a record opens, with their tool names, to label later results. Pure. */
export const toolUsesOf = (record: TranscriptRecord): [string, string][] =>
  record.type === 'assistant'
    ? asBlocks(record.message?.content)
        .filter(
          (block: ContentBlock): boolean =>
            (block.type === 'tool_use' || block.type === 'server_tool_use') &&
            typeof block.id === 'string' &&
            typeof block.name === 'string',
        )
        .map((block: ContentBlock): [string, string] => [block.id as string, block.name as string])
    : [];

/** The row that opens a subagent's group, under the call that started it. Pure. */
export const subagentItem = (agentId: string, meta: SubagentMeta | null, ts: string): ChatItem => ({
  id: `${agentId}.start`,
  kind: 'subagent',
  text: meta?.description ?? agentId,
  ts,
  tool: meta?.agentType ?? 'subagent',
  agentId,
  ...(meta?.toolUseId ? { parentToolUseId: meta.toolUseId } : {}),
  ...(meta?.model ? { input: `model: ${meta.model}` } : {}),
});

/* ---------------------------------------------------------------- paths */

/** Claude Code's project folder name for a working directory: every non-alphanumeric is `-`. */
export const projectDirName = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-');

export const transcriptPathFor = (
  projectsDir: string,
  cwd: string,
  claudeSessionId: string,
): string => path.join(projectsDir, projectDirName(cwd), `${claudeSessionId}.jsonl`);

/** `<dir>/<id>.jsonl` → its subagents folder `<dir>/<id>/subagents`. */
export const transcriptFiles = (main: string): TranscriptFiles => ({
  main,
  subagentsDir: path.join(path.dirname(main), path.basename(main, '.jsonl'), 'subagents'),
});

/** `agent-<id>.jsonl` → `<id>`; anything else → `null`. */
export const subagentIdOf = (fileName: string): string | null =>
  /^agent-([A-Za-z0-9_-]+)\.jsonl$/.exec(fileName)?.[1] ?? null;

/**
 * Only a `.jsonl` inside the projects folder is read: the path arrives from a hook request,
 * and the API must not become a way to read any file on the machine. Pure.
 */
export const isTranscriptPath = (projectsDir: string, file: string): boolean => {
  const resolved: string = path.resolve(file);
  const root: string = path.resolve(projectsDir);
  return resolved.startsWith(`${root}${path.sep}`) && resolved.endsWith('.jsonl');
};

/** Keeps the newest `cap` items of `items`, and says how many fell off the front. Pure. */
export const capItems = (
  items: readonly ChatItem[],
  cap: number,
): { items: ChatItem[]; dropped: number } => {
  const dropped: number = Math.max(0, items.length - cap);
  return { items: items.slice(dropped), dropped };
};

/**
 * Items of several files in the order they happened: by timestamp, stable, so the rows of one
 * record (and of one file at one instant) keep their order. An item with no time keeps its place
 * after the one before it. Pure.
 */
export const byTime = (items: readonly ChatItem[]): ChatItem[] => {
  let last = '';
  const keyed: { item: ChatItem; index: number; ts: string }[] = items.map(
    (item: ChatItem, index: number): { item: ChatItem; index: number; ts: string } => {
      last = item.ts === '' ? last : item.ts;
      return { item, index, ts: last };
    },
  );
  return keyed
    .sort((a, b): number => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.index - b.index))
    .map((entry: { item: ChatItem }): ChatItem => entry.item);
};

export const transcriptLinkFileName = (session: string): string => `${session}.transcript.json`;
