// Learned from factories-tools/run-state/src/shared/utils/fp.utils.ts
type Fn<A, B> = (value: A) => B;

/** Left-to-right composition: `pipe(f, g, h)(x)` is `h(g(f(x)))`. */
export function pipe<A, B>(ab: Fn<A, B>): Fn<A, B>;
export function pipe<A, B, C>(ab: Fn<A, B>, bc: Fn<B, C>): Fn<A, C>;
export function pipe<A, B, C, D>(ab: Fn<A, B>, bc: Fn<B, C>, cd: Fn<C, D>): Fn<A, D>;
export function pipe<A, B, C, D, E>(
  ab: Fn<A, B>,
  bc: Fn<B, C>,
  cd: Fn<C, D>,
  de: Fn<D, E>,
): Fn<A, E>;
export function pipe(...fns: Fn<unknown, unknown>[]): Fn<unknown, unknown> {
  return (value: unknown): unknown =>
    fns.reduce((acc: unknown, fn: Fn<unknown, unknown>): unknown => fn(acc), value);
}

/** Same-type composition of any length — what a chain of state transitions is. */
export const flow =
  <T>(...fns: Fn<T, T>[]): Fn<T, T> =>
  (value: T): T =>
    fns.reduce((acc: T, fn: Fn<T, T>): T => fn(acc), value);

export const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/** A record with every value changed, keys kept. */
export const mapValues =
  <A, B>(change: (value: A, key: string) => B) =>
  (record: Readonly<Record<string, A>>): Record<string, B> =>
    Object.fromEntries(
      Object.entries(record).map(([key, value]: [string, A]): [string, B] => [
        key,
        change(value, key),
      ]),
    );

/** Keys sorted, so two records with the same content serialize the same. */
export const sortKeys = <V>(record: Readonly<Record<string, V>>): Record<string, V> =>
  Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key: string): [string, V] => [key, record[key] as V]),
  );

/** An object spread helper: `{ ...when(flag, { key })}` keeps the key only when `flag` holds. */
export const when = <T extends object>(flag: boolean, fields: T): T | Record<never, never> =>
  flag ? fields : {};

/** `{ key: value }` when value is defined, else nothing to spread. */
export const defined = <K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<never, never> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);
