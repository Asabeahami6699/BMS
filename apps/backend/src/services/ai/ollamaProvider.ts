import { getOllamaConfig } from "../../config/env.js";

export type ChatTurn = { role: "user" | "assistant" | "system"; content: string };

export class OllamaUnavailableError extends Error {
  constructor(message = "Ollama is not running. Install from https://ollama.com and run: ollama pull llama3.2:3b") {
    super(message);
    this.name = "OllamaUnavailableError";
  }
}

export async function isOllamaReachable(): Promise<boolean> {
  const { baseUrl } = getOllamaConfig();
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(2500)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ollamaChat(options: {
  system: string;
  user: string;
  history?: ChatTurn[];
}): Promise<{ text: string; model: string }> {
  const { baseUrl, model } = getOllamaConfig();

  const messages: ChatTurn[] = [{ role: "system", content: options.system }];
  if (options.history?.length) {
    for (const turn of options.history) {
      if (turn.role === "system") {
        continue;
      }
      messages.push(turn);
    }
  }
  messages.push({ role: "user", content: options.user });

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: 0.4,
          num_predict: 600
        }
      }),
      signal: AbortSignal.timeout(120_000)
    });
  } catch {
    throw new OllamaUnavailableError();
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 404 && detail.includes("not found")) {
      throw new OllamaUnavailableError(`Model "${model}" is not installed. Run: ollama pull ${model}`);
    }
    throw new OllamaUnavailableError(
      detail ? `Ollama error (${response.status}): ${detail.slice(0, 200)}` : `Ollama error (${response.status})`
    );
  }

  const data = (await response.json()) as {
    message?: { content?: string };
    model?: string;
  };

  const text = data.message?.content?.trim();
  if (!text) {
    throw new OllamaUnavailableError("Ollama returned an empty response");
  }

  return { text, model: data.model ?? model };
}
