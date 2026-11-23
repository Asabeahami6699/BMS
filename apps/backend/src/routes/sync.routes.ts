import { syncBatchSchema } from "@bms/shared";
import { Router } from "express";
import { requireAnyPermission } from "../middleware/requirePermission.js";
import { submitCustomerRegistration } from "../services/customerService.js";
import { addCollectionBatchLine } from "../services/collectionBatchService.js";

export const syncRouter = Router();

syncRouter.post(
  "/batch",
  requireAnyPermission("customers.create", "transactions.read", "transactions.create.deposit"),
  async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = syncBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid sync batch", details: parsed.error.flatten() });
    return;
  }

  const results: Array<{ clientId: string; ok: boolean; error?: string; resourceId?: string }> = [];

  for (const item of parsed.data.items) {
    try {
      if (item.type === "customer_registration") {
        if (!context.permissions.includes("customers.create")) {
          results.push({
            clientId: item.clientId,
            ok: false,
            error: "Insufficient permission to register customers"
          });
          continue;
        }
        const customer = await submitCustomerRegistration(
          context.tenantId,
          context.userId,
          context.branchId,
          item.payload,
          { offlineClientId: item.clientId }
        );
        results.push({ clientId: item.clientId, ok: true, resourceId: customer.id });
      } else {
        if (
          context.role !== "field_agent" &&
          !context.permissions.includes("transactions.create.deposit")
        ) {
          results.push({
            clientId: item.clientId,
            ok: false,
            error: "Insufficient permission to record collections"
          });
          continue;
        }
        const collections = await addCollectionBatchLine(
          {
            tenantId: context.tenantId,
            userId: context.userId,
            role: context.role,
            branchId: context.branchId
          },
          {
            ...item.payload,
            clientLineId: item.clientId
          }
        );
        const line = collections.items.find((i) => i.customerId === item.payload.customerId);
        results.push({ clientId: item.clientId, ok: true, resourceId: line?.customerId ?? item.clientId });
      }
    } catch (error) {
      results.push({
        clientId: item.clientId,
        ok: false,
        error: error instanceof Error ? error.message : "Sync item failed"
      });
    }
  }

  res.json({ results });
  }
);

