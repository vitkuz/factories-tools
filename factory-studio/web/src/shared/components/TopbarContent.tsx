import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The top bar has one slot after the screen tabs, and the screen on show fills it: the Runs
 * index puts its live indicator there, a run its header line, Sessions its refresh. The shell
 * owns the slot element and hands it down here; a screen renders `<TopbarContent>` and its
 * children land in the slot, so a bar that depends on the screen's own state stays with the
 * screen. Nothing is drawn until the slot is mounted (the first commit of the shell).
 */
export const TopbarSlotContext = createContext<HTMLElement | null>(null);

interface TopbarContentProps {
  children: ReactNode;
}

export const TopbarContent = ({ children }: TopbarContentProps): ReactNode => {
  const slot: HTMLElement | null = useContext(TopbarSlotContext);
  return slot ? createPortal(children, slot) : null;
};
