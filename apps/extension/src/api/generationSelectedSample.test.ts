import { afterEach, describe, expect, it, vi } from "vitest";
import { handleExtensionMessage } from "./handlers";
import { resetExtensionDataForTests } from "./idbStore";
import { normalizeSkillSamples } from "./skillSamples";

function modelTextResponse(content: string) {
  return {
    ok: true,
    status: 200,
    body: sseStream([{ choices: [{ delta: { content }, finish_reason: "stop" }] }]),
  };
}

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

describe("generation selected sample prompt", () => {
  afterEach(() => {
    resetExtensionDataForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends only the selected sample for the resolved length bucket", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "Test",
        model_name: "gpt-test",
        base_url: "https://api.example.test/v1",
        api_key: "sk-test",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const detail = await handleExtensionMessage({ type: "skills:getDetail", payload: { skillId: "full_fire" } });
    const samples = normalizeSkillSamples(detail.sample_outputs);
    const selected = samples.find((sample) => sample.lengthBucket === "短")!;
    const unselected = samples.find((sample) => sample.lengthBucket === "短" && sample.id !== selected.id)!;

    await handleExtensionMessage({
      type: "settings:save",
      payload: {
        skill_sample_selections: {
          full_fire: { "短": selected.id },
        },
      },
    });

    const fetchMock = vi.fn(async () => modelTextResponse(JSON.stringify({
      candidates: ["嫌贵先看价值", "别拿价格挡判断", "贵不等于不成立"],
    })));
    vi.stubGlobal("fetch", fetchMock);

    await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "target-1", text: "这个东西太贵了" },
        context: { pageTitle: "测试页", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "10字以内", ammoBoxIds: [] },
      },
    });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(String(requestInit.body));
    const userPrompt = body.messages[1].content as string;

    expect(userPrompt).toContain("Selected Sample");
    expect(userPrompt).toContain("最终字数必须服从长度要求");
    expect(userPrompt).toContain("不超过 10 个汉字");
    expect(userPrompt).toContain(selected.input);
    expect(userPrompt).toContain(selected.output);
    expect(userPrompt).not.toContain(unselected.output);
    expect(userPrompt).toContain("不要复用样本里的话题、实体、例子或事实");
    expect(userPrompt).toContain("不要编造保真率、指数、纯度、浓度、阈值、因子、百分比评分等不存在的指标");
  });
});
