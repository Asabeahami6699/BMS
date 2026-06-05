import { z } from "zod";
import { tenantAddonSchema } from "./addons.js";
import { normalizeTenantModule, tenantProductModuleSchema } from "./modules.js";

export const subscriptionStatusSchema = z.enum(["active", "inactive"]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const tenantRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  subscriptionStatus: subscriptionStatusSchema,
  subscribedModules: z.array(tenantProductModuleSchema),
  subscribedAddons: z.array(tenantAddonSchema).optional(),
  reportsAnalytics: z.boolean().optional(),
  createdAt: z.string().optional()
});

export type TenantRecord = z.infer<typeof tenantRecordSchema>;

export const updateTenantModulesSchema = z.object({
  subscribedModules: z.preprocess(
    (val) => {
      if (!Array.isArray(val)) {
        return val;
      }
      return val.map((item) => normalizeTenantModule(String(item)) ?? item);
    },
    z.array(tenantProductModuleSchema).min(1)
  )
});

export const updateTenantAddonsSchema = z.object({
  subscribedAddons: z.array(tenantAddonSchema)
});