import type {
  ModelApiProtocol,
  ModelConfig,
  ModelConfigInput,
  ModelConnectionTestResult,
  ModelDetectionResult,
  ModelOption,
} from "../workbench/runtimeApi";
import { getModelApiKey, listModels, normalizeModelApiProtocol } from "./idbStore";

type ModelConnectionInput = Partial<ModelConfigInput> & { id?: number; api_protocol?: ModelApiProtocol };

type ModelTextRequest = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
};

class ModelRequestError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export async function detectModels(payload: {
  base_url: string;
  api_key?: string;
  api_protocol?: ModelApiProtocol;
}): Promise<ModelDetectionResult> {
  try {
    const baseUrl = normalizeHttpsBaseUrl(payload.base_url);
    const apiProtocol = normalizeModelApiProtocol(payload.api_protocol);
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: authHeaders(apiProtocol, payload.api_key ?? ""),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      return { ok: false, error: providerErrorMessage(body, response.status), status: response.status };
    }

    const models = extractModelOptions(body, baseUrl, apiProtocol);
    return { ok: true, models };
  } catch (error) {
    return modelFailure(error);
  }
}

export async function testModelConnection(payload: ModelConnectionInput): Promise<ModelConnectionTestResult> {
  try {
    const { config, apiKey } = await resolveModelConnection(payload);
    await requestModelText(config, apiKey, {
      system: "Return exactly one short ping response.",
      user: "ping",
      maxTokens: 1,
      temperature: 0,
    });
    return { ok: true, model: config.model_name };
  } catch (error) {
    return modelFailure(error);
  }
}

export async function requestModelText(
  model: ModelConfig,
  apiKey: string,
  request: ModelTextRequest,
): Promise<string> {
  if (!apiKey.trim()) throw new ModelRequestError("model_api_key_missing");
  if (!model.model_name.trim()) throw new ModelRequestError("model_name_missing");
  const baseUrl = normalizeHttpsBaseUrl(model.base_url);
  const apiProtocol = normalizeModelApiProtocol(model.api_protocol);

  if (apiProtocol === "anthropic_messages") {
    return requestAnthropicMessages(baseUrl, model.model_name, apiKey, request);
  }
  return requestOpenAiChat(baseUrl, model.model_name, apiKey, request);
}

export function inferModelApiProtocol(
  baseUrl: string,
  modelId: string,
  fallback: ModelApiProtocol = "openai_chat",
): ModelApiProtocol {
  const normalizedBase = baseUrl.toLowerCase();
  const normalizedModel = modelId.toLowerCase();
  if (normalizedBase.includes("opencode.ai/zen/go")) {
    if (normalizedModel.startsWith("minimax-") || normalizedModel.startsWith("qwen3.")) {
      return "anthropic_messages";
    }
    return "openai_chat";
  }
  if (normalizedModel.startsWith("claude-")) return "anthropic_messages";
  return fallback;
}

async function resolveModelConnection(payload: ModelConnectionInput): Promise<{
  config: ModelConfig;
  apiKey: string;
}> {
  const models = await listModels();
  const saved = typeof payload.id === "number" ? models.find((model) => model.id === payload.id) : undefined;
  const id = saved?.id ?? payload.id ?? 0;
  const config: ModelConfig = {
    id,
    provider: payload.provider ?? saved?.provider ?? "Custom",
    model_name: payload.model_name ?? saved?.model_name ?? "",
    base_url: payload.base_url ?? saved?.base_url ?? "",
    api_key_masked: saved?.api_key_masked ?? "",
    api_protocol: normalizeModelApiProtocol(payload.api_protocol ?? saved?.api_protocol),
    is_default: payload.is_default ?? saved?.is_default ?? false,
    created_at: saved?.created_at,
  };
  const inlineKey = typeof payload.api_key === "string" ? payload.api_key.trim() : "";
  const savedKey = saved ? await getModelApiKey(saved.id) : "";
  return { config, apiKey: inlineKey || savedKey };
}

async function requestOpenAiChat(
  baseUrl: string,
  modelName: string,
  apiKey: string,
  request: ModelTextRequest,
): Promise<string> {
  const body = compactRecord({
    model: modelName,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    n: 1,
    stream: false,
  });
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await readResponseBody(response);
  if (!response.ok) throw new ModelRequestError(providerErrorMessage(payload, response.status), response.status);
  return extractOpenAiText(payload);
}

async function requestAnthropicMessages(
  baseUrl: string,
  modelName: string,
  apiKey: string,
  request: ModelTextRequest,
): Promise<string> {
  const body = compactRecord({
    model: modelName,
    system: request.system,
    messages: [{ role: "user", content: request.user }],
    temperature: request.temperature,
    max_tokens: request.maxTokens ?? 512,
  });
  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const payload = await readResponseBody(response);
  if (!response.ok) throw new ModelRequestError(providerErrorMessage(payload, response.status), response.status);
  return extractAnthropicText(payload);
}

function extractModelOptions(body: unknown, baseUrl: string, fallbackProtocol: ModelApiProtocol): ModelOption[] {
  const source = isPlainObject(body) && Array.isArray(body.data)
    ? body.data
    : Array.isArray(body)
      ? body
      : [];
  return source
    .map((item) => isPlainObject(item) && typeof item.id === "string" ? item.id.trim() : "")
    .filter(Boolean)
    .map((id) => ({
      id,
      api_protocol: inferModelApiProtocol(baseUrl, id, fallbackProtocol),
    }));
}

function extractOpenAiText(payload: unknown): string {
  if (!isPlainObject(payload) || !Array.isArray(payload.choices)) return "";
  const first = payload.choices[0];
  if (!isPlainObject(first)) return "";
  const message = first.message;
  if (isPlainObject(message) && typeof message.content === "string") return message.content;
  return typeof first.text === "string" ? first.text : "";
}

function extractAnthropicText(payload: unknown): string {
  if (!isPlainObject(payload)) return "";
  if (typeof payload.content === "string") return payload.content;
  if (!Array.isArray(payload.content)) return "";
  return payload.content
    .map((block) => isPlainObject(block) && typeof block.text === "string" ? block.text : "")
    .filter(Boolean)
    .join("\n");
}

function normalizeHttpsBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") throw new ModelRequestError("model_base_url_not_allowed");
    return trimmed;
  } catch (error) {
    if (error instanceof ModelRequestError) throw error;
    throw new ModelRequestError("model_base_url_not_allowed");
  }
}

function authHeaders(apiProtocol: ModelApiProtocol, apiKey: string): Record<string, string> {
  const trimmed = apiKey.trim();
  if (!trimmed) return {};
  if (apiProtocol === "anthropic_messages") {
    return {
      "x-api-key": trimmed,
      "anthropic-version": "2023-06-01",
    };
  }
  return { Authorization: `Bearer ${trimmed}` };
}

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    try {
      return await response.text();
    } catch {
      return undefined;
    }
  }
}

function providerErrorMessage(body: unknown, status: number): string {
  if (isPlainObject(body)) {
    const error = body.error;
    if (typeof error === "string") return redactSecret(error);
    if (isPlainObject(error)) {
      if (typeof error.message === "string") return redactSecret(error.message);
      if (typeof error.type === "string") return redactSecret(error.type);
    }
    if (typeof body.message === "string") return redactSecret(body.message);
  }
  if (typeof body === "string" && body.trim()) return redactSecret(body.trim().slice(0, 240));
  return `model_request_failed_${status}`;
}

function modelFailure(error: unknown): { ok: false; error: string; status?: number } {
  if (error instanceof ModelRequestError) {
    return { ok: false, error: redactSecret(error.message), status: error.status };
  }
  if (error instanceof Error) return { ok: false, error: redactSecret(error.message) };
  return { ok: false, error: "model_request_failed" };
}

function redactSecret(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-••••");
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
