import type { AiLoanReviewRequest, AiStatusResponse } from "@bms/shared";
import type { ResolvedUserContext } from "../userContextService.js";
import { writeAuditLog } from "../auditService.js";
import { getOllamaConfig } from "../../config/env.js";
import { BMS_PRODUCT_KNOWLEDGE, LOAN_REVIEW_SYSTEM_PROMPT } from "./bmsKnowledge.js";
import { isOllamaReachable, ollamaChat, OllamaUnavailableError, type ChatTurn } from "./ollamaProvider.js";

const PLATFORM_AUDIT_TENANT = "platform";

function permissionsSummary(context: ResolvedUserContext): string {
  const perms = context.permissions.slice(0, 40);
  if (!perms.length) {
    return "No permissions listed.";
  }
  return perms.join(", ");
}

function subscribedModulesSummary(context: ResolvedUserContext): string {
  const modules = context.subscribedModules ?? [];
  return modules.length ? modules.join(", ") : "unknown modules";
}

async function logAiUse(input: {
  tenantId: string;
  userId?: string;
  role?: string;
  path: string;
  statusCode: number;
}): Promise<void> {
  try {
    await writeAuditLog({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      actorRole: input.role,
      method: "POST",
      path: input.path,
      statusCode: input.statusCode
    });
  } catch {
    // Non-blocking
  }
}

export async function getAiStatus(): Promise<AiStatusResponse> {
  const { model } = getOllamaConfig();
  const available = await isOllamaReachable();
  return {
    available,
    model,
    provider: "ollama",
    hint: available
      ? undefined
      : "Start Ollama locally and run: ollama pull llama3.2:3b"
  };
}

export async function generateWorkspaceHelp(
  context: ResolvedUserContext,
  message: string
): Promise<{ reply: string; model: string; provider: "ollama" }> {
  const system = `${BMS_PRODUCT_KNOWLEDGE}

Signed-in user context (do not repeat verbatim unless helpful):
- Role: ${context.role}
- Scope: ${context.scopeType}${context.branchId ? ` (branch ${context.branchId})` : ""}
- Subscribed modules: ${subscribedModulesSummary(context)}
- Permissions: ${permissionsSummary(context)}

Answer only about BMS features this user may have access to. If they ask to perform an action they lack permission for, explain which permission or role is typically needed without being condescending.`;

  try {
    const result = await ollamaChat({ system, user: message });
    await logAiUse({
      tenantId: context.tenantId,
      userId: context.userId,
      role: context.role,
      path: "/api/v1/ai/help",
      statusCode: 200
    });
    return { reply: result.text, model: result.model, provider: "ollama" };
  } catch (error) {
    await logAiUse({
      tenantId: context.tenantId,
      userId: context.userId,
      role: context.role,
      path: "/api/v1/ai/help",
      statusCode: error instanceof OllamaUnavailableError ? 503 : 500
    });
    throw error;
  }
}

export async function generateLoanApplicationReview(
  context: ResolvedUserContext,
  summary: AiLoanReviewRequest
): Promise<{ reply: string; model: string; provider: "ollama" }> {
  const userPayload = JSON.stringify(summary, null, 2);
  const system = LOAN_REVIEW_SYSTEM_PROMPT;

  try {
    const result = await ollamaChat({
      system,
      user: `Application summary (JSON):\n${userPayload}`
    });
    await logAiUse({
      tenantId: context.tenantId,
      userId: context.userId,
      role: context.role,
      path: "/api/v1/ai/loan-application-review",
      statusCode: 200
    });
    return { reply: result.text, model: result.model, provider: "ollama" };
  } catch (error) {
    await logAiUse({
      tenantId: context.tenantId,
      userId: context.userId,
      role: context.role,
      path: "/api/v1/ai/loan-application-review",
      statusCode: error instanceof OllamaUnavailableError ? 503 : 500
    });
    throw error;
  }
}

export async function generatePublicChatReply(options: {
  visitorMessage: string;
  history: Array<{ senderType: string; body: string }>;
}): Promise<{ reply: string; model: string; escalated: boolean } | null> {
  const reachable = await isOllamaReachable();
  if (!reachable) {
    return null;
  }

  const history: ChatTurn[] = options.history
    .slice(-8)
    .filter((m) => m.senderType === "visitor" || m.senderType === "admin")
    .map((m) => ({
      role: m.senderType === "visitor" ? ("user" as const) : ("assistant" as const),
      content: m.body
    }));

  const system = `${BMS_PRODUCT_KNOWLEDGE}

You are the BMS website assistant helping cooperatives and MFIs learn about registration and features.
Keep replies under 120 words. Be welcoming and professional.
If the visitor needs human follow-up (pricing, contracts, complaints, or uncertain answers), include [ESCALATE] at the very end.`;

  try {
    const result = await ollamaChat({
      system,
      user: options.visitorMessage,
      history
    });
    const escalated = result.text.includes("[ESCALATE]");
    const reply = result.text.replace(/\[ESCALATE\]/g, "").trim();
    await logAiUse({
      tenantId: PLATFORM_AUDIT_TENANT,
      path: "/api/v1/ai/public-chat",
      statusCode: 200
    });
    return { reply, model: result.model, escalated };
  } catch {
    return null;
  }
}

export { OllamaUnavailableError };
