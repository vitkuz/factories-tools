import type { CustomerRule, UsageConfig } from "../../storage/usage-store.js";

const normalize = (p: string): string => p.replace(/\/+$/, "");

/** Longest matching cwd prefix wins. */
export const resolveCustomer =
  (config: UsageConfig) =>
  (project: string | undefined): string | undefined => {
    if (!project) return undefined;
    const target: string = normalize(project);
    const matches: Array<{ name: string; length: number }> = config.customers.flatMap(
      (rule: CustomerRule) =>
        rule.cwdPrefixes
          .map(normalize)
          .filter((prefix: string): boolean => target === prefix || target.startsWith(prefix + "/"))
          .map((prefix: string): { name: string; length: number } => ({
            name: rule.name,
            length: prefix.length,
          })),
    );
    return matches.sort((a, b): number => b.length - a.length)[0]?.name;
  };

export const addCustomerRule = (
  config: UsageConfig,
  name: string,
  cwdPrefix: string,
): UsageConfig => {
  const existing: CustomerRule | undefined = config.customers.find(
    (c: CustomerRule): boolean => c.name === name,
  );
  const prefixes: string[] = Array.from(
    new Set<string>([...(existing?.cwdPrefixes ?? []), normalize(cwdPrefix)]),
  );
  const others: CustomerRule[] = config.customers.filter(
    (c: CustomerRule): boolean => c.name !== name,
  );
  return { ...config, customers: [...others, { name, cwdPrefixes: prefixes }] };
};
