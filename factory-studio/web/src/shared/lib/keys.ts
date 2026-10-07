/**
 * A single-letter shortcut (`d`) must not fire while the person is typing in a form control
 * (the runs sidebar's search box included) or has a document modal up.
 */
export const isTypingTarget = (target: EventTarget | null): boolean =>
  document.querySelector('dialog[open]') !== null ||
  (target instanceof HTMLElement &&
    (['SELECT', 'INPUT', 'TEXTAREA'].includes(target.tagName) ||
      target.isContentEditable ||
      target.closest('dialog') !== null));

/** The editor's name for the same rule (its own test was a subset of this one). */
export const isEditingShortcutTarget = isTypingTarget;
