import path from "node:path";
import { fileURLToPath } from "node:url";
import { rateCardRegistrySchema } from "../contract/rate-card.schema.js";
import type {
  RateCard,
  RateCardRegistry,
  ResolveRateCard,
  ResolveRateCardInput,
} from "../contract/rate-card.types.js";
import { listFilesRecursive, readJsonFile } from "../shared/utils/fs.utils.js";
import { normalizeModelId } from "../shared/utils/model.utils.js";
import { logger } from "../shared/utils/logger.js";

const here: string = path.dirname(fileURLToPath(import.meta.url));

export const BUILTIN_REGISTRY_DIR: string = path.join(here, "registry");

export type RateCardResolverSettings = {
  /** Directories scanned for *.json registries. Later directories override earlier ones by card id. */
  registryDirs: string[];
};

export const loadRegistry = async (dirs: string[]): Promise<RateCard[]> => {
  const files: string[] = (
    await Promise.all(dirs.map((d: string): Promise<string[]> => listFilesRecursive(d, ".json")))
  ).flat();
  const cards: RateCard[] = (
    await Promise.all(
      files.map(async (file: string): Promise<RateCard[]> => {
        const raw: unknown = await readJsonFile<unknown>(file, { rateCards: [] });
        const parsed = rateCardRegistrySchema.safeParse(raw);
        if (!parsed.success) {
          logger.warn("invalid rate card registry file skipped", {
            file,
            issues: parsed.error.issues.length,
          });
          return [];
        }
        const registry: RateCardRegistry = parsed.data;
        return registry.rateCards;
      }),
    )
  ).flat();
  const byId: Map<string, RateCard> = new Map<string, RateCard>();
  cards.forEach((card: RateCard): void => {
    byId.set(card.id, card);
  });
  return Array.from(byId.values());
};

const matchesModel = (card: RateCard, model: string): boolean => {
  if (card.model === "*") return true;
  const wanted: string = normalizeModelId(model);
  return [card.model, ...card.aliases].some((m: string): boolean => normalizeModelId(m) === wanted);
};

const effectiveAt = (card: RateCard, timestamp: string): boolean =>
  card.effectiveFrom <= timestamp &&
  (card.effectiveTo === undefined || timestamp < card.effectiveTo);

/**
 * Picks the most recent effective card for provider+model at `timestamp`.
 * Billing mode is a preference, not a hard filter: an api-payg card still yields the
 * list-price equivalent for a subscription run (the summary keeps billedUsd unknown).
 */
export const createRateCardResolver = (settings: RateCardResolverSettings): ResolveRateCard => {
  const loaded: Promise<RateCard[]> = loadRegistry(settings.registryDirs);
  return async (input: ResolveRateCardInput): Promise<RateCard | null> => {
    const cards: RateCard[] = await loaded;
    const candidates: RateCard[] = cards
      .filter(
        (c: RateCard): boolean =>
          c.provider === input.provider &&
          matchesModel(c, input.model) &&
          effectiveAt(c, input.timestamp),
      )
      .sort((a: RateCard, b: RateCard): number => {
        const modeA: number = a.billingMode === input.billingMode ? 1 : 0;
        const modeB: number = b.billingMode === input.billingMode ? 1 : 0;
        const exactA: number = a.model === "*" ? 0 : 1;
        const exactB: number = b.model === "*" ? 0 : 1;
        return exactB - exactA || modeB - modeA || b.effectiveFrom.localeCompare(a.effectiveFrom);
      });
    return candidates[0] ?? null;
  };
};
