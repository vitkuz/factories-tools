import { z } from "zod";
import { billingModeSchema, providerSchema } from "./usage-event.schema.js";

export const rateCardSchema = z.object({
  /** e.g. "anthropic/claude-opus-5/2026-06-01" - never mutate a published id. */
  id: z.string().min(1),
  provider: providerSchema,
  model: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  effectiveFrom: z.string(),
  effectiveTo: z.string().optional(),
  billingMode: billingModeSchema,
  inputPerMillion: z.number().optional(),
  cachedInputPerMillion: z.number().optional(),
  cacheWritePerMillion: z.number().optional(),
  cacheWriteLongTtlPerMillion: z.number().optional(),
  outputPerMillion: z.number().optional(),
  currency: z.literal("USD").default("USD"),
  providerCreditConversion: z
    .object({
      unit: z.string(),
      usdPerUnit: z.number(),
    })
    .optional(),
  source: z.string(),
  notes: z.string().optional(),
});

export const rateCardRegistrySchema = z.object({
  rateCards: z.array(rateCardSchema),
});
