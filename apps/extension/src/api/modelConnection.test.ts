import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelConfig } from "../workbench/runtimeApi";
import { requestModelCompletion, requestModelText } from "./modelConnection";

const model: ModelConfig = {
  id: 1,
  provider: "Test",
  model_name: "gpt-test",
  base_url: "https://api.example.test/v1",
  api_key_masked: "sk-****",
  api_protocol: "openai_chat",
  is_default: true,
};

describe("model connection OpenAI text extraction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses streaming reasoning and final content into separate fields", async () => {
    const fetchMock = vi.fn<() => Promise<ResponseInit & { body: ReadableStream<Uint8Array> }>>(async () => ({
      ok: true,
      status: 200,
      body: sseStream([
        { choices: [{ delta: { reasoning_content: "先分析目标。" } }] },
        { choices: [{ delta: { content: "{\"candidates\":[\"" } }] },
        { choices: [{ delta: { content: "第一条\"]}" }, finish_reason: "stop" }] },
      ]),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestModelCompletion(model, "sk-test", {
      system: "system",
      user: "user",
      stream: true,
    })).resolves.toEqual({
      content: "{\"candidates\":[\"第一条\"]}",
      reasoningContent: "先分析目标。",
      finishReason: "stop",
      transport: "stream",
    });

    const requestCalls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    const requestBody = JSON.parse(String(requestCalls[0][1].body));
    expect(requestBody.stream).toBe(true);
  });

  it("requestModelText returns only final content from streaming responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([
        { choices: [{ delta: { reasoning_content: "不要返回这段思考。" } }] },
        { choices: [{ delta: { content: "只返回答案" }, finish_reason: "stop" }] },
      ]),
    })));

    await expect(requestModelText(model, "sk-test", {
      system: "system",
      user: "user",
      stream: true,
    })).resolves.toBe("只返回答案");
  });

  it("returns when streaming response sends DONE even if the connection stays open", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      body: hangingDoneStream([
        { choices: [{ delta: { content: "最终答案" }, finish_reason: "stop" }] },
      ]),
    })));

    const completion = requestModelCompletion(model, "sk-test", {
      system: "system",
      user: "user",
      stream: true,
    });

    await expect(Promise.race([
      completion,
      new Promise((_, reject) => setTimeout(() => reject(new Error("stream_done_timeout")), 100)),
    ])).resolves.toMatchObject({
      content: "最终答案",
      finishReason: "stop",
      transport: "stream",
    });
  });

  it("sends only verified thinking controls for OpenCode DeepSeek requests", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([
        { choices: [{ delta: { content: "最终答案" }, finish_reason: "stop" }] },
      ]),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await requestModelCompletion({
      ...model,
      model_name: "deepseek-v4-flash",
      base_url: "https://opencode.ai/zen/go/v1",
    }, "sk-test", {
      system: "system",
      user: "user",
      stream: true,
    });

    const requestCalls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    const requestBody = JSON.parse(String(requestCalls[0][1].body));
    expect(requestBody.thinking).toEqual({ type: "disabled" });
    expect(requestBody.chat_template_kwargs).toBeUndefined();
    expect(requestBody.reasoning_effort).toBeUndefined();
    expect(requestBody.thinking_budget).toBeUndefined();
  });

  it("does not send unverified thinking fields for ordinary OpenAI-compatible providers", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: sseStream([
        { choices: [{ delta: { content: "最终答案" }, finish_reason: "stop" }] },
      ]),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await requestModelCompletion({
      ...model,
      model_name: "qwen-plus",
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }, "sk-test", {
      system: "system",
      user: "user",
      stream: true,
    });

    const requestCalls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    const requestBody = JSON.parse(String(requestCalls[0][1].body));
    expect(requestBody.chat_template_kwargs).toBeUndefined();
    expect(requestBody.reasoning_effort).toBeUndefined();
    expect(requestBody.enable_thinking).toBeUndefined();
    expect(requestBody.thinking_budget).toBeUndefined();
  });

  it("does not recover final content from reasoning when visible content is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          finish_reason: "stop",
          message: {
            content: "",
            reasoning_content: [
              "先分析目标评论。",
              "1. 先把证据补上",
              "2. 前提没立住",
              "3. 别急着下结论",
            ].join("\n"),
          },
        }],
      }),
    })));

    await expect(requestModelCompletion(model, "sk-test", {
      system: "system",
      user: "user",
    })).resolves.toMatchObject({
      content: "",
      reasoningContent: "先分析目标评论。\n1. 先把证据补上\n2. 前提没立住\n3. 别急着下结论",
      finishReason: "stop",
      transport: "non_stream",
    });
  });

  it("reports length finish reason without treating reasoning as final content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          finish_reason: "length",
          message: {
            content: "",
            reasoning_content: [
              "先分析目标评论。",
              "1. 先把证据补上",
              "2. 前提没立住",
              "3. 别急着下结论",
            ].join("\n"),
          },
        }],
      }),
    })));

    await expect(requestModelCompletion(model, "sk-test", {
      system: "system",
      user: "user",
    })).resolves.toMatchObject({
      content: "",
      finishReason: "length",
      transport: "non_stream",
    });
  });

  it("parses legacy non-streaming final content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          finish_reason: "stop",
          message: {
            content: "最终答案",
            reasoning_content: "思考内容",
          },
        }],
      }),
    })));

    await expect(requestModelText(model, "sk-test", {
      system: "system",
      user: "user",
    })).resolves.toBe("最终答案");
  });
});

function sseStream(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function hangingDoneStream(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
  });
}
