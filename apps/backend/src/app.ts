import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { auditLog } from "./middleware/auditLog.js";
import { authenticate } from "./middleware/authenticate.js";
import { attachBranchScope } from "./middleware/branchScope.js";
import { requireTenantModuleForRequest } from "./middleware/requireTenantModule.js";
import {
  adminMutationRateLimit,
  globalRateLimit,
  moneyMutationRateLimit
} from "./middleware/rateLimit.js";
import { authRouter } from "./routes/auth.routes.js";
import { accountLookupRouter } from "./routes/accountLookup.routes.js";
import { branchesRouter } from "./routes/branches.routes.js";
import { accountNumberPolicyRouter } from "./routes/accountNumberPolicy.routes.js";
import { commissionPolicyRouter } from "./routes/commissionPolicy.routes.js";
import { susuCycleCommissionRouter } from "./routes/susuCycleCommission.routes.js";
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
import { loansRouter } from "./routes/loans.routes.js";
import { aiRouter } from "./routes/ai.routes.js";
import { treasuryRouter } from "./routes/treasury.routes.js";
import { institutionalIncomeRouter } from "./routes/institutionalIncome.routes.js";
import { agencyRouter } from "./routes/agency.routes.js";
import { bankProductsRouter } from "./routes/bankProducts.routes.js";
import { operationsRouter } from "./routes/operations.routes.js";
import { investmentsRouter } from "./routes/investments.routes.js";
import { companyProfileRouter } from "./routes/companyProfile.routes.js";
import { approvalWorkflowRouter } from "./routes/approvalWorkflow.routes.js";
import { registrationFormRouter } from "./routes/registrationForm.routes.js";
import { smsSettingsRouter } from "./routes/smsSettings.routes.js";
import { loanQualificationRouter } from "./routes/loanQualification.routes.js";
import { siteManualRouter } from "./routes/siteManual.routes.js";
import { emailSettingsRouter } from "./routes/emailSettings.routes.js";
import { notificationPlatformRouter } from "./routes/notificationPlatform.routes.js";
import { subscriptionRouter } from "./routes/subscription.routes.js";
import { announcementsRouter } from "./routes/announcements.routes.js";

function isAllowedCorsOrigin(origin: string | undefined): boolean {
  // Non-browser clients (health checks, mobile WebViews, server-to-server) have no Origin header.
  if (!origin) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const normalized = parsed.origin.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();

  // Explicit env allowlist (FRONTEND_URL + CORS_ALLOWED_ORIGINS)
  const configured = new Set<string>();
  if (env.FRONTEND_URL) {
    try {
      configured.add(new URL(env.FRONTEND_URL).origin.toLowerCase());
    } catch {
      // ignore invalid URL
    }
  }
  if (env.CORS_ALLOWED_ORIGINS) {
    for (const raw of env.CORS_ALLOWED_ORIGINS.split(",")) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      try {
        configured.add(new URL(trimmed).origin.toLowerCase());
      } catch {
        configured.add(trimmed.toLowerCase());
      }
    }
  }
  if (configured.has(normalized)) {
    return true;
  }

  // Primary product domain and all tenant subdomains (e.g. ese.aabanker.com)
  if (
    parsed.protocol === "https:" &&
    (hostname === "aabanker.com" || hostname.endsWith(".aabanker.com"))
  ) {
    return true;
  }

  // Allow Vercel preview/production deployments unless explicit CORS_ALLOWED_ORIGINS locks them out
  if (
    !env.CORS_ALLOWED_ORIGINS &&
    parsed.protocol === "https:" &&
    hostname.endsWith(".vercel.app")
  ) {
    return true;
  }

  // Local development & tenant localhost subdomains (e.g. ese.localhost:5173)
  if (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1")
  ) {
    return true;
  }

  return false;
}

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, isAllowedCorsOrigin(origin));
      },
      credentials: true
    })
  );
  // Registrations include optional base64 photos; default 100kb is too small.
  app.use(express.json({ limit: "6mb" }));
  app.use(globalRateLimit);
  app.use(auditLog);
  app.use(authenticate);
  app.use(attachBranchScope);
  app.use(requireTenantModuleForRequest);

  app.use("/health", healthRouter);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/account-lookup", accountLookupRouter);
  app.use("/api/v1/chat", chatRouter);
  app.use("/api/v1/chat/inbox", chatInboxRouter);
  app.use("/api/v1/platform", adminMutationRateLimit, platformRouter);
  app.use("/api/v1/branches", branchesRouter);
  app.use("/api/v1/tenant/commission-policy", commissionPolicyRouter);
  app.use("/api/v1/tenant/susu-cycle-commission", susuCycleCommissionRouter);
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
  app.use("/api/v1/loans", moneyMutationRateLimit, loansRouter);
  app.use("/api/v1/ai", aiRouter);
  app.use("/api/v1/treasury", moneyMutationRateLimit, treasuryRouter);
  app.use("/api/v1/income", moneyMutationRateLimit, institutionalIncomeRouter);
  app.use("/api/v1/agency", moneyMutationRateLimit, agencyRouter);
  app.use("/api/v1/banking/products", adminMutationRateLimit, bankProductsRouter);
  app.use("/api/v1/operations", operationsRouter);
  app.use("/api/v1/investments", moneyMutationRateLimit, investmentsRouter);
  app.use("/api/v1/tenant/profile", adminMutationRateLimit, companyProfileRouter);
  app.use("/api/v1/tenant/form-setup", adminMutationRateLimit, registrationFormRouter);
  app.use("/api/v1/tenant/approval-workflows", adminMutationRateLimit, approvalWorkflowRouter);
  app.use("/api/v1/tenant/sms-settings", adminMutationRateLimit, smsSettingsRouter);
  app.use("/api/v1/tenant/email-settings", adminMutationRateLimit, emailSettingsRouter);
  app.use("/api/v1/tenant/notifications", notificationPlatformRouter);
  app.use("/api/v1/tenant/loan-qualification", adminMutationRateLimit, loanQualificationRouter);
  app.use("/api/v1/tenant/site-manual", siteManualRouter);
  app.use("/api/v1/tenant/subscription", adminMutationRateLimit, subscriptionRouter);
  app.use("/api/v1/announcements", announcementsRouter);

  return app;
}
