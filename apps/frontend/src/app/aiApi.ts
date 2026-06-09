import type { AiAnalyzeResponse, AiAssistResponse, AiLoanReviewRequest, AiStatusResponse } from "@bms/shared";
import { API_BASE_URL, authHeaders, fetchJson } from "./api";

export async function getAiStatus(): Promise<AiStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/ai/status`);
  if (!response.ok) {
    throw new Error("Could not check AI status");
  }
  return (await response.json()) as AiStatusResponse;
}

export async function askAiHelp(message: string): Promise<AiAssistResponse> {
  return fetchJson<AiAssistResponse>(`${API_BASE_URL}/api/v1/ai/help`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({ message })
  });
}

export async function askAiAnalyze(message: string): Promise<AiAnalyzeResponse> {
  return fetchJson<AiAnalyzeResponse>(`${API_BASE_URL}/api/v1/ai/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({ message })
  });
}

export async function reviewLoanApplicationWithAi(
  summary: AiLoanReviewRequest
): Promise<AiAssistResponse> {
  return fetchJson<AiAssistResponse>(`${API_BASE_URL}/api/v1/ai/loan-application-review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify(summary)
  });
}

export function isAiAssistantChatMessage(messageId: string): boolean {
  return messageId.startsWith("msg_ai_");
}
