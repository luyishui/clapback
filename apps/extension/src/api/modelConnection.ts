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
  timeoutMs?: number;
  responseFormat?: "json_object";
  stream?: boolean;
  thinkingMode?: "disabled" | "provider_default";
};

const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 60_000;

export type ModelCompletion = {
  content: string;
  reasoningContent: string;
  finishReason?: string;
  transport: "stream" | "non_stream";
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
      maxTokens: 1024,
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
  const completion = await requestModelCompletion(model, apiKey, request);
  if (!completion.content.trim() && completion.finishReason === "length") {
    throw new ModelRequestError("model_output_truncated");
  }
  return completion.content;
}

export async function requestModelCompletion(
  model: ModelConfig,
  apiKey: string,
  request: ModelTextRequest,
): Promise<ModelCompletion> {
  if (!apiKey.trim()) throw new ModelRequestError("model_api_key_missing");
  if (!model.model_name.trim()) throw new ModelRequestError("model_name_missing");
  const baseUrl = normalizeHttpsBaseUrl(model.base_url);
  const apiProtocol = normalizeModelApiProtocol(model.api_protocol);

  if (isOpenCodeBaseUrl(baseUrl)) {
    const fallbackProtocol: ModelApiProtocol = apiProtocol === "anthropic_messages" ? "openai_chat" : "anthropic_messages";
    try {
      return await requestModelCompletionWithProtocol(apiProtocol, baseUrl, model.model_name, apiKey, request);
    } catch (error) {
      if (!shouldTryOpenCodeProtocolFallback(error)) throw error;
      return requestModelCompletionWithProtocol(fallbackProtocol, baseUrl, model.model_name, apiKey, request);
    }
  }

  return requestModelCompletionWithProtocol(apiProtocol, baseUrl, model.model_name, apiKey, request);
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

function requestModelCompletionWithProtocol(
  apiProtocol: ModelApiProtocol,
  baseUrl: string,
  modelName: string,
  apiKey: string,
  request: ModelTextRequest,
): Promise<ModelCompletion> {
  if (apiProtocol === "anthropic_messages") {
    return requestAnthropicMessages(baseUrl, modelName, apiKey, request);
  }
  return requestOpenAiChat(baseUrl, modelName, apiKey, request);
}

function isOpenCodeBaseUrl(baseUrl: string): boolean {
  return baseUrl.toLowerCase().includes("opencode.ai/zen/go");
}

function shouldTryOpenCodeProtocolFallback(error: unknown): boolean {
  if (error instanceof ModelRequestError) {
    if ([
      "model_output_truncated",
      "model_request_timeout",
      "model_api_key_missing",
      "model_name_missing",
      "model_base_url_not_allowed",
    ].includes(error.message)) return false;
    return ![401, 403, 429].includes(error.status ?? 0);
  }
  return error instanceof Error && /failed to fetch|network|not found/i.test(error.message);
}

function shouldDisableDeepSeekThinking(baseUrl: string, modelName: string): boolean {
  return isOpenCodeBaseUrl(baseUrl) && /deepseek/i.test(modelName);
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
): Promise<ModelCompletion> {
  const body = compactRecord({
    model: modelName,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
    temperature: request.temperature,
    max_tokens: request.maxTokens ?? 512,
    response_format: request.responseFormat === "json_object" ? { type: "json_object" } : undefined,
    thinking: shouldDisableDeepSeekThinking(baseUrl, modelName) && request.thinkingMode !== "provider_default"
      ? { type: "disabled" }
      : undefined,
    n: 1,
    stream: request.stream ?? false,
  });
  const response = await fetchWithModelTimeout(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, request.timeoutMs);
  if (!response.ok) {
    const payload = await readResponseBody(response);
    throw new ModelRequestError(providerErrorMessage(payload, response.status), response.status);
  }
  if (request.stream && response.body) return readOpenAiStreamCompletion(response.body);
  const payload = await readResponseBody(response);
  return extractOpenAiCompletion(payload);
}

async function requestAnthropicMessages(
  baseUrl: string,
  modelName: string,
  apiKey: string,
  request: ModelTextRequest,
): Promise<ModelCompletion> {
  const body = compactRecord({
    model: modelName,
    system: request.system,
    messages: [{ role: "user", content: request.user }],
    temperature: request.temperature,
    max_tokens: request.maxTokens ?? 512,
  });
  const response = await fetchWithModelTimeout(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  }, request.timeoutMs);
  const payload = await readResponseBody(response);
  if (!response.ok) throw new ModelRequestError(providerErrorMessage(payload, response.status), response.status);
  return {
    content: extractAnthropicText(payload),
    reasoningContent: "",
    finishReason: extractAnthropicFinishReason(payload),
    transport: "non_stream",
  };
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

async function readOpenAiStreamCompletion(body: ReadableStream<Uint8Array>): Promise<ModelCompletion> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoningContent = "";
  let finishReason: string | undefined;
  let streamDone = false;

  while (!streamDone) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const event = parseSseData(part);
      if (!event) continue;
      if (event === "[DONE]") {
        streamDone = true;
        break;
      }
      const parsed = parseJson(event);
      if (!isPlainObject(parsed) || !Array.isArray(parsed.choices)) continue;
      const applied = applyOpenAiStreamChoices(parsed.choices, content, reasoningContent, finishReason);
      content = applied.content;
      reasoningContent = applied.reasoningContent;
      finishReason = applied.finishReason;
    }
  }
  if (streamDone) {
    await reader.cancel().catch(() => {});
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const event = parseSseData(buffer);
    if (event && event !== "[DONE]") {
      const parsed = parseJson(event);
      if (isPlainObject(parsed) && Array.isArray(parsed.choices)) {
        const applied = applyOpenAiStreamChoices(parsed.choices, content, reasoningContent, finishReason);
        content = applied.content;
        reasoningContent = applied.reasoningContent;
        finishReason = applied.finishReason;
      }
    }
  }

  return { content, reasoningContent, finishReason, transport: "stream" };
}

function applyOpenAiStreamChoices(
  choices: unknown[],
  currentContent: string,
  currentReasoning: string,
  currentFinishReason?: string,
): { content: string; reasoningContent: string; finishReason?: string } {
  let content = currentContent;
  let reasoningContent = currentReasoning;
  let finishReason = currentFinishReason;
  for (const choice of choices) {
    if (!isPlainObject(choice)) continue;
    const delta = choice.delta;
    if (isPlainObject(delta)) {
      if (typeof delta.content === "string") content += delta.content;
      if (typeof delta.reasoning_content === "string") reasoningContent += delta.reasoning_content;
      if (typeof delta.reasoning === "string") reasoningContent += delta.reasoning;
      if (typeof delta.reasoning_text === "string") reasoningContent += delta.reasoning_text;
    }
    if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
  }
  return { content, reasoningContent, finishReason };
}

function parseSseData(chunk: string): string {
  return chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n");
}

function extractOpenAiCompletion(payload: unknown): ModelCompletion {
  if (!isPlainObject(payload) || !Array.isArray(payload.choices)) {
    return { content: "", reasoningContent: "", transport: "non_stream" };
  }
  const first = payload.choices[0];
  if (!isPlainObject(first)) return { content: "", reasoningContent: "", transport: "non_stream" };
  const message = first.message;
  const finishReason = typeof first.finish_reason === "string" ? first.finish_reason : undefined;
  if (isPlainObject(message) && typeof message.content === "string") {
    return {
      content: message.content,
      reasoningContent: typeof message.reasoning_content === "string" ? message.reasoning_content : "",
      finishReason,
      transport: "non_stream",
    };
  }
  return {
    content: typeof first.text === "string" ? first.text : "",
    reasoningContent: "",
    finishReason,
    transport: "non_stream",
  };
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

function extractAnthropicFinishReason(payload: unknown): string | undefined {
  if (!isPlainObject(payload)) return undefined;
  return typeof payload.stop_reason === "string" ? payload.stop_reason : undefined;
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

async function fetchWithModelTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_MODEL_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Response>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new ModelRequestError("model_request_timeout"));
    }, Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      throw new ModelRequestError("model_request_timeout");
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
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

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
