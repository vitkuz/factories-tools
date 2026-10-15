/**
 * Copy text to the clipboard: the async API first (any secure origin, localhost included),
 * then the selection fallback inside the open modal, where a focusable element must live
 * while a `<dialog>` is modal. Resolves to whether it worked; never throws.
 */
const copyViaSelection = (text: string): boolean => {
  const host: Element = document.querySelector('dialog[open]') ?? document.body;
  const area: HTMLTextAreaElement = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  host.append(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
};

export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyViaSelection(text);
  }
};
