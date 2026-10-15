/** The slice of a logger every layer below the controllers is handed. Winston satisfies it. */
export interface AppLogger {
  debug: (message: string, context?: unknown) => void;
  info: (message: string, context?: unknown) => void;
  warn: (message: string, context?: unknown) => void;
  error: (message: string, context?: unknown) => void;
}

/** An error that already knows which HTTP status it deserves. A plain object, never a class. */
export interface HttpError {
  readonly httpError: true;
  readonly status: number;
  readonly message: string;
  readonly details?: unknown;
}
