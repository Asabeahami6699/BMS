import { Router } from "express";
import { momoLookupRateLimit } from "../middleware/rateLimit.js";
import {
  listPaystackGhanaBanks,
  resolveGhanaBankAccountName,
  resolveGhanaMomoAccountName
} from "../services/momoLookupService.js";

export const accountLookupRouter = Router();

accountLookupRouter.get("/momo", momoLookupRateLimit, async (req, res) => {
  if (!req.userContext) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const phone = typeof req.query.phone === "string" ? req.query.phone.trim() : "";
  const network = typeof req.query.network === "string" ? req.query.network.trim() : undefined;
  if (!phone) {
    res.status(400).json({ error: "MoMo phone number is required" });
    return;
  }
  try {
    const result = await resolveGhanaMomoAccountName({ phone, network });
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Could not look up MoMo account"
    });
  }
});

accountLookupRouter.get("/banks", async (req, res) => {
  if (!req.userContext) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const result = await listPaystackGhanaBanks();
  res.json(result);
});

accountLookupRouter.get("/bank", momoLookupRateLimit, async (req, res) => {
  if (!req.userContext) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const accountNumber =
    typeof req.query.accountNumber === "string" ? req.query.accountNumber.trim() : "";
  const bankCode = typeof req.query.bankCode === "string" ? req.query.bankCode.trim() : undefined;
  const bankName = typeof req.query.bankName === "string" ? req.query.bankName.trim() : undefined;

  if (!accountNumber) {
    res.status(400).json({ error: "Account number is required" });
    return;
  }

  try {
    const result = await resolveGhanaBankAccountName({ accountNumber, bankCode, bankName });
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Could not look up bank account"
    });
  }
});
