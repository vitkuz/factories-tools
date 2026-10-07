import type { z } from "zod";
import type {
  actorFactSchema,
  actorKindSchema,
  billingModeSchema,
  costCertaintySchema,
  providerSchema,
  providerUnitSchema,
  provenanceSourceSchema,
  runFactSchema,
  tokenUsageSchema,
  usageEventSchema,
  usageQualitySchema,
  usageScopeSchema,
} from "./usage-event.schema.js";

export type Provider = z.infer<typeof providerSchema>;
export type ActorKind = z.infer<typeof actorKindSchema>;
export type UsageScope = z.infer<typeof usageScopeSchema>;
export type BillingMode = z.infer<typeof billingModeSchema>;
export type CostCertainty = z.infer<typeof costCertaintySchema>;
export type UsageQuality = z.infer<typeof usageQualitySchema>;
export type ProvenanceSource = z.infer<typeof provenanceSourceSchema>;
export type ProviderUnit = z.infer<typeof providerUnitSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type UsageEvent = z.infer<typeof usageEventSchema>;
export type ActorFact = z.infer<typeof actorFactSchema>;
export type RunFact = z.infer<typeof runFactSchema>;
