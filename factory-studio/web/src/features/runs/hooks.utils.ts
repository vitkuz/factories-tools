import type { HookSegment, HookTarget } from './runs.types';

export type HookConstants = Readonly<Record<string, unknown>>;

/** Placeholders the runner and the doc endpoints anchor to a folder: kept, not substituted. */
const OUTPUT_ANCHOR = '{{outputDir}}/';
const ANCHORS: readonly string[] = ['rootPath', 'skillPath', 'outputDir'];
/** Constants may reference constants; this bounds the passes (and any cycle). */
const MAX_PASSES = 10;

/**
 * Replace every `{{name}}` naming a string constant (and the built-in `{{id}}`) with its value,
 * pass after pass, as the runner does. The anchors (`rootPath`, `skillPath`, `outputDir`) stay
 * templates: they are folders, resolved by the endpoint that opens the file. Unknown names
 * stay as written. Pure.
 */
export const expandPlaceholders =
  (constants: HookConstants, id: string) =>
  (text: string): string => {
    const once = (t: string): string =>
      t.replace(/\{\{(\w+)\}\}/g, (match: string, name: string): string => {
        if (name === 'id') return id;
        const value: unknown = constants[name];
        return !ANCHORS.includes(name) && typeof value === 'string' ? value : match;
      });
    const pass = (t: string, left: number): string => {
      const next: string = once(t);
      return next === t || left <= 1 ? next : pass(next, left - 1);
    };
    return pass(text, MAX_PASSES);
  };

const ANCHOR_SCOPE: Readonly<Record<string, HookTarget['scope']>> = {
  '{{rootPath}}/': 'knowledge',
  '{{skillPath}}/': 'knowledge',
  [OUTPUT_ANCHOR]: 'run',
};

/** A plain relative path names a file when it has an extension or starts with `./`. */
const isFileLike = (token: string): boolean => token.startsWith('./') || /\.\w+\/?$/.test(token);

/**
 * Where a path token of a hook command points, or `null` when it is not a file we can open:
 * a placeholder nothing defines, a bare folder anchor (`{{outputDir}}`), an absolute or `~`
 * path (outside the work dir), or any `..`. Under `{{outputDir}}/` it is a run document;
 * under `{{rootPath}}/`, `{{skillPath}}/` or a plain relative path (the hook runs in the work
 * dir) it is a work-dir file. Pure.
 */
export const resolveHookPath =
  (constants: HookConstants, id: string) =>
  (token: string): HookTarget | null => {
    const expanded: string = expandPlaceholders(constants, id)(token);
    const anchor: string | undefined = Object.keys(ANCHOR_SCOPE).find((a: string): boolean =>
      expanded.startsWith(a),
    );
    const hasAnchor: boolean = anchor !== undefined;
    const rest: string = hasAnchor ? expanded.slice((anchor as string).length) : expanded;
    if (rest.includes('{{')) return null;
    if (!hasAnchor && (rest.startsWith('/') || rest.startsWith('~') || !isFileLike(rest))) {
      return null;
    }
    const segments: string[] = rest
      .split('/')
      .filter((s: string): boolean => s !== '' && s !== '.');
    if (segments.length === 0 || segments.includes('..')) return null;
    const path: string = segments.join('/') + (rest.endsWith('/') ? '/' : '');
    return hasAnchor && ANCHOR_SCOPE[anchor as string] === 'run'
      ? { scope: 'run', path }
      : {
          scope: 'knowledge',
          path: `${hasAnchor && (anchor as string) !== OUTPUT_ANCHOR ? (anchor as string) : '{{rootPath}}/'}${path}`,
        };
  };

const LEADING = /^["'(]+/;
const TRAILING = /["')\];,&|>]+$/;

/**
 * A hook command split into plain text and path tokens: every run of non-space characters
 * that looks like a path (it has a `/`, or is one `{{placeholder}}`), placeholder prefix
 * included, is ONE piece with `target: null` until it is resolved. Surrounding quotes and
 * shell punctuation stay in the text. The pieces joined give the command back. Pure.
 */
export const tokenizeHook = (command: string): { text: string; path: boolean }[] =>
  command.split(/(\s+)/).flatMap((part: string): { text: string; path: boolean }[] => {
    if (part === '' || /^\s+$/.test(part)) return part === '' ? [] : [{ text: part, path: false }];
    const lead: string = LEADING.exec(part)?.[0] ?? '';
    const core: string = part.slice(lead.length);
    const trail: string = TRAILING.exec(core)?.[0] ?? '';
    const token: string = core.slice(0, core.length - trail.length);
    const looksLikePath: boolean =
      token !== '' &&
      !token.startsWith('-') &&
      !token.includes('://') &&
      (token.includes('/') || /^\{\{\w+\}\}$/.test(token));
    return [
      { text: lead, path: false },
      { text: token, path: looksLikePath },
      { text: trail, path: false },
    ].filter((piece: { text: string }): boolean => piece.text !== '');
  });

/** A hook command as text and chips: path tokens that resolve carry their `target`. Pure. */
export const hookSegments =
  (constants: HookConstants, id: string) =>
  (command: string): HookSegment[] =>
    tokenizeHook(command).reduce((out: HookSegment[], piece): HookSegment[] => {
      const target: HookTarget | null = piece.path
        ? resolveHookPath(constants, id)(piece.text)
        : null;
      const last: HookSegment | undefined = out[out.length - 1];
      // Neighbouring plain pieces are one run of text.
      return target === null && last !== undefined && last.target === null
        ? [...out.slice(0, -1), { text: last.text + piece.text, target: null }]
        : [...out, { text: piece.text, target }];
    }, []);
