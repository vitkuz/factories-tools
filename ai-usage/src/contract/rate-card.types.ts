import type { z } from "zod";
import type { rateCardRegistrySchema, rateCardSchema } from "./rate-card.schema.js";
import type { BillingMode, Provider } from "./usage-event.types.js";

export type RateCard = z.infer<typeof rateCardSchema>;
export type RateCardRegistry = z.infer<typeof rateCardRegistrySchema>;

export type ResolveRateCardInput = {
  provider: Provider;
  model: string;
  timestamp: string;
  billingMode: BillingMode;
};

export type ResolveRateCard = (input: ResolveRateCardInput) => Promise<RateCard | null>;
