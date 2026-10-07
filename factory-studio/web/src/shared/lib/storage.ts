/** Browser storage that never throws: a private window with storage disabled is not a reason to break a screen. */

export const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw: string | null = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const writeJson = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage disabled or full: positions are a convenience, not data
  }
};
