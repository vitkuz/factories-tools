/**
 * The raw remainder of a URL after `marker`, without the query string. Express 5 hands a
 * `*path` wildcard back as decoded segments and drops a trailing `/`; the raw text keeps
 * both the encoding (each segment is decoded once, later) and the folder marker. Pure.
 */
export const rawPathAfter = (originalUrl: string, marker: string): string => {
  const pathOnly: string = originalUrl.split('?')[0] ?? '';
  const at: number = pathOnly.indexOf(marker);
  return at === -1 ? '' : pathOnly.slice(at + marker.length);
};
