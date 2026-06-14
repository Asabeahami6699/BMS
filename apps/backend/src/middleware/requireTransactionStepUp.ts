import type { NextFunction, Request, Response } from "express";
import { roleRequiresTransactionPin, TRANSACTION_STEP_UP_HEADER } from "@bms/shared";
import {
  assertTransactionStepUpReady,
  verifyStepUpToken
} from "../services/transactionPinService.js";

export async function requireTransactionStepUp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return;
  }

  if (!roleRequiresTransactionPin(context.role)) {
    next();
    return;
  }

  try {
    await assertTransactionStepUpReady(context.userId, context.tenantId, context.role);
  } catch (error) {
    res.status(403).json({
      error: error instanceof Error ? error.message : "Transaction PIN not configured",
      code: "TRANSACTION_PIN_NOT_CONFIGURED"
    });
    return;
  }

  const token = req.header(TRANSACTION_STEP_UP_HEADER) ?? req.header("X-Transaction-Authorization");
  if (!verifyStepUpToken(token, context.userId, context.tenantId)) {
    res.status(403).json({
      error: "Transaction PIN verification required",
      code: "TRANSACTION_STEP_UP_REQUIRED"
    });
    return;
  }

  next();
}
