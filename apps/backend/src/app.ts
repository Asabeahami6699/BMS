import cors from "cors";
import express from "express";
import helmet from "helmet";
import { auditLog } from "./middleware/auditLog.js";
import { authenticate } from "./middleware/authenticate.js";
import { requireTenantModuleForRequest } from "./middleware/requireTenantModule.js";
import {
  adminMutationRateLimit,
  globalRateLimit,
  moneyMutationRateLimit
} from "./middleware/rateLimit.js";
import { authRouter } from "./routes/auth.routes.js";
import { branchesRouter } from "./routes/branches.routes.js";
import { accountNumberPolicyRouter } from "./routes/accountNumberPolicy.routes.js";
import { commissionPolicyRouter } from "./routes/commissionPolicy.routes.js";
import { customersRouter } from "./routes/customers.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { ledgerRouter } from "./routes/ledger.routes.js";
import { payrollRouter } from "./routes/payroll.routes.js";
import { reportsRouter } from "./routes/reports.routes.js";
import { rolesRouter } from "./routes/roles.routes.js";
import { transactionsRouter } from "./routes/transactions.routes.js";
import { chatInboxRouter, chatRouter } from "./routes/chat.routes.js";
import { platformRouter } from "./routes/platform.routes.js";
import { usersRouter } from "./routes/users.routes.js";
import { syncRouter } from "./routes/sync.routes.js";
import { collectionBatchesRouter } from "./routes/collectionBatches.routes.js";
import { fieldAgentsRouter } from "./routes/fieldAgents.routes.js";
import { routesRouter } from "./routes/routes.routes.js";
import { auditRouter } from "./routes/audit.routes.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors());
  // Registrations include optional base64 photos; default 100kb is too small.
  app.use(express.json({ limit: "6mb" }));
  app.use(globalRateLimit);
  app.use(auditLog);
  app.use(authenticate);
  app.use(requireTenantModuleForRequest);

  app.use("/health", healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/chat", chatRouter);
  app.use("/api/v1/chat/inbox", chatInboxRouter);
  app.use("/api/v1/platform", adminMutationRateLimit, platformRouter);
  app.use("/api/v1/branches", branchesRouter);
  app.use("/api/v1/tenant/commission-policy", commissionPolicyRouter);
  app.use("/api/v1/tenant/account-number-policy", accountNumberPolicyRouter);
  app.use("/api/v1/admin/roles", adminMutationRateLimit, rolesRouter);
  app.use("/api/v1/customers", customersRouter);
  app.use("/api/v1/transactions", moneyMutationRateLimit, transactionsRouter);
  app.use("/api/v1/ledger", ledgerRouter);
  app.use("/api/v1/reports", reportsRouter);
  app.use("/api/v1/payroll", payrollRouter);
  app.use("/api/v1/users", adminMutationRateLimit, usersRouter);
  app.use("/api/v1/sync", syncRouter);
  app.use("/api/v1/field-agents", fieldAgentsRouter);
  app.use("/api/v1/collection-batches", moneyMutationRateLimit, collectionBatchesRouter);
  app.use("/api/v1/routes", routesRouter);
  app.use("/api/v1/audit-logs", auditRouter);

  return app;
}
