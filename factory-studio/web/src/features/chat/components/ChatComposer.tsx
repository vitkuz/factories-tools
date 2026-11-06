import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { ComposerGate, SendState } from '../chat.types';
import { isSendKey } from '../chat.utils';

interface ChatComposerProps {
  gate: ComposerGate;
  send: SendState;
  /** Resolves `true` when the API took the message; the box then empties. */
  onSend: (text: string) => Promise<boolean>;
  onClearError: () => void;
}

const MAX_CHARS = 50_000;

/**
 * The message box under the chat: a textarea that grows with the text, Enter to send and
 * Shift+Enter for a newline. A paste goes in whole (only a key press submits). The box is
 * disabled with a one-line reason while the session cannot take a message, and keeps its
 * text when the API refuses, so nothing typed is lost.
 */
export const ChatComposer = ({
  gate,
  send,
  onSend,
  onClearError,
}: ChatComposerProps): ReactNode => {
  const [text, setText] = useState<string>('');
  const box = useRef<HTMLTextAreaElement | null>(null);
  const ready: boolean = gate.enabled && !send.sending;
  const canSend: boolean = ready && text.trim() !== '';

  // The box opens (a turn ended): put the cursor there unless the person is somewhere else.
  useEffect((): void => {
    const active: Element | null = document.activeElement;
    if (ready && (active === null || active === document.body)) box.current?.focus();
  }, [ready]);

  const submit = async (): Promise<void> => {
    if (!canSend) return;
    const sent: boolean = await onSend(text);
    if (sent) setText('');
    box.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isSendKey({ ...event, isComposing: event.nativeEvent.isComposing })) {
      event.preventDefault();
      void submit();
      return;
    }
    // Escape would close the drawer and lose the draft; with text in the box it only blurs.
    if (event.key === 'Escape' && text !== '') {
      event.preventDefault();
      box.current?.blur();
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void submit();
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    if (send.error !== null) onClearError();
    setText(event.target.value);
  };

  return (
    <form className="chat-composer" onSubmit={onSubmit} aria-label="Message Claude">
      <div className={`chat-composer-box${ready ? '' : ' is-off'}`}>
        <textarea
          ref={box}
          className="chat-composer-input"
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          disabled={!gate.enabled}
          readOnly={send.sending}
          rows={1}
          maxLength={MAX_CHARS}
          placeholder={gate.enabled ? 'Message Claude… (Enter sends, Shift+Enter: new line)' : ''}
          aria-label="Message"
          aria-describedby="chat-composer-hint"
        />
        <button
          type="submit"
          className="btn btn--primary chat-composer-send"
          disabled={!canSend}
          aria-label="Send"
        >
          {send.sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      <p id="chat-composer-hint" className="chat-composer-hint" role="status">
        {send.error !== null ? (
          <span className="chat-composer-error">{send.error}</span>
        ) : send.notice !== null ? (
          <span className="chat-composer-notice">{send.notice}</span>
        ) : gate.reason !== null ? (
          gate.reason
        ) : (
          'Idle session. Enter sends, Shift+Enter adds a line.'
        )}
      </p>
    </form>
  );
};
