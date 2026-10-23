import { useEffect, useRef } from 'react';

/**
 * Plays `src` once each time `count` goes up, never on the first render or when it goes down.
 * A browser that has not seen a click on the page yet refuses to play; that is ignored.
 */
export const useChime = (src: string, count: number): void => {
  const previous = useRef<number | null>(null);

  useEffect((): void => {
    const before: number | null = previous.current;
    previous.current = count;
    if (before === null || count <= before) return;
    const audio: HTMLAudioElement = new Audio(src);
    audio.volume = 0.6;
    audio.play().catch((): void => undefined);
  }, [src, count]);
};
