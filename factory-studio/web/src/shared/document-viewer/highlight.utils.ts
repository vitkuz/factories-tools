/**
 * A small syntax highlighter for what the modal shows: JSON (and JSON Lines, line by
 * line), scripts (JavaScript / TypeScript, shell, Python) and YAML. Everything here is pure
 * and returns tokens — React renders them as text, so a file is never turned into HTML.
 */

export type Language = 'json' | 'js' | 'sh' | 'py' | 'yaml' | 'md' | 'text';

export type TokenType =
  | 'plain'
  | 'comment'
  | 'string'
  | 'key'
  | 'number'
  | 'keyword'
  | 'punct'
  | 'variable'
  | 'type'
  | 'decorator';

export interface Token {
  type: TokenType;
  text: string;
}

type TokenLanguage = Exclude<Language, 'md' | 'text'>;

/** A fenced block's info string or a file extension → the grammar that reads it. */
const LANGUAGE_BY_NAME: Readonly<Record<string, Language>> = {
  json: 'json',
  jsonl: 'json',
  ndjson: 'json',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  jsx: 'js',
  ts: 'js',
  tsx: 'js',
  javascript: 'js',
  typescript: 'js',
  sh: 'sh',
  bash: 'sh',
  zsh: 'sh',
  shell: 'sh',
  console: 'sh',
  py: 'py',
  python: 'py',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'md',
  markdown: 'md',
};

/** `x.tar.gz` → `gz`; nothing after the last `.` (or no `.`) → `''`. */
export const extensionOf = (path: string): string =>
  /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';

export const languageOfName = (name: string): Language =>
  LANGUAGE_BY_NAME[name.toLowerCase()] ?? 'text';

export const languageOf = (path: string): Language => languageOfName(extensionOf(path));

/** The small badge before a path: `MD`, `JSON`, `PNG`; `DIR` for a folder; `FILE` without an extension. */
export const extLabel = (path: string): string =>
  path.endsWith('/') ? 'DIR' : (extensionOf(path) || 'file').toUpperCase();

const words = (list: string): ReadonlySet<string> => new Set(list.split(' '));

const KEYWORDS: Readonly<Record<TokenLanguage, ReadonlySet<string>>> = {
  json: words('true false null'),
  js: words(
    'const let var function return if else for while do switch case break continue new class extends import export from default await async try catch finally throw typeof instanceof in of this null undefined true false yield static get set delete void interface type enum implements readonly as satisfies keyof declare namespace',
  ),
  sh: words(
    'if then else elif fi for in do done while until case esac function return exit export local set unset readonly shift source echo printf test true false',
  ),
  py: words(
    'def return if elif else for while in not and or is None True False import from as class try except finally with lambda yield pass break continue raise global nonlocal assert del async await print',
  ),
  yaml: words('true false null yes no'),
};

interface Rule {
  type: TokenType | 'word';
  re: RegExp;
}

/** Sticky regexes, tried in order at the current offset; `word` is classified by the keyword set. */
const RULES: Readonly<Record<TokenLanguage, readonly Rule[]>> = {
  json: [
    { type: 'key', re: /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y },
    { type: 'string', re: /"(?:[^"\\\n]|\\.)*"/y },
    { type: 'number', re: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y },
    { type: 'word', re: /[A-Za-z_]\w*/y },
    { type: 'punct', re: /[{}[\]:,]/y },
  ],
  js: [
    { type: 'comment', re: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y },
    { type: 'string', re: /`(?:[^`\\]|\\[\s\S])*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/y },
    { type: 'number', re: /\b0x[\da-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?n?\b/y },
    { type: 'decorator', re: /@[\w.]+/y },
    { type: 'word', re: /[A-Za-z_$][\w$]*/y },
    { type: 'punct', re: /=>|[{}()[\];,.<>=!+\-*/%&|^~?:]/y },
  ],
  sh: [
    { type: 'comment', re: /#[^\n]*/y },
    { type: 'string', re: /"(?:[^"\\]|\\[\s\S])*"|'[^']*'/y },
    { type: 'variable', re: /\$\{[^}]*\}|\$[\w@#?$!*-]+/y },
    { type: 'number', re: /\b\d+\b/y },
    { type: 'word', re: /[A-Za-z_][\w-]*/y },
    { type: 'punct', re: /\|\||&&|[|&;<>(){}[\]=]/y },
  ],
  py: [
    { type: 'comment', re: /#[^\n]*/y },
    {
      type: 'string',
      re: /"""[\s\S]*?"""|'''[\s\S]*?'''|[rbf]?"(?:[^"\\\n]|\\.)*"|[rbf]?'(?:[^'\\\n]|\\.)*'/y,
    },
    { type: 'decorator', re: /@[\w.]+/y },
    { type: 'number', re: /\b\d+(?:\.\d+)?\b/y },
    { type: 'word', re: /[A-Za-z_]\w*/y },
    { type: 'punct', re: /[{}()[\]:,.=<>!+\-*/%&|^~]/y },
  ],
  yaml: [
    { type: 'comment', re: /#[^\n]*/y },
    { type: 'key', re: /[\w.-]+(?=\s*:(?:\s|$))/y },
    { type: 'string', re: /"(?:[^"\\]|\\.)*"|'[^']*'/y },
    { type: 'number', re: /\b\d+(?:\.\d+)?\b/y },
    { type: 'word', re: /[A-Za-z_][\w-]*/y },
    { type: 'punct', re: /[:\-[\]{},|>]/y },
  ],
};

const WHITESPACE = /\s+/y;

/** A `word` is a keyword, a capitalised JS name (a type / constructor), or plain text. */
const classifyWord = (language: TokenLanguage, word: string): TokenType => {
  if (KEYWORDS[language].has(word)) return 'keyword';
  if (language === 'js' && /^[A-Z][\w$]*$/.test(word)) return 'type';
  return 'plain';
};

const matchAt = (re: RegExp, text: string, at: number): string | null => {
  re.lastIndex = at;
  const found: RegExpExecArray | null = re.exec(text);
  return found !== null && found[0].length > 0 ? found[0] : null;
};

/** The next token at `at`: whitespace, the first rule that matches, or the single character. */
const nextToken = (language: TokenLanguage, text: string, at: number): Token => {
  const space: string | null = matchAt(WHITESPACE, text, at);
  if (space !== null) return { type: 'plain', text: space };
  for (const rule of RULES[language]) {
    const hit: string | null = matchAt(rule.re, text, at);
    if (hit === null) continue;
    return { type: rule.type === 'word' ? classifyWord(language, hit) : rule.type, text: hit };
  }
  return { type: 'plain', text: text[at] ?? '' };
};

/**
 * Whole text → tokens, adjacent plain runs merged. Markdown and plain text are one plain
 * token: nothing to colour. A loop, not recursion: a 1 MB file is deeper than a call stack.
 */
export const tokenize = (text: string, language: Language): Token[] => {
  if (language === 'md' || language === 'text') return text === '' ? [] : [{ type: 'plain', text }];
  const tokens: Token[] = [];
  for (let at = 0; at < text.length;) {
    const token: Token = nextToken(language, text, at);
    const last: Token | undefined = tokens[tokens.length - 1];
    if (last !== undefined && last.type === 'plain' && token.type === 'plain') {
      tokens[tokens.length - 1] = { type: 'plain', text: last.text + token.text };
    } else {
      tokens.push(token);
    }
    at += token.text.length;
  }
  return tokens;
};

/** Tokens split at every `\n` into lines (the newline itself is dropped); `''` → one empty line. */
export const tokenLines = (tokens: readonly Token[]): Token[][] =>
  tokens.reduce(
    (lines: Token[][], token: Token): Token[][] => {
      const parts: string[] = token.text.split('\n');
      const [first, ...rest]: string[] = parts;
      const current: Token[] = lines[lines.length - 1] ?? [];
      const head: Token[] =
        first === '' ? current : [...current, { type: token.type, text: first }];
      const tail: Token[][] = rest.map((part: string): Token[] =>
        part === '' ? [] : [{ type: token.type, text: part }],
      );
      return [...lines.slice(0, -1), head, ...tail];
    },
    [[]],
  );

/** A trailing newline ends the last line; it is not an extra empty line to number. */
export const withoutFinalNewline = (text: string): string => text.replace(/\n$/, '');

export interface TextStats {
  lines: number;
  chars: number;
}

export const textStats = (text: string): TextStats => ({
  lines: text === '' ? 0 : withoutFinalNewline(text).split('\n').length,
  chars: text.length,
});
