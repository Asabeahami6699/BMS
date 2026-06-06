import { Router } from "express";
import { aiHelpRequestSchema, aiLoanReviewRequestSchema } from "@bms/shared";
import { requireAnyPermission } from "../middleware/requirePermission.js";
import { validateBody } from "../middleware/validateBody.js";
import { aiRateLimit } from "../middleware/rateLimit.js";
import {
  generateLoanApplicationReview,
  generateWorkspaceHelp,
  getAiStatus,
  OllamaUnavailableError
} from "../services/ai/aiService.js";

export const aiRouter = Router();

aiRouter.get("/status", async (_req, res) => {
  const status = await getAiStatus();
  res.json(status);
});

aiRouter.use(aiRateLimit);

aiRouter.post("/help", validateBody(aiHelpRequestSchema), async (req, res) => {
  if (!req.userContext) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const result = await generateWorkspaceHelp(req.userContext, req.body.message);
    res.json(result);
  } catch (error) {
    if (error instanceof OllamaUnavailableError) {
      res.status(503).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "AI help failed" });
  }
});

aiRouter.post(
  "/loan-application-review",
  requireAnyPermission("loans.applications.create", "loans.read", "loans.applications.approve"),
  validateBody(aiLoanReviewRequestSchema),
  async (req, res) => {
    if (!req.userContext) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const result = await generateLoanApplicationReview(req.userContext, req.body);
      res.json(result);
    } catch (error) {
      if (error instanceof OllamaUnavailableError) {
        res.status(503).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : "AI review failed" });
    }
  }
);
