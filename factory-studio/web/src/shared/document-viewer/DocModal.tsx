import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  docUrl,
  fetchDoc,
  isMarkdownPath,
  joinDocPath,
  resolveRelative,
  saveDoc,
  type DocContent,
  type DocRef,
  type SaveResult,
} from './docs';
import type { DirEntry } from './docs.schema';
import { CodeView, TokenSpans } from './CodeView';
import {
  extLabel,
  languageOf,
  languageOfName,
  textStats,
  tokenize,
  type Language,
  type TextStats,
} from './highlight.utils';
import { formatBytes } from '../../features/runs/lib/format';
import { copyText } from '../lib/clipboard';
import { displayDocPath, pathBasename } from '../graph/text';

interface Props {
  doc: DocRef;
  /** The person may rewrite this document: the Edit button next to Rendered / Raw. */
  editable: boolean;
  /** A doc opened from inside another doc: show Back. */
  canBack: boolean;
  onBack: () => void;
  onClose: () => void;
  /** A link or folder entry inside the doc opens on top of it. */
  onOpen: (ref: DocRef) => void;
}

type Mode = 'rendered' | 'raw' | 'edit';
type Loaded = { status: 'loading' } | { status: 'ready'; content: DocContent };
/** The Copy button's word: what it does, then for a moment what it did. */
type Copied = 'idle' | 'copied' | 'failed';
/** The editor's own state: idle, writing, or the outcome of the last write. */
type Save =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'failed'; message: string };

interface SplitPath {
  dir: string;
  base: string;
}

const splitPath = (path: string): SplitPath => {
  const base: string = pathBasename(path);
  return { dir: path.slice(0, path.length - base.length), base };
};

const isExternal = (href: string): boolean => /^https?:/i.test(href);

/** The header's word for where the document comes from. */
const scopeWord = (doc: DocRef): string => {
  switch (doc.scope) {
    case 'pipeline':
      return 'knowledge';
    case 'run':
      return 'run document';
    case 'script':
      return 'script';
    case 'inline':
      return 'pipeline.json';
    case 'artifact':
      return 'artifact';
  }
};

/** The path the header prints: a script under its folder, a knowledge file without its template. */
const shownPath = (doc: DocRef): string =>
  doc.scope === 'script' ? `scripts/${doc.path}` : displayDocPath(doc.path);

const FENCE_LANGUAGE = /(?:^|\s)language-([\w+-]+)/;

/**
 * A fenced code block of a rendered document, coloured when its info string names a grammar
 * the highlighter knows; inline code (no `language-` class) is left as it is. Tokens are
 * React text, never HTML, and there are no line numbers here — the fence is prose, not a file.
 */
const FencedCode = ({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}): ReactNode => {
  const name: string | undefined = FENCE_LANGUAGE.exec(className ?? '')?.[1];
  const language: Language = name === undefined ? 'text' : languageOfName(name);
  if (language === 'text' || language === 'md' || typeof children !== 'string')
    return <code className={className}>{children}</code>;
  return (
    <code className={className}>
      <TokenSpans tokens={tokenize(children, language)} />
    </code>
  );
};

/** Images and links inside a doc resolve against the doc's own folder, in the same scope. */
const markdownComponents = (doc: DocRef, onOpen: (ref: DocRef) => void): Components => ({
  code: FencedCode,
  img: ({ src, alt, title }) => {
    const ref: DocRef | null = typeof src === 'string' ? resolveRelative(doc, src) : null;
    const url: string | undefined = ref ? docUrl(ref) : typeof src === 'string' ? src : undefined;
    return <img src={url} alt={alt ?? ''} title={title} loading="lazy" />;
  },
  a: ({ href, title, children }) => {
    const target: string = typeof href === 'string' ? href : '';
    const ref: DocRef | null = resolveRelative(doc, target);
    if (ref) {
      return (
        <a
          href={docUrl(ref)}
          title={title}
          onClick={(e: MouseEvent<HTMLAnchorElement>) => {
            e.preventDefault();
            onOpen(ref);
          }}
        >
          {children}
        </a>
      );
    }
    return (
      <a
        href={target}
        title={title}
        target={isExternal(target) ? '_blank' : undefined}
        rel={isExternal(target) ? 'noopener noreferrer' : undefined}
      >
        {children}
      </a>
    );
  },
});

const byFoldersFirst = (a: DirEntry, b: DirEntry): number =>
  a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "32 files", "2 folders, 30 files" — the one-line summary above a listing. */
const dirSummary = (entries: readonly DirEntry[]): string => {
  const folders: number = entries.filter((e) => e.type === 'directory').length;
  const files: number = entries.length - folders;
  return [folders > 0 ? plural(folders, 'folder') : '', files > 0 ? plural(files, 'file') : '']
    .filter(Boolean)
    .join(', ');
};

function DirList({
  doc,
  entries,
  onOpen,
}: {
  doc: DocRef;
  entries: DirEntry[];
  onOpen: (ref: DocRef) => void;
}) {
  const sorted: DirEntry[] = [...entries].sort(byFoldersFirst);
  if (sorted.length === 0) return <p className="doc-state">This folder is empty.</p>;
  return (
    <>
      <p className="doc-dir-summary">{dirSummary(sorted)}</p>
      <ul className="doc-dir">
        {sorted.map((entry: DirEntry) => {
          const directory: boolean = entry.type === 'directory';
          return (
            <li key={entry.name}>
              <button
                type="button"
                className="doc-dir-entry"
                onClick={() =>
                  onOpen({ ...doc, path: joinDocPath(doc.path, entry.name, directory) })
                }
              >
                <span className="doc-dir-name">
                  {entry.name}
                  {directory ? '/' : ''}
                </span>
                <span className="doc-dir-size">{directory ? '' : formatBytes(entry.size)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const canToggle = (loaded: Loaded): boolean =>
  loaded.status === 'ready' && loaded.content.kind === 'markdown';

/** The text Copy puts on the clipboard: the file's source, never the rendering. */
const copyableText = (loaded: Loaded): string | null =>
  loaded.status === 'ready' &&
  (loaded.content.kind === 'markdown' || loaded.content.kind === 'text')
    ? loaded.content.text
    : null;

/** How long "Copied" stays on the button. */
const COPIED_MS = 1500;

/**
 * What can be rewritten by hand: a text document, and one a step has not written yet (a
 * person writing the input of a human step creates it). Never a folder, image or blob.
 */
const canEdit = (loaded: Loaded): boolean =>
  loaded.status === 'ready' && ['markdown', 'text', 'missing'].includes(loaded.content.kind);

/** The text the editor starts from: the file as it is on disk, or empty for a file yet to exist. */
const editableText = (loaded: Loaded): string =>
  loaded.status === 'ready' &&
  (loaded.content.kind === 'markdown' || loaded.content.kind === 'text')
    ? loaded.content.text
    : '';

/** A one-paragraph state (missing, snapshot, binary, error) gets a frame that hugs it, not a document's. */
const isNotice = (loaded: Loaded): boolean =>
  loaded.status === 'loading' ||
  !['markdown', 'text', 'image', 'directory'].includes(loaded.content.kind);

/**
 * The dialog's height class: a notice and an image are as tall as their content (up to the
 * document maximum — a tall screenshot scrolls inside the body); a document takes the full frame.
 */
const frameClass = (loaded: Loaded, mode: Mode): string =>
  mode === 'edit'
    ? ''
    : isNotice(loaded)
      ? ' is-notice'
      : loaded.status === 'ready' && loaded.content.kind === 'image'
        ? ' is-image'
        : '';

/** What the last write did, next to the Save button: nothing to say when the draft is untouched. */
function SaveState({ save, dirty }: { save: Save; dirty: boolean }) {
  if (save.status === 'failed')
    return (
      <span className="doc-save-state is-failed" role="status">
        Not saved: {save.message}
      </span>
    );
  if (save.status === 'saved' && !dirty)
    return (
      <span className="doc-save-state is-saved" role="status">
        Saved
      </span>
    );
  if (dirty)
    return (
      <span className="doc-save-state" role="status">
        Unsaved changes
      </span>
    );
  return null;
}

/** A fetch slower than this shows its "Loading…" notice instead of leaving the page unchanged. */
const SLOW_FETCH_MS = 250;

/**
 * The document modal: a native `<dialog>` (focus stays inside, Escape closes through the
 * element's own `close`, so the browser hands focus back to the link that opened it) showing a run doc rendered as markdown, its raw source,
 * an image, or a folder listing — and saying plainly when the file is not there, or when
 * it is an input/output path opened from the editor, which no run has written.
 *
 * An `editable` document (the input docs of a human step) also carries **Edit**: the third
 * button of the view group turns the body into a plain textarea with a Save that writes
 * the file back through the API. Closing with unsaved text asks first.
 */
export default function DocModal({ doc, editable, canBack, onBack, onClose, onOpen }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [slow, setSlow] = useState<boolean>(false);
  const [mode, setMode] = useState<Mode>('rendered');
  const [draft, setDraft] = useState<string>('');
  const [save, setSave] = useState<Save>({ status: 'idle' });
  const [copied, setCopied] = useState<Copied>('idle');
  const dirty: boolean = mode === 'edit' && draft !== editableText(loaded);
  const { dir, base }: SplitPath = splitPath(shownPath(doc));
  const language: Language = languageOf(doc.path);
  const source: string | null = copyableText(loaded);
  const stats: TextStats | null = source === null ? null : textStats(source);
  const components: Components = useMemo(() => markdownComponents(doc, onOpen), [doc, onOpen]);

  // "Copied" (or "Copy failed") shows for a moment, then the button is itself again.
  useEffect(() => {
    if (copied === 'idle') return;
    const timer: number = window.setTimeout(() => setCopied('idle'), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async (): Promise<void> => {
    // In the editor the draft is what the person is looking at.
    const text: string | null = mode === 'edit' ? draft : source;
    if (text === null) return;
    setCopied((await copyText(text)) ? 'copied' : 'failed');
  };

  // Focus goes back to the link that opened the modal: the browser does it on `close()`,
  // and the cleanup covers the modal being unmounted while open (a run switch).
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    openerRef.current ??= document.activeElement;
    const dialog: HTMLDialogElement | null = dialogRef.current;
    return () => {
      const opener: Element | null = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected && !dialog?.open) opener.focus();
    };
  }, []);

  // The dialog is shown once the content is known (a local fetch, a few ms) so its frame
  // is the right size on first paint — a document's, or a notice's — and never jumps; a
  // slow fetch shows the frame with "Loading…" instead of leaving the page unchanged.
  // The body takes focus (it is the scrolling element, so arrow keys scroll the document
  // and Enter does nothing), on open and again for every document opened in the modal.
  const ready: boolean = loaded.status === 'ready' || slow;
  useEffect(() => {
    if (!ready) return;
    const dialog: HTMLDialogElement | null = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    bodyRef.current?.focus({ preventScroll: true });
  }, [ready, doc]);

  // Unsaved text is never dropped silently: Escape, the Close button and a backdrop click
  // all ask first (the browser's own confirm — one sentence, no second dialog to build).
  const confirmDiscard = (): boolean =>
    !dirty || window.confirm(`Discard your unsaved changes to ${base}?`);

  const requestClose = (): void => {
    if (!confirmDiscard()) return;
    const dialog: HTMLDialogElement | null = dialogRef.current;
    if (dialog?.open) dialog.close();
    else onClose();
  };

  const startEditing = (): void => {
    setDraft(editableText(loaded));
    setSave({ status: 'idle' });
    setMode('edit');
  };

  /** Leave the editor for a reading mode; unsaved text is confirmed away first. */
  const showMode = (next: Mode): void => {
    if (mode === 'edit' && next !== 'edit' && !confirmDiscard()) return;
    setMode(next);
  };

  const persist = async (): Promise<void> => {
    if (save.status === 'saving') return;
    const text: string = draft;
    setSave({ status: 'saving' });
    const result: SaveResult = await saveDoc(doc, text);
    if (!result.ok) {
      setSave({ status: 'failed', message: result.message });
      return;
    }
    // The file on disk is now the draft: the reading modes show it without another fetch.
    setLoaded({
      status: 'ready',
      content: isMarkdownPath(doc.path) ? { kind: 'markdown', text } : { kind: 'text', text },
    });
    setSave({ status: 'saved' });
  };

  // The editor takes focus when it appears, with the caret at the start of the document.
  useEffect(() => {
    if (mode !== 'edit') return;
    const editor: HTMLTextAreaElement | null = editorRef.current;
    if (!editor) return;
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(0, 0);
  }, [mode]);

  // `<dialog>` does not lock the page behind it; the class does (see index.css).
  useEffect(() => {
    document.documentElement.classList.add('has-modal');
    return () => document.documentElement.classList.remove('has-modal');
  }, []);

  useEffect(() => {
    const controller: AbortController = new AbortController();
    setLoaded({ status: 'loading' });
    setSlow(false);
    setMode('rendered');
    setDraft('');
    setSave({ status: 'idle' });
    setCopied('idle');
    const timer: number = window.setTimeout(() => setSlow(true), SLOW_FETCH_MS);
    void fetchDoc(doc, controller.signal).then((content: DocContent): void => {
      if (!controller.signal.aborted) setLoaded({ status: 'ready', content });
    });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [doc]);

  const body = (): ReactNode => {
    if (mode === 'edit')
      return (
        <textarea
          ref={editorRef}
          className="doc-edit"
          value={draft}
          spellCheck={false}
          aria-label={`Edit ${doc.path}`}
          onChange={(e) => {
            setDraft(e.target.value);
            if (save.status !== 'saving') setSave({ status: 'idle' });
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
              e.preventDefault();
              void persist();
            }
          }}
        />
      );
    if (loaded.status === 'loading') return <p className="doc-state">Loading {base}…</p>;
    const content: DocContent = loaded.content;
    switch (content.kind) {
      case 'markdown':
        return mode === 'raw' ? (
          <CodeView text={content.text} language="md" />
        ) : (
          <div className="doc-prose">
            <Markdown remarkPlugins={[remarkGfm]} components={components}>
              {content.text}
            </Markdown>
          </div>
        );
      case 'text':
        return <CodeView text={content.text} language={language} />;
      case 'image':
        return (
          <figure className="doc-image">
            <img src={content.url} alt={base} />
          </figure>
        );
      case 'directory':
        return <DirList doc={doc} entries={content.entries} onOpen={onOpen} />;
      case 'binary':
        return <p className="doc-state">{base} is not a text file, so it cannot be shown here.</p>;
      case 'missing':
        return (
          <p className="doc-state">
            <code>{doc.path}</code> has not been written yet.
          </p>
        );
      case 'editor':
        return (
          <p className="doc-state">
            You are in the editor. No documents are available for input and output paths:{' '}
            <code>{doc.path}</code> is written by a run. Open the run on the Runs screen to read it.
          </p>
        );
      case 'unavailable':
        return (
          <p className="doc-state">
            The API did not answer this document as a file. Check that the Factory Studio API is
            serving this page and try again.
          </p>
        );
      case 'error':
        return (
          <p className="doc-state">
            Could not load {base}: {content.message}.
          </p>
        );
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={`doc-dialog${frameClass(loaded, mode)}`}
      aria-label={doc.path}
      onCancel={(e) => {
        if (!confirmDiscard()) e.preventDefault();
      }}
      onClose={onClose}
      onClick={(e: MouseEvent<HTMLDialogElement>) => {
        if (e.target === dialogRef.current) requestClose();
      }}
    >
      <div className="doc-modal">
        <header className="doc-modal-head">
          {canBack && (
            <button type="button" className="doc-modal-btn" onClick={onBack}>
              Back
            </button>
          )}
          <span className="doc-modal-ext" aria-hidden="true">
            {extLabel(doc.path)}
          </span>
          <span className="doc-modal-path" title={doc.path}>
            <span className="doc-modal-dir">{dir}</span>
            {base}
          </span>
          <span className="doc-modal-scope">{scopeWord(doc)}</span>
          <div className="doc-modal-tools">
            {mode === 'edit' && <SaveState save={save} dirty={dirty} />}
            {source !== null && (
              <button
                type="button"
                className={`doc-modal-btn${copied === 'copied' ? ' is-copied' : ''}`}
                onClick={() => void copy()}
                title="Copy the source to the clipboard"
                aria-live="polite"
              >
                {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
              </button>
            )}
            {(canToggle(loaded) || (editable && canEdit(loaded))) && (
              <div className="doc-mode" role="group" aria-label="View">
                {canToggle(loaded) && (
                  <>
                    <button
                      type="button"
                      className="doc-modal-btn"
                      aria-pressed={mode === 'rendered'}
                      onClick={() => showMode('rendered')}
                    >
                      Rendered
                    </button>
                    <button
                      type="button"
                      className="doc-modal-btn"
                      aria-pressed={mode === 'raw'}
                      onClick={() => showMode('raw')}
                    >
                      Raw
                    </button>
                  </>
                )}
                {editable && canEdit(loaded) && (
                  <button
                    type="button"
                    className="doc-modal-btn"
                    aria-pressed={mode === 'edit'}
                    onClick={startEditing}
                    title={`Edit ${doc.path}`}
                  >
                    Edit
                  </button>
                )}
              </div>
            )}
            {mode === 'edit' && (
              <button
                type="button"
                className="doc-modal-btn is-primary"
                disabled={save.status === 'saving' || !dirty}
                onClick={() => void persist()}
              >
                {save.status === 'saving' ? 'Saving…' : 'Save'}
              </button>
            )}
            <button type="button" className="doc-modal-btn" onClick={requestClose}>
              Close
            </button>
          </div>
        </header>
        <div className="doc-modal-body" ref={bodyRef} tabIndex={-1}>
          {body()}
        </div>
        {stats !== null && mode !== 'edit' && (
          <footer className="doc-modal-foot">
            <span>{base}</span>
            <span>
              {stats.lines} lines · {stats.chars} chars
            </span>
          </footer>
        )}
      </div>
    </dialog>
  );
}
