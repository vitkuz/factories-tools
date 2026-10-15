import { Fragment, useMemo, type ReactNode } from 'react';
import {
  tokenize,
  tokenLines,
  withoutFinalNewline,
  type Language,
  type Token,
} from './highlight.utils';

/** Past this many characters the tokens are not worth the time: the file shows plain, still numbered. */
const HIGHLIGHT_LIMIT = 400_000;

/** Tokens as text, coloured by class; a plain token is just text. */
export const TokenSpans = ({ tokens }: { tokens: readonly Token[] }): ReactNode =>
  tokens.map((token: Token, k: number): ReactNode =>
    token.type === 'plain' ? (
      <Fragment key={k}>{token.text}</Fragment>
    ) : (
      <span key={k} className={`tok-${token.type}`}>
        {token.text}
      </span>
    ),
  );

interface CodeViewProps {
  text: string;
  language: Language;
}

/**
 * A file as code: one numbered row per line, long lines scroll inside the box (the modal
 * never widens). The numbers are not selectable, so a drag-select copies the text alone.
 */
export const CodeView = ({ text, language }: CodeViewProps): ReactNode => {
  const lines: Token[][] = useMemo(
    (): Token[][] =>
      tokenLines(
        tokenize(withoutFinalNewline(text), text.length > HIGHLIGHT_LIMIT ? 'text' : language),
      ),
    [text, language],
  );
  return (
    <pre className="doc-code">
      <code>
        {lines.map((line: Token[], i: number) => (
          <span key={i} className="doc-code-line">
            <span className="doc-code-ln" aria-hidden="true">
              {i + 1}
            </span>
            <span className="doc-code-text">
              <TokenSpans tokens={line} />
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
};
