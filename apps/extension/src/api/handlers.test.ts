import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleExtensionMessage } from "./handlers";
import { normalizeSkillDetailForRead, resetExtensionDataForTests } from "./idbStore";
import { countEffectiveChars } from "./lengthConstraints";

describe("extension background API handlers", () => {
  beforeEach(() => {
    resetExtensionDataForTests();
    vi.unstubAllGlobals();
  });

  function fixedAttackPlaybook(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...extra,
      taxonomy: {
        classification: 0.25,
        rhetorical_question: 0.2,
        analogy: 0.1,
        counterfactual: 0.05,
        reduction: 0.1,
        irony: 0.05,
        definition_war: 0.1,
        compressed_conclusion: 0.15,
      },
    };
  }

  function completeSkillPackage(name: string, body: string, goal = "Imported Skill"): Record<string, string> {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "imported-skill";
    return {
      "manifest.json": JSON.stringify({ id, name, skill_name: id, goal, version: "0.1.0", summary: body }),
      "SKILL.md": [
        "---",
        `name: ${id}`,
        `description: Use when ${goal}`,
        "---",
        "",
        `# ${name}`,
        "",
        body,
      ].join("\n"),
      "style_profile.json": JSON.stringify({ tone: "direct" }),
      "attack_playbook.json": JSON.stringify(fixedAttackPlaybook({ moves: ["classify"] })),
    };
  }

  function generatedSkillPayload(name = "证据锚", body = "追问证据，压住跳步结论。") {
    return {
      skill_md: `# ${name}\n\n${body}`,
      style_profile: { catchphrases: ["摆数据", "别跳步"], tone: "短促逼问" },
      attack_playbook: fixedAttackPlaybook({ moves: ["补证据"] }),
      sample_outputs: [
        { prompt: "你不懂", reply: "先把证据摆出来。" },
        { prompt: "大家都这么说", reply: "共识不是证据。" },
      ],
    };
  }

  function candidateJson(candidates: string[]): string {
    return JSON.stringify({ candidates });
  }

  function openAiStreamText(content: string, options: { finishReason?: string; reasoningContent?: string } = {}) {
    const chunks: unknown[] = [];
    if (options.reasoningContent) {
      chunks.push({ choices: [{ delta: { reasoning_content: options.reasoningContent } }] });
    }
    chunks.push({ choices: [{ delta: { content }, finish_reason: options.finishReason ?? "stop" }] });
    return {
      ok: true,
      status: 200,
      body: sseStream(chunks),
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

  it("creates corpus boxes and dedupes added entries", async () => {
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "知乎素材", description: "回答", platform: "zhihu" },
    });

    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          { source: "zhihu", content: "同一段内容", metadata: { url: "https://example.com/a" } },
          { source: "zhihu", content: " 同一段内容 ", metadata: { url: "https://example.com/b" } },
          { source: "zhihu", content: "另一段内容" },
        ],
      },
    });

    const entries = await handleExtensionMessage({ type: "corpus:listEntries", payload: { boxId: box.id } });
    expect(entries.map((entry) => entry.content)).toEqual(["同一段内容", "另一段内容"]);

    const boxes = await handleExtensionMessage({ type: "corpus:listBoxes" });
    expect(boxes.find((item) => item.id === box.id)?.entry_count).toBe(2);
  });

  it("seeds built-in skills once and returns skill details", async () => {
    const skills = await handleExtensionMessage({ type: "skills:list" });
    const secondList = await handleExtensionMessage({ type: "skills:list" });
    const fullFire = skills.find((skill) => skill.id === "full_fire");

    expect(fullFire?.compile_status).toBe("builtin");
    expect(fullFire?.name).toBe("焚锋");
    expect(skills.find((skill) => skill.id === "restrained_breakdown")?.name).toBe("静辨");
    expect(skills.find((skill) => skill.id === "sarcastic_ironic")?.name).toBe("冷讥");
    expect(skills.find((skill) => skill.id === "skill_creator")?.name).toBe("铸技司");
    expect(secondList.filter((skill) => skill.id === "full_fire")).toHaveLength(1);

    const detail = await handleExtensionMessage({
      type: "skills:getDetail",
      payload: { skillId: "full_fire" },
    });

    expect(detail.skill_md).toContain("焚锋");

    const creatorDetail = await handleExtensionMessage({
      type: "skills:getDetail",
      payload: { skillId: "skill_creator" },
    });
    const creatorPlaybook = JSON.parse(creatorDetail.files?.["attack_playbook.json"] ?? "{}");
    expect(Object.values(creatorPlaybook.taxonomy)).toEqual(
      expect.arrayContaining([expect.any(Number)]),
    );
  });

  it("deletes imported Skills but blocks built-in Skill deletion", async () => {
    const compiled = await handleExtensionMessage({
      type: "skills:compile",
      payload: { files: completeSkillPackage("Delete Me", "临时导入的技将。") },
    });
    expect(compiled.ok).toBe(true);
    expect((await handleExtensionMessage({ type: "skills:list" })).some((skill) => skill.id === "delete-me")).toBe(true);

    await handleExtensionMessage({
      type: "skills:delete",
      payload: { skillId: "delete-me" },
    });

    expect((await handleExtensionMessage({ type: "skills:list" })).some((skill) => skill.id === "delete-me")).toBe(false);
    await expect(handleExtensionMessage({
      type: "skills:getDetail",
      payload: { skillId: "delete-me" },
    })).rejects.toThrow("skill_not_found");

    await expect(handleExtensionMessage({
      type: "skills:delete",
      payload: { skillId: "full_fire" },
    })).rejects.toThrow("skill_builtin_delete_blocked");
    expect((await handleExtensionMessage({ type: "skills:list" })).some((skill) => skill.id === "full_fire")).toBe(true);
  });

  it("does not allow content scripts to delete Skills", async () => {
    await expect(handleExtensionMessage({
      type: "skills:delete",
      payload: { skillId: "draft-skill" },
    }, {
      tab: { id: 1, url: "https://www.zhihu.com/question/1" },
      url: "https://www.zhihu.com/question/1",
    } as chrome.runtime.MessageSender)).rejects.toThrow("message_not_allowed_from_content:skills:delete");
  });

  it("seeds default ammo boxes into extension storage for Workbench and content panels", async () => {
    const boxes = await handleExtensionMessage({ type: "ammo:listBoxes" });

    expect(boxes.map((box) => box.name)).toEqual([
      "攻击黑话·身份",
      "攻击黑话·行为",
      "攻击黑话·语气",
      "时事热梗",
    ]);
    expect(boxes.map((box) => box.entry_count)).toEqual([15, 14, 9, 0]);

    const entries = await handleExtensionMessage({
      type: "ammo:listEntries",
      payload: { boxId: boxes[0].id },
    });
    expect(entries[0]).toEqual(expect.objectContaining({
      term: "废物",
      description: expect.stringContaining("纯纯**废物**"),
    }));
  });

  it("keeps model API keys out of model list and exposes only masked key state", async () => {
    for (const [field, value] of [
      ["api_key", "sk-legacy-settings-key"],
      ["api_key_set", true],
      ["base_url", "http://127.0.0.1:17321"],
    ] as const) {
      await expect(handleExtensionMessage({
        type: "settings:save",
        payload: { [field]: value } as never,
      })).rejects.toThrow(`settings_field_not_allowed:${field}`);
    }
    const beforeModel = await handleExtensionMessage({ type: "settings:get" });
    expect(beforeModel.api_key_set).toBe(false);
    expect(JSON.stringify(beforeModel)).not.toContain("sk-legacy-settings-key");

    const saved = await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-1234567890",
        is_default: true,
      },
    });

    expect(saved.api_key_masked).toBe("sk-••••7890");
    expect(saved.api_protocol).toBe("openai_chat");

    const settings = await handleExtensionMessage({ type: "settings:get" });
    expect(settings.api_key_set).toBe(true);
    expect(JSON.stringify(settings)).not.toContain("sk-1234567890");

    await handleExtensionMessage({ type: "models:delete", payload: { id: saved.id } });
    await expect(handleExtensionMessage({
      type: "generation:generate",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "删除模型后不应串用旧 key" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [] },
      },
    })).rejects.toThrow("generation_model_required");
  });

  it("saves HTTPS OpenAI-compatible model base URLs outside the built-in provider list", async () => {
    const saved = await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "Qwen Bailian",
        model_name: "qwen-plus",
        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        api_key: "sk-qwen-1234567890",
        is_default: true,
      },
    });

    expect(saved).toEqual(expect.objectContaining({
      provider: "Qwen Bailian",
      model_name: "qwen-plus",
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      api_key_masked: "sk-••••7890",
      is_default: true,
    }));
    expect(JSON.stringify(saved)).not.toContain("sk-qwen-1234567890");
  });

  it("saves generic HTTPS provider configs with long keys and explicit API protocol", async () => {
    const longKey = "sk-" + "a".repeat(96);

    const openCodeGo = await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "qwen3.7-plus",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: longKey,
        api_protocol: "anthropic_messages",
        is_default: true,
      },
    });
    const dashScope = await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "Qwen DashScope",
        model_name: "qwen-plus",
        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        api_key: "sk-dashscope-1234567890",
        api_protocol: "openai_chat",
      },
    });

    expect(openCodeGo).toEqual(expect.objectContaining({
      provider: "OpenCode Go",
      model_name: "qwen3.7-plus",
      base_url: "https://opencode.ai/zen/go/v1",
      api_key_masked: "sk-••••aaaa",
      api_protocol: "anthropic_messages",
      is_default: true,
    }));
    expect(dashScope).toEqual(expect.objectContaining({
      provider: "Qwen DashScope",
      model_name: "qwen-plus",
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      api_protocol: "openai_chat",
    }));

    const listed = await handleExtensionMessage({ type: "models:list" });
    expect(JSON.stringify(listed)).not.toContain(longKey);
  });

  it("detects provider models from the configured models endpoint", async () => {
    const fetchMock = vi.fn(async (): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => ({
      ok: true,
      status: 200,
      json: async () => ({
        object: "list",
        data: [
          { id: "qwen-plus", object: "model" },
          { id: "qwen-max", object: "model" },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleExtensionMessage({
      type: "models:detect",
      payload: { base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    });

    expect(result).toEqual({
      ok: true,
      models: [
        { id: "qwen-plus", api_protocol: "openai_chat" },
        { id: "qwen-max", api_protocol: "openai_chat" },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("tests OpenAI-compatible chat model connections without leaking keys", async () => {
    const saved = await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "Custom",
        model_name: "gpt-test",
        base_url: "https://api.example.test/v1",
        api_key: "sk-chat-secret",
        api_protocol: "openai_chat",
      },
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "pong" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleExtensionMessage({
      type: "models:test",
      payload: { id: saved.id },
    });

    expect(result).toEqual({ ok: true, model: "gpt-test" });
    const [url, requestInit] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.example.test/v1/chat/completions");
    expect(requestInit.headers.Authorization).toBe("Bearer sk-chat-secret");
    expect(JSON.stringify(result)).not.toContain("sk-chat-secret");
    expect(JSON.parse(requestInit.body)).toEqual(expect.objectContaining({
      model: "gpt-test",
      max_tokens: 1024,
    }));
  });

  it("tests Anthropic-compatible messages model connections with x-api-key auth", async () => {
    const saved = await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "qwen3.7-plus",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-messages-secret",
        api_protocol: "anthropic_messages",
      },
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: "text", text: "pong" }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleExtensionMessage({
      type: "models:test",
      payload: { id: saved.id },
    });

    expect(result).toEqual({ ok: true, model: "qwen3.7-plus" });
    const [url, requestInit] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(requestInit.headers["x-api-key"]).toBe("sk-messages-secret");
    expect(requestInit.headers.Authorization).toBeUndefined();
    expect(requestInit.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(requestInit.body)).toEqual(expect.objectContaining({
      model: "qwen3.7-plus",
      max_tokens: 1024,
    }));
  });

  it("falls back to OpenCode messages when the OpenAI-compatible chat probe is unavailable", async () => {
    const saved = await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-opencode-secret",
        api_protocol: "openai_chat",
      },
    });
    const fetchMock = vi.fn(async (url: string): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
      if (url.endsWith("/chat/completions")) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: "not found" } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: "text", text: "pong" }] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleExtensionMessage({
      type: "models:test",
      payload: { id: saved.id },
    });

    expect(result).toEqual({ ok: true, model: "deepseek-v4-flash" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://opencode.ai/zen/go/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://opencode.ai/zen/go/v1/messages",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("creates model-generated Skill drafts from selected corpus entries", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-opencode-secret",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "评论风格箱", description: "知乎样本", platform: "zhihu" },
    });
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          {
            source: "zhihu",
            metadata: { title: "风格长文" },
            content: [
              "开头句：我始终认为，讨论问题要先定义。",
              "SHOULD_NOT_LEAK_MIDDLE ".repeat(90),
              "但是这里真正的问题，是你把结果当原因。",
              "为什么这叫偷换概念？因为你先改了定义，再要求别人接受。",
              "结尾句：所以别急着站队，先把概念摆正。",
            ].join("\n"),
          },
          ...Array.from({ length: 23 }, (_, index) => ({
            source: "zhihu",
            content: `第 ${index + 2} 条素材：先把定义框住，再拆对方偷换概念的地方。`,
          })),
          {
            source: "zhihu",
            content: "SHOULD_NOT_INCLUDE_ENTRY_25 第二十五条素材不应进入模型。",
          },
        ],
      },
    });
    const fetchMock = vi.fn(async (): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              skill_md: "# 证据锚\n\n先压住情绪，再逼对方补前提和证据。",
              style_profile: { catchphrases: ["补前提", "摆证据"], tone: "冷静短促", source_box_ids: [box.id] },
              attack_playbook: fixedAttackPlaybook({ moves: ["追问前提", "指出跳步"] }),
              sample_outputs: [
                { prompt: "你不懂", reply: "先把证据摆出来。" },
                { prompt: "大家都这么说", reply: "共识不能替代证据。" },
              ],
              summary: "用证据和前提拆解跳步发言。",
            }),
          },
        }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const draft = await handleExtensionMessage({
      type: "skills:createDraft",
      payload: {
        source_box_ids: [box.id],
        skill_name: "证据锚",
        skill_goal: "拆解没证据的评论",
      },
    });

    expect(draft.files["SKILL.md"]).toContain("先压住情绪");
    expect(draft.files["SKILL.md"]).toMatch(/^---\nname: generated-skill\n/);
    expect(draft.files["style_profile.json"]).toContain("冷静短促");
    expect(draft.files["attack_playbook.json"]).toContain("追问前提");
    expect(draft.files["sample_outputs.json"]).toContain("先把证据摆出来");
    const manifest = JSON.parse(draft.files["manifest.json"]);
    expect(manifest).toEqual(expect.objectContaining({
      id: "generated-skill",
      name: "证据锚",
      goal: "拆解没证据的评论",
      version: "0.1.0",
    }));
    const playbook = JSON.parse(draft.files["attack_playbook.json"]);
    expect(Object.keys(playbook.taxonomy).sort()).toEqual([
      "analogy",
      "classification",
      "compressed_conclusion",
      "counterfactual",
      "definition_war",
      "irony",
      "reduction",
      "rhetorical_question",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const requestBody = JSON.parse(requestInit.body);
    const prompt = JSON.stringify(requestBody);
    expect(requestBody.response_format).toEqual({ type: "json_object" });
    expect(requestBody.messages[0].content).toContain("不要输出思考过程");
    expect(requestBody.messages[0].content).toContain("\"classification\": 0.2");
    expect(requestBody.messages[0].content).not.toContain("如何归类对方观点获得论证优势");
    expect(prompt).toContain("deepseek-v4-flash");
    expect(prompt).toContain("来源: zhihu");
    expect(prompt).toContain("标题: 风格长文");
    expect(prompt).toContain("开头句：我始终认为，讨论问题要先定义。");
    expect(prompt).toContain("为什么这叫偷换概念？因为你先改了定义，再要求别人接受。");
    expect(prompt).toContain("结尾句：所以别急着站队，先把概念摆正。");
    expect(prompt).not.toContain("SHOULD_NOT_LEAK_MIDDLE");
    expect(prompt).not.toContain("SHOULD_NOT_INCLUDE_ENTRY_25");
    expect(prompt).toContain("拆解没证据的评论");
  });

  it("maps DeepSeek reasoning-only length responses to a stable truncated-output error", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-opencode-secret",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "推理截断素材", description: "", platform: "zhihu" },
    });
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          { source: "zhihu", content: "先讲定义，再讲前提，最后压缩结论。" },
          { source: "zhihu", content: "别把情绪当证据，先把论证链条补齐。" },
          { source: "zhihu", content: "为什么要追问？因为对方跳过了关键因果。" },
        ],
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          finish_reason: "length",
          message: {
            content: "",
            reasoning_content: "我需要先分析素材风格，然后输出 JSON，但已经耗尽输出预算。",
          },
        }],
      }),
    })));

    await expect(handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "截断 Skill", skill_goal: "识别截断错误" },
    })).rejects.toThrow("skill_creator_model_output_truncated");

    expect((await handleExtensionMessage({ type: "skills:list" }))
      .some((skill) => skill.name === "截断 Skill")).toBe(false);
  });

  it("rejects Skill draft creation when no model API key is configured", async () => {
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "无模型素材", description: "", platform: "zhihu" },
    });
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          { source: "zhihu", content: "第一条有效素材" },
          { source: "zhihu", content: "第二条有效素材" },
          { source: "zhihu", content: "第三条有效素材" },
        ],
      },
    });

    await expect(handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "无模型 Skill", skill_goal: "拒绝空壳" },
    })).rejects.toThrow("skill_creator_model_required");

    await expect(handleExtensionMessage({
      type: "skills:publish",
      payload: { draftId: 1 },
    })).rejects.toThrow("draft_not_found");
    expect((await handleExtensionMessage({ type: "skills:list" }))
      .some((skill) => skill.name === "无模型 Skill")).toBe(false);
  });

  it("rejects Skill draft creation when selected corpus material is insufficient", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-opencode-secret",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "不足素材", description: "", platform: "zhihu" },
    });
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          { source: "zhihu", content: "只有一条短素材" },
          { source: "zhihu", content: "第二条也很短" },
        ],
      },
    });

    await expect(handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "不足 Skill", skill_goal: "拒绝素材不足" },
    })).rejects.toThrow("skill_creator_material_insufficient");

    await expect(handleExtensionMessage({
      type: "skills:publish",
      payload: { draftId: 1 },
    })).rejects.toThrow("draft_not_found");
    expect((await handleExtensionMessage({ type: "skills:list" }))
      .some((skill) => skill.name === "不足 Skill")).toBe(false);
  });

  it("rejects Skill draft creation when model output is invalid JSON or an empty shell", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-opencode-secret",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "非法输出素材", description: "", platform: "zhihu" },
    });
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          { source: "zhihu", content: "先拎定义，再拆论证。" },
          { source: "zhihu", content: "追问证据，不接情绪。" },
          { source: "zhihu", content: "结论跳步时先补中间链条。" },
        ],
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "not-json" } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            skill_md: "# 空壳 Skill\n\n只写目标",
            style_profile: {},
            attack_playbook: {},
            sample_outputs: [],
          }) } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            skill_md: "# 少样例 Skill\n\n追问证据，压住跳步结论。",
            style_profile: { catchphrases: ["证据呢", "别跳步"], keywords: ["前提", "证据"] },
            attack_playbook: fixedAttackPlaybook({ moves: ["补证据"] }),
            sample_outputs: [],
          }) } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: `这里是解释，不是纯 JSON。\n${JSON.stringify(generatedSkillPayload("混合输出 Skill", "追问证据，压住跳步结论。"))}` } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(generatedSkillPayload("围栏 Skill", "追问证据，压住跳步结论。"))}\n\`\`\`` } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            skill_md: "# 标签空壳 Skill\n\nGoal: 拒绝空壳",
            style_profile: { tone: "placeholder" },
            attack_playbook: { moves: ["placeholder"] },
            sample_outputs: [
              { prompt: "你不懂", reply: "先把证据摆出来。" },
              { prompt: "大家都这么说", reply: "共识不能替代证据。" },
            ],
          }) } }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "非法 Skill", skill_goal: "拒绝非法 JSON" },
    })).rejects.toThrow("skill_creator_invalid_output");

    await expect(handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "空壳 Skill", skill_goal: "拒绝空壳" },
    })).rejects.toThrow("skill_creator_invalid_output");

    await expect(handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "少样例 Skill", skill_goal: "拒绝少样例" },
    })).rejects.toThrow("skill_creator_invalid_output");

    await expect(handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "混合输出 Skill", skill_goal: "拒绝解释包裹 JSON" },
    })).rejects.toThrow("skill_creator_invalid_output");

    await expect(handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "围栏 Skill", skill_goal: "拒绝 Markdown 围栏 JSON" },
    })).rejects.toThrow("skill_creator_invalid_output");

    await expect(handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "标签空壳 Skill", skill_goal: "拒绝空壳" },
    })).rejects.toThrow("skill_creator_invalid_output");

    await expect(handleExtensionMessage({
      type: "skills:publish",
      payload: { draftId: 1 },
    })).rejects.toThrow("draft_not_found");
    const skills = await handleExtensionMessage({ type: "skills:list" });
    expect(skills.some((skill) => ["非法 Skill", "空壳 Skill", "混合输出 Skill", "围栏 Skill", "标签空壳 Skill"].includes(skill.name))).toBe(false);
  });

  it("runs Skill tryouts through the configured model instead of deterministic template replies", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-opencode-secret",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify(generatedSkillPayload()),
          },
        }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "试打素材", description: "", platform: "zhihu" },
    });
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          { source: "zhihu", content: "先讲证据，再讲态度。" },
          { source: "zhihu", content: "别把情绪包装成论证。" },
          { source: "zhihu", content: "跳步结论要追回前提。" },
        ],
      },
    });
    const draft = await handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "证据锚", skill_goal: "追问证据" },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "先把证据摆出来，再下结论。" } }] }),
    });

    const result = await handleExtensionMessage({
      type: "skills:runTryout",
      payload: { draftId: draft.id, user_utterance: "你就是不懂", round_index: 1 },
    });

    expect(result.reply).toBe("先把证据摆出来，再下结论。");
    expect(result.reply).not.toContain("你就是不懂 这个说法最大的问题");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws the redacted model failure reason when Skill tryouts fail", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-opencode-secret",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async (): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(generatedSkillPayload()) } }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "试打降级素材", description: "", platform: "zhihu" },
    });
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          { source: "zhihu", content: "先讲证据，再讲态度。" },
          { source: "zhihu", content: "别把情绪包装成论证。" },
          { source: "zhihu", content: "跳步结论要追回前提。" },
        ],
      },
    });
    const draft = await handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "证据锚", skill_goal: "追问证据" },
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Invalid API key sk-secret-value" } }),
    });

    let message = "";
    try {
      await handleExtensionMessage({
        type: "skills:runTryout",
        payload: { draftId: draft.id, user_utterance: "你就是不懂", round_index: 1 },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("skill_creator_model_request_failed_401");
    expect(message).not.toContain("sk-secret-value");
  });

  it("passes custom length constraints into model-backed Skill tryouts", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-opencode-secret",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify(generatedSkillPayload()),
          },
        }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "试打长度素材", description: "", platform: "zhihu" },
    });
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          { source: "zhihu", content: "先讲证据，再讲态度。" },
          { source: "zhihu", content: "别把情绪包装成论证。" },
          { source: "zhihu", content: "跳步结论要追回前提。" },
        ],
      },
    });
    const draft = await handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "证据锚", skill_goal: "追问证据" },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "先把证据摆出来，再谈结论。" } }] }),
    });

    await handleExtensionMessage({
      type: "skills:runTryout",
      payload: {
        draftId: draft.id,
        user_utterance: "你就是不懂",
        round_index: 1,
        lengthMode: "自定义",
        customLengthTarget: 16,
      },
    });

    const tryoutCalls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    const tryoutBody = JSON.parse(String(tryoutCalls[1][1].body));
    const prompt = tryoutBody.messages.map((message: { content: string }) => message.content).join("\n");
    expect(prompt).toContain("目标 16 个汉字");
    expect(prompt).toContain("标点不计入字数");
  });

  it("rebuilds Skill draft files through the model when feedback is applied", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-opencode-secret",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "反馈素材", description: "", platform: "zhihu" },
    });
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          { source: "zhihu", content: "先讲证据，再讲态度。" },
          { source: "zhihu", content: "别把情绪包装成论证。" },
          { source: "zhihu", content: "跳步结论要追回前提。" },
        ],
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            skill_md: "# 证据锚\n\n追问证据，压住跳步结论。",
            style_profile: { catchphrases: ["证据呢", "先摆事实"], tone: "短促逼问" },
            attack_playbook: fixedAttackPlaybook({ moves: ["补证据"] }),
            sample_outputs: [
              { prompt: "你不懂", reply: "先把证据摆出来。" },
              { prompt: "大家都这么说", reply: "共识不是证据。" },
            ],
          }) } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "先把证据摆出来。" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            skill_md: "# 证据锚 v2\n\n更狠地追问证据，但不复读对方。",
            style_profile: { catchphrases: ["证据呢", "别绕"], tone: "更冷更短" },
            attack_playbook: fixedAttackPlaybook({ moves: ["追证据", "压结论"] }),
            sample_outputs: [
              { prompt: "你不懂", reply: "证据拿出来再摆姿态。" },
              { prompt: "大家都这么说", reply: "人多不是论证。" },
            ],
          }) } }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const draft = await handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "证据锚", skill_goal: "追问证据" },
    });
    await handleExtensionMessage({
      type: "skills:runTryout",
      payload: { draftId: draft.id, user_utterance: "你不懂", round_index: 1 },
    });

    const rebuilt = await handleExtensionMessage({
      type: "skills:applyFeedback",
      payload: { draftId: draft.id, feedback: "更短更狠", tags: ["不够狠"] },
    });

    expect(rebuilt.draft_version).toBe(2);
    expect(rebuilt.feedback_cycles).toBe(1);
    expect(rebuilt.files["SKILL.md"]).toContain("更狠地追问证据");
    expect(rebuilt.files["feedback.json"]).toContain("更短更狠");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const rebuildBody = JSON.parse(String((fetchMock.mock.calls[2][1] as { body: string }).body));
    const rebuildPrompt = rebuildBody.messages.map((message: { content: string }) => message.content).join("\n");
    expect(rebuildPrompt).toContain("更短更狠");
    expect(rebuildPrompt).toContain("先把证据摆出来");
    expect(rebuildPrompt).toContain("SKILL.md");
  });

  it("rejects the fourth feedback rebuild cycle", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-opencode-secret",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "反馈次数素材", description: "", platform: "zhihu" },
    });
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          { source: "zhihu", content: "先讲证据，再讲态度。" },
          { source: "zhihu", content: "别把情绪包装成论证。" },
          { source: "zhihu", content: "跳步结论要追回前提。" },
        ],
      },
    });
    let version = 1;
    const generated = () => JSON.stringify({
      skill_md: `# 证据锚 v${version}\n\n追问证据，压住跳步结论。`,
      style_profile: { catchphrases: [`追证据${version}`, `压结论${version}`], tone: `短促 ${version}` },
      attack_playbook: fixedAttackPlaybook({ moves: ["补证据"] }),
      sample_outputs: [
        { prompt: "你不懂", reply: "先把证据摆出来。" },
        { prompt: "大家都这么说", reply: "共识不是证据。" },
      ],
    });
    const fetchMock = vi.fn(async () => {
      const content = generated();
      version += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content } }] }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    let draft = await handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "证据锚", skill_goal: "追问证据" },
    });
    for (const feedback of ["一改", "二改", "三改"]) {
      draft = await handleExtensionMessage({
        type: "skills:applyFeedback",
        payload: { draftId: draft.id, feedback, tags: [] },
      });
    }

    await expect(handleExtensionMessage({
      type: "skills:applyFeedback",
      payload: { draftId: draft.id, feedback: "四改", tags: [] },
    })).rejects.toThrow("skill_creator_feedback_limit_reached");
  });

  it("publishes accepted tryouts as sample outputs", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-opencode-secret",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "发布素材", description: "", platform: "zhihu" },
    });
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          { source: "zhihu", content: "先讲证据，再讲态度。" },
          { source: "zhihu", content: "别把情绪包装成论证。" },
          { source: "zhihu", content: "跳步结论要追回前提。" },
        ],
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            skill_md: "# 证据锚\n\n追问证据，压住跳步结论。",
            style_profile: { catchphrases: ["证据呢", "先讲事实"], tone: "短促逼问" },
            attack_playbook: fixedAttackPlaybook({ moves: ["补证据"] }),
            sample_outputs: [
              { prompt: "你不懂", reply: "先把证据摆出来。" },
              { prompt: "大家都这么说", reply: "共识不是证据。" },
            ],
          }) } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "先把证据摆出来。" } }] }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const draft = await handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "证据锚", skill_goal: "追问证据" },
    });
    const tryout = await handleExtensionMessage({
      type: "skills:runTryout",
      payload: { draftId: draft.id, user_utterance: "你不懂", round_index: 1 },
    });

    const published = await handleExtensionMessage({
      type: "skills:publish",
      payload: { draftId: draft.id, accepted_tryout_ids: [tryout.id] },
    });
    const detail = await handleExtensionMessage({
      type: "skills:getDetail",
      payload: { skillId: published.id },
    });

    expect(detail.sample_outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ prompt: "你不懂", reply: "先把证据摆出来。" }),
    ]));

  });

  it("publishes only accepted tryouts from the current draft version", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-opencode-secret",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "版本隔离素材", description: "", platform: "zhihu" },
    });
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          { source: "zhihu", content: "先讲证据，再讲态度。" },
          { source: "zhihu", content: "别把情绪包装成论证。" },
          { source: "zhihu", content: "跳步结论要追回前提。" },
        ],
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(generatedSkillPayload("证据锚", "追问证据，压住跳步结论。")) } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "旧版回复" } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(generatedSkillPayload("证据锚 v2", "新版追问证据并压住跳步结论。")) } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "新版回复" } }] }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const draft = await handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "证据锚", skill_goal: "追问证据" },
    });
    const oldTryout = await handleExtensionMessage({
      type: "skills:runTryout",
      payload: { draftId: draft.id, user_utterance: "old version", round_index: 1 },
    });
    await handleExtensionMessage({
      type: "skills:applyFeedback",
      payload: { draftId: draft.id, feedback: "重建新版", tags: [] },
    });
    const newTryout = await handleExtensionMessage({
      type: "skills:runTryout",
      payload: { draftId: draft.id, user_utterance: "new version", round_index: 1 },
    });

    const published = await handleExtensionMessage({
      type: "skills:publish",
      payload: { draftId: draft.id, accepted_tryout_ids: [oldTryout.id, newTryout.id] },
    });
    const detail = await handleExtensionMessage({
      type: "skills:getDetail",
      payload: { skillId: published.id },
    });

    expect(detail.files?.["sample_outputs.json"]).toContain("new version");
    expect(detail.files?.["sample_outputs.json"]).not.toContain("old version");
  });

  it.skip("rejects publishing when accepted tryouts plus draft samples total fewer than 2 usable samples", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-opencode-secret",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "单个样本素材", description: "", platform: "zhihu" },
    });
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          { source: "zhihu", content: "先讲证据，再讲态度。" },
          { source: "zhihu", content: "别把情绪包装成论证。" },
          { source: "zhihu", content: "跳步结论要追回前提。" },
        ],
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            skill_md: "# 证据锚\n\n追问证据，压住跳步结论。",
            style_profile: { catchphrases: ["证据呢", "先摆事实"], tone: "短促逼问" },
            attack_playbook: fixedAttackPlaybook({ moves: ["补证据"] }),
            sample_outputs: [{ prompt: "draft 例子", reply: "draft 回复" }],
            summary: "测试用 Skill - 只有一个 draft 样本",
          }) } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "  " } }] }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const draft = await handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "证据锚", skill_goal: "追问证据" },
    });
    const tryout1 = await handleExtensionMessage({
      type: "skills:runTryout",
      payload: { draftId: draft.id, user_utterance: "你不懂", round_index: 1 },
    });

    await expect(handleExtensionMessage({
      type: "skills:publish",
      payload: { draftId: draft.id, accepted_tryout_ids: [tryout1.id] },
    })).rejects.toThrow("skill_creator_publish_blocked");
  });

  it("rejects imported Skill packages with only blank samples", async () => {
    const blankSamples = completeSkillPackage("空白样本 Skill", "Body with real instructions.");
    blankSamples["sample_outputs.json"] = JSON.stringify([
      { prompt: "  ", reply: "  " },
      { prompt: "", reply: "" },
    ]);
    const result = await handleExtensionMessage({
      type: "skills:compile",
      payload: { files: blankSamples, require_samples: true },
    });

    expect(result.ok).toBe(false);
    expect(result.errors?.join("\n")).toContain("sample_outputs.json must contain at least 2 usable samples");
  });

  it("rejects imported Skill packages missing required declarative files", async () => {
    const result = await handleExtensionMessage({
      type: "skills:compile",
      payload: { files: { "SKILL.md": "# Broken\n\nMissing package files." } },
    });

    expect(result.ok).toBe(false);
    expect(result.errors?.join("\n")).toContain("style_profile.json");
  });

  it("rejects imported Skill packages missing core manifest fields or fixed attack taxonomy", async () => {
    const missingManifestCore = completeSkillPackage("Coreless Skill", "Body with real instructions.");
    missingManifestCore["manifest.json"] = JSON.stringify({ name: "Coreless Skill", goal: "Imported Skill" });
    const missingManifestResult = await handleExtensionMessage({
      type: "skills:compile",
      payload: { files: missingManifestCore },
    });
    expect(missingManifestResult.ok).toBe(false);
    expect(missingManifestResult.errors?.join("\n")).toContain("manifest.json missing required fields");

    const invalidTaxonomy = completeSkillPackage("Bad Taxonomy", "Body with real instructions.");
    invalidTaxonomy["attack_playbook.json"] = JSON.stringify({ moves: ["classify"] });
    const invalidTaxonomyResult = await handleExtensionMessage({
      type: "skills:compile",
      payload: { files: invalidTaxonomy },
    });
    expect(invalidTaxonomyResult.ok).toBe(false);
    expect(invalidTaxonomyResult.errors?.join("\n")).toContain("fixed 8-class taxonomy");

    const stringTaxonomy = completeSkillPackage("String Taxonomy", "Body with real instructions.");
    stringTaxonomy["attack_playbook.json"] = JSON.stringify({
      taxonomy: {
        classification: "如何归类",
        rhetorical_question: "如何反问",
        analogy: "如何类比",
        counterfactual: "如何反事实",
        reduction: "如何简化",
        irony: "如何讽刺",
        definition_war: "如何定义",
        compressed_conclusion: "如何收尾",
      },
    });
    const stringTaxonomyResult = await handleExtensionMessage({
      type: "skills:compile",
      payload: { files: stringTaxonomy },
    });
    expect(stringTaxonomyResult.ok).toBe(false);
    expect(stringTaxonomyResult.errors?.join("\n")).toContain("taxonomy values must be numbers between 0 and 1");
  });

  it("rejects model base URLs that are not HTTPS URLs", async () => {
    for (const baseUrl of ["http://api.example.com/v1", "not-a-url"]) {
      await expect(handleExtensionMessage({
        type: "models:save",
        payload: {
          provider: "Custom",
          model_name: "gpt-test",
          base_url: baseUrl,
          api_key: "sk-1234567890",
          is_default: true,
        },
      })).rejects.toThrow("model_base_url_not_allowed");
    }
  });

  it("rejects executable files in imported Skill packages", async () => {
    const result = await handleExtensionMessage({
      type: "skills:compile",
      payload: { files: { "SKILL.md": "# Bad Skill", "run.js": "alert(1)" } },
    });

    expect(result.ok).toBe(false);
    expect(result.errors?.[0]).toContain("run.js");
  });

  it("updates non-built-in Skills by id and rejects built-in overwrites", async () => {
    const created = await handleExtensionMessage({
      type: "skills:compile",
      payload: { files: completeSkillPackage("Custom Voice", "Original body.") },
    });
    expect(created.ok).toBe(true);
    expect(created.skill?.id).toBe("custom-voice");

    const updated = await handleExtensionMessage({
      type: "skills:compile",
      payload: {
        skillId: "custom-voice",
        files: completeSkillPackage("Renamed Voice", "Updated body."),
      },
    });
    expect(updated.ok).toBe(true);
    expect(updated.skill?.id).toBe("custom-voice");
    expect(updated.skill?.name).toBe("Renamed Voice");

    const detail = await handleExtensionMessage({
      type: "skills:getDetail",
      payload: { skillId: "custom-voice" },
    });
    expect(detail.skill_md).toContain("Updated body.");
    expect(detail.files?.["SKILL.md"]).toContain("Updated body.");

    const directBuiltinUpdate = await handleExtensionMessage({
      type: "skills:compile",
      payload: {
        skillId: "full_fire",
        files: { "SKILL.md": "# Full Fire\n\nChanged." },
      },
    });
    expect(directBuiltinUpdate.ok).toBe(false);
    expect(directBuiltinUpdate.errors?.[0]).toContain("built-in Skill");

    const sameNameBuiltinImport = await handleExtensionMessage({
      type: "skills:compile",
      payload: { files: { "SKILL.md": "# Full Fire\n\nChanged." } },
    });
    expect(sameNameBuiltinImport.ok).toBe(false);
    expect(sameNameBuiltinImport.errors?.[0]).toContain("built-in Skill");
  });

  it("blocks Workbench-only APIs from content senders", async () => {
    const blockedMessages = [
      { type: "settings:get" },
      { type: "settings:save", payload: {} },
      { type: "models:list" },
      { type: "models:detect", payload: { base_url: "https://api.example.test/v1" } },
      { type: "models:test", payload: { id: 1 } },
      { type: "models:delete", payload: { id: 1 } },
      { type: "corpus:listBoxes" },
      { type: "corpus:createBox", payload: { name: "x", description: "" } },
      { type: "skills:getDetail", payload: { skillId: "full_fire" } },
      { type: "skills:compile", payload: { files: { "SKILL.md": "# x" } } },
      { type: "skills:createDraft", payload: { source_box_ids: [], skill_name: "x", skill_goal: "x" } },
    ];

    for (const message of blockedMessages) {
      await expect(handleExtensionMessage(
        message as never,
        { tab: { id: 1 } } as chrome.runtime.MessageSender,
      )).rejects.toThrow("message_not_allowed_from_content");
    }
  });

  it("allows Workbench tabs from this extension to call Workbench-only APIs", async () => {
    vi.stubGlobal("chrome", {
      runtime: { id: "clapback-test-extension" },
    });

    const box = await handleExtensionMessage(
      {
        type: "corpus:createBox",
        payload: { name: "扩展页素材箱", description: "from options tab", platform: "zhihu" },
      },
      {
        id: "clapback-test-extension",
        url: "chrome-extension://clapback-test-extension/index.html",
        tab: { id: 1, url: "chrome-extension://clapback-test-extension/index.html" },
      } as chrome.runtime.MessageSender,
    );

    expect(box.name).toBe("扩展页素材箱");
  });

  it("opens a source tab for collection sessions started from the Workbench tab", async () => {
    const openedTabs: string[] = [];
    vi.stubGlobal("chrome", {
      runtime: { id: "clapback-test-extension" },
      tabs: {
        create: vi.fn(async ({ url }: { url: string }) => {
          openedTabs.push(url);
          return { id: 77, url };
        }),
      },
    });
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "采风箱", description: "", platform: "zhihu" },
    });

    const session = await handleExtensionMessage(
      {
        type: "collection:startSession",
        payload: {
          platform: "zhihu",
          box_id: box.id,
          creator_url: "https://www.zhihu.com/people/example",
          requested_count: 50,
        },
      },
      {
        id: "clapback-test-extension",
        url: "chrome-extension://clapback-test-extension/index.html",
        tab: { id: 1, url: "chrome-extension://clapback-test-extension/index.html" },
      } as chrome.runtime.MessageSender,
    );

    expect(openedTabs).toEqual(["https://www.zhihu.com/people/example"]);
    expect(session.tab_id).toBe(77);
  });

  it("creates a collection session, appends only new basket candidates, and imports to the target corpus", async () => {
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "采风箱", description: "", platform: "zhihu" },
    });
    const session = await handleExtensionMessage({
      type: "collection:startSession",
      payload: {
        platform: "zhihu",
        box_id: box.id,
        creator_url: "https://www.zhihu.com/people/example",
        requested_count: 50,
      },
    });

    const first = await handleExtensionMessage({
      type: "collection:addCandidates",
      payload: {
        sessionId: session.id,
        candidates: [
          { platform: "zhihu", kind: "answer", text: "法律不是按闹分配", sourceId: "a1" },
          { platform: "zhihu", kind: "answer", text: "法律不是按闹分配", sourceId: "a1" },
          { platform: "zhihu", kind: "article", text: "你这个问法本身", sourceId: "a2" },
        ],
      },
    });

    expect(first).toEqual({ added: 2, skipped: 1, basket_count: 2, limit_reached: false });

    const basket = await handleExtensionMessage({
      type: "collection:listBasket",
      payload: { sessionId: session.id },
    });
    expect(basket).toHaveLength(2);

    const imported = await handleExtensionMessage({
      type: "collection:importBasket",
      payload: { sessionId: session.id },
    });
    expect(imported.imported).toBe(2);

    const importedSession = await handleExtensionMessage({
      type: "collection:getSession",
      payload: { sessionId: session.id },
    });
    expect(importedSession?.status).toBe("imported");
    expect(importedSession?.imported_count).toBe(2);

    await expect(handleExtensionMessage({
      type: "collection:addCandidates",
      payload: {
        sessionId: session.id,
        candidates: [{ platform: "zhihu", kind: "answer", text: "导入后不能继续追加", sourceId: "a3" }],
      },
    })).rejects.toThrow("collection_session_not_active");

    const afterImport = await handleExtensionMessage({
      type: "collection:listBasket",
      payload: { sessionId: session.id },
    });
    expect(afterImport).toHaveLength(0);

    const entries = await handleExtensionMessage({ type: "corpus:listEntries", payload: { boxId: box.id } });
    expect(entries.map((entry) => entry.content)).toEqual(["法律不是按闹分配", "你这个问法本身"]);

    const secondSession = await handleExtensionMessage({
      type: "collection:startSession",
      payload: {
        platform: "zhihu",
        box_id: box.id,
        creator_url: "https://www.zhihu.com/people/example?page=2",
        requested_count: 50,
      },
    });
    await handleExtensionMessage({
      type: "collection:addCandidates",
      payload: {
        sessionId: secondSession.id,
        candidates: [
          { platform: "zhihu", kind: "answer", text: "法律不是按闹分配", sourceId: "a1-second-page" },
          { platform: "zhihu", kind: "answer", text: "第三段新内容", sourceId: "a3" },
        ],
      },
    });
    const secondImport = await handleExtensionMessage({
      type: "collection:importBasket",
      payload: { sessionId: secondSession.id },
    });
    expect(secondImport).toEqual({ imported: 1, skipped: 1, box_id: box.id });

    const secondImportedSession = await handleExtensionMessage({
      type: "collection:getSession",
      payload: { sessionId: secondSession.id },
    });
    expect(secondImportedSession?.imported_count).toBe(1);
    expect(secondImportedSession?.skipped_count).toBe(1);
  });

  it("rejects collection sessions without a finite requested_count", async () => {
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "限量采风箱", description: "", platform: "zhihu" },
    });

    await expect(handleExtensionMessage({
      type: "collection:startSession",
      payload: {
        platform: "zhihu",
        box_id: box.id,
        creator_url: "https://www.zhihu.com/people/example",
      } as never,
    })).rejects.toThrow("invalid_requested_count");

    await expect(handleExtensionMessage({
      type: "collection:startSession",
      payload: {
        platform: "zhihu",
        box_id: box.id,
        creator_url: "https://www.zhihu.com/people/example",
        requested_count: Number.NaN,
      },
    })).rejects.toThrow("invalid_requested_count");
  });

  it("rejects creator collection URLs outside the selected platform hosts", async () => {
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "平台校验采风箱", description: "", platform: "zhihu" },
    });

    await expect(handleExtensionMessage({
      type: "collection:startSession",
      payload: {
        platform: "zhihu",
        box_id: box.id,
        creator_url: "https://weibo.com/u/example",
        requested_count: 10,
      },
    })).rejects.toThrow("unsupported_collection_url");

    await expect(handleExtensionMessage({
      type: "collection:startSession",
      payload: {
        platform: "xiaohongshu",
        box_id: box.id,
        creator_url: "https://example.com/creator",
        requested_count: 10,
      },
    })).rejects.toThrow("unsupported_collection_url");
  });

  it("rejects non-HTTPS creator collection URLs because content scripts only match HTTPS", async () => {
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "HTTPS 采风箱", description: "", platform: "zhihu" },
    });

    await expect(handleExtensionMessage({
      type: "collection:startSession",
      payload: {
        platform: "zhihu",
        box_id: box.id,
        creator_url: "http://www.zhihu.com/people/example",
        requested_count: 10,
      },
    })).rejects.toThrow("invalid_creator_url");
  });

  it("uses requested_count as a hard collection basket limit without counting duplicates against the limit", async () => {
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "限量采风箱", description: "", platform: "zhihu" },
    });
    const session = await handleExtensionMessage({
      type: "collection:startSession",
      payload: {
        platform: "zhihu",
        box_id: box.id,
        creator_url: "https://www.zhihu.com/people/example",
        requested_count: 2,
      },
    });

    const first = await handleExtensionMessage({
      type: "collection:addCandidates",
      payload: {
        sessionId: session.id,
        candidates: [
          { platform: "zhihu", kind: "answer", text: "第一条作者回答内容", sourceId: "a1" },
          { platform: "zhihu", kind: "answer", text: "第一条作者回答内容", sourceId: "a1" },
          { platform: "zhihu", kind: "answer", text: "第二条作者回答内容", sourceId: "a2" },
          { platform: "zhihu", kind: "answer", text: "第三条作者回答内容", sourceId: "a3" },
        ],
      },
    });

    expect(first).toEqual({ added: 2, skipped: 2, basket_count: 2, limit_reached: true });

    const second = await handleExtensionMessage({
      type: "collection:addCandidates",
      payload: {
        sessionId: session.id,
        candidates: [
          { platform: "zhihu", kind: "answer", text: "第二条作者回答内容", sourceId: "a2" },
          { platform: "zhihu", kind: "answer", text: "第四条作者回答内容", sourceId: "a4" },
        ],
      },
    });

    expect(second).toEqual({ added: 0, skipped: 2, basket_count: 2, limit_reached: true });

    const basket = await handleExtensionMessage({
      type: "collection:listBasket",
      payload: { sessionId: session.id },
    });
    expect(basket.map((item) => item.sourceId)).toEqual(["a1", "a2"]);
  });

  it("normalizes sparse Skill details for read without requiring user Skill writeback", () => {
    const normalized = normalizeSkillDetailForRead({
      id: "user-old-skill",
      name: "Old User Skill",
      goal: "keep user data read-only",
      summary: "Imported before detail fields existed.",
      compile_status: "compiled",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    } as never);

    expect(normalized).toEqual(expect.objectContaining({
      id: "user-old-skill",
      name: "Old User Skill",
      skill_md: "",
      sample_outputs: [],
      files: {},
      manifest: {},
    }));
  });

  it("repairs sparse built-in Skill details from packaged definitions on read", () => {
    const normalized = normalizeSkillDetailForRead({
      id: "full_fire",
      name: "Full Fire",
      goal: "",
      summary: "",
      compile_status: "builtin",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    } as never);

    expect(normalized.name).toBe("焚锋");
    expect(normalized.skill_md).toContain("焚锋");
    expect(normalized.sample_outputs.length).toBeGreaterThan(0);
    expect(normalized.files?.["SKILL.md"]).toContain("焚锋");
    expect(normalized.manifest?.builtin).toBe(true);
  });

  it("rejects generation without a configured model instead of returning deterministic fallback candidates", async () => {
    await expect(handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "你这就是杠" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [] },
      },
    })).rejects.toThrow("generation_model_required");
  });

  it("rejects short custom generation without a configured model instead of returning deterministic fallback candidates", async () => {
    await expect(handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "这个特别长的目标评论不能被原样塞进短回复里" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "短促反击",
        settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 12, ammoBoxIds: [] },
      },
    })).rejects.toThrow("generation_model_required");
  });

  it("rejects long custom generation without a configured model instead of padding deterministic fallback candidates", async () => {
    await expect(handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "这个特别长的目标评论不能被原样塞进回复里，但仍然需要围绕论证漏洞和证据缺口回应" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "指出前提和证据缺口",
        settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 100, ammoBoxIds: [] },
      },
    })).rejects.toThrow("generation_model_required");
  });

  it("sends custom target length constraints to daily generation model prompts", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-custom-length",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async () => openAiStreamText(candidateJson([
      "证据不够充分，先补上再说",
      "先把前提摆出来，再谈结论",
      "别急着下定论，证据链还没完",
    ])));
    vi.stubGlobal("fetch", fetchMock);

    await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "你就是不懂装懂" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "短促反击",
        settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 16, ammoBoxIds: [] },
      },
    });

    const requestCalls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    const requestBody = JSON.parse(String(requestCalls[0][1].body));
    const prompt = requestBody.messages.map((message: { content: string }) => message.content).join("\n");
    expect(prompt).toContain("目标 16 个汉字");
    expect(prompt).toContain("标点、空格、引号不计入字数");
  });

  it("states custom target length as a per-candidate target for long daily generation", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-custom-length-hard-rule",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async () => openAiStreamText(candidateJson([
      "甲".repeat(100),
      "乙".repeat(100),
      "丙".repeat(100),
    ])));
    vi.stubGlobal("fetch", fetchMock);

    await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "检测长目标字数" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "围绕目标文本反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 100, ammoBoxIds: [] },
      },
    });

    const requestCalls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    const requestBody = JSON.parse(String(requestCalls[0][1].body));
    const prompt = requestBody.messages.map((message: { content: string }) => message.content).join("\n");
    expect(prompt).toContain("目标字数");
    expect(prompt).toContain("输出 3 条候选");
    expect(prompt).not.toContain("输出 4 条候选");
    expect(prompt).toContain("每条候选");
    expect(prompt).toContain("以 100 个汉字为目标");
    expect(prompt).toContain("标点、空格、引号不计入字数");
    expect(prompt).toContain("不是 3 条合计");
    expect(prompt).toContain("直接输出最终候选");
    expect(prompt).toContain("不要先写超长草稿");
    expect(prompt).toContain("不要解释推理过程");
    expect(prompt).not.toContain("内部起草目标");
    expect(prompt).not.toContain("160-180");
    expect(prompt).not.toContain("70 字左右一律失败");
  });

  it("uses the Skill activation agent pipeline for OpenCode DeepSeek long custom generation", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-generation-opencode-agent",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const activationPlan = {
      skillIdentity: ["焚锋", "直接拆逻辑"],
      targetReading: "目标把复杂问题简化成身体状态。",
      attackDirection: "抓住偷换概念，拆掉作息解释一切。",
      sharedConstraints: ["用户意图最高", "不要空骂", "完整表达优先"],
      forbiddenPatterns: ["不要复读目标评论"],
      angles: [
        { id: "a1", focus: "偷换概念", howToApply: "指出对方用身体状态替换长期操控。", styleNote: "直接压住偷换" },
        { id: "a2", focus: "责任转移", howToApply: "指出这种说法替关系伤害卸责。", styleNote: "嘲讽收尾" },
        { id: "a3", focus: "因果链条", howToApply: "讲清控制、索取、崩溃之间的顺序。", styleNote: "短句推进" },
      ],
      lengthStrategy: "目标 100 个汉字，完整表达优先，标点不计入字数",
    };
    const executeOutputs = [
      "把复杂关系伤害说成吃饭睡觉，就是把长期控制、索取、否定和经济压榨全擦掉。身体疲惫可以靠休息缓过来，但反复被掏空、被羞辱、被迫承担后果，不会因为多睡一觉就自动消失。别拿作息给真实伤害洗地，也别装轻巧。",
      "把问题归成没吃没睡，看似关心身体，实际是在替施压者卸责。真正压垮人的不是少睡一晚，而是一次次被索取、被否定、被控制，还要被一句生活习惯轻飘飘带过。这样解释不了伤害，只能掩护责任，把焦点从施压者身上挪开。",
      "如果吃饭睡觉能解决一切，那情感勒索和金钱压榨都能改名叫作息紊乱。荒唐就在这里：有人把系统性的关系剥削降维成身体疲惫，好让真正该承担责任的人从讨论里消失，再装成理性建议，顺手把伤害说轻，还挺会甩锅。",
    ];
    let outputIndex = 0;
    const fetchMock = vi.fn(async () => {
      const index = outputIndex++;
      if (index === 0) return openAiStreamText(JSON.stringify(activationPlan));
      return openAiStreamText(executeOutputs[index - 1]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "检测 OpenCode 长目标" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "抓住偷换概念，反驳把复杂问题简化成身体状态",
        settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 100, ammoBoxIds: [] },
      },
    });

    expect(response.candidates).toHaveLength(3);
    expect(response.candidates).toEqual(executeOutputs);
    expect(response.candidates.every((candidate) => countEffectiveChars(candidate) >= 75 && countEffectiveChars(candidate) <= 150)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const bodies = (fetchMock.mock.calls as unknown as Array<[string, { body: string }]>)
      .map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies.every((body) => body.model === "deepseek-v4-flash")).toBe(true);
    expect(bodies[0].max_tokens).toBe(2400);
    expect(bodies.slice(1).every((body) => body.max_tokens === 1536)).toBe(true);
    expect(bodies.every((body) => body.stream === true)).toBe(true);
    expect(bodies.every((body) => body.response_format === undefined)).toBe(true);
    expect(bodies.every((body) => body.thinking?.type === "disabled")).toBe(true);
    expect(bodies.every((body) => body.chat_template_kwargs === undefined)).toBe(true);
    expect(bodies.every((body) => body.reasoning_effort === undefined)).toBe(true);
    const firstPrompt = bodies[0].messages.map((message: { content: string }) => message.content).join("\n");
    expect(firstPrompt).toContain("任务: 阅读完整 Skill");
    expect(firstPrompt).toContain("Direct personal attacks stacked with Chinese fighting slang");
    expect(firstPrompt).toContain("抓住偷换概念，反驳把复杂问题简化成身体状态");
    expect(firstPrompt).not.toContain("弹药");
    const executePrompt = bodies[1].messages.map((message: { content: string }) => message.content).join("\n");
    expect(executePrompt).toContain("只输出一条中文评论正文");
    expect(executePrompt).toContain("完整表达优先");
    expect(executePrompt).not.toContain("Direct personal attacks stacked with Chinese fighting slang");
    expect(executePrompt).not.toContain("style_profile.json");
    expect(firstPrompt).not.toContain("/no_think");
  });

  it("throws when OpenCode DeepSeek activation and repair return reasoning-only length output", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-generation-opencode-agent-plan-truncated",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async () => openAiStreamText("", {
      finishReason: "length",
      reasoningContent: "模型一直在推理，没有给最终可见候选。",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "检测 OpenCode reasoning-only 后补位" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "wenyan_attack", lengthMode: "自定义", customLengthTarget: 100, ammoBoxIds: [] },
      },
    })).rejects.toThrow("generation_failed:plan_invalid");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = (fetchMock.mock.calls as unknown as Array<[string, { body: string }]>)
      .map(([, init]) => JSON.parse(String(init.body)));
    const prompts = bodies.map((body) => body.messages.map((message: { content: string }) => message.content).join("\n"));
    expect(prompts[0]).toContain("任务: 阅读完整 Skill");
    expect(prompts[1]).toContain("修复上一轮 Skill Activation Plan");
    expect(bodies.every((body) => body.response_format === undefined)).toBe(true);
    expect(bodies.every((body) => body.thinking?.type === "disabled")).toBe(true);
    expect(bodies.every((body) => body.chat_template_kwargs === undefined)).toBe(true);
    expect(bodies.every((body) => body.reasoning_effort === undefined)).toBe(true);
  });

  it("repairs model candidates that are far shorter than a custom target length", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-target-length",
        is_default: true,
      },
    });
    const repaired = [
      "先别急着甩出结论，你先把前提补完整——证据链是怎么衔接的，推理在哪一步跳了，这些都摆出来再说服人。",
      "问题不是对方态度够不够硬，而是中间缺了关键推导步骤，一个前提跳到另一个结论中间到底省略了什么根本没人知道。",
      "扣帽子太容易了，但把定义说清楚、把证据排出来、推理顺序交代明白，才轮得到别人判断你对还是错，这就是最基础的论证规则。",
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(openAiStreamText(candidateJson(["证据呢", "补前提", "别跳步"])))
      .mockResolvedValueOnce({
        ...openAiStreamText(candidateJson(repaired)),
      });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "你就是不懂装懂" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "短促反击",
        settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 50, ammoBoxIds: [] },
      },
    });

    expect(response.candidates).toEqual(repaired);
    expect(response.candidates.every((candidate) => [...candidate].length >= 44 && [...candidate].length <= 63)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const repairBody = JSON.parse(String((fetchMock.mock.calls[1][1] as { body: string }).body));
    const repairPrompt = repairBody.messages.map((message: { content: string }) => message.content).join("\n");
    expect(repairPrompt).toContain("目标 50 个汉字");
    expect(repairPrompt).toContain("向目标 50 个汉字靠拢");
    expect(repairPrompt).toContain("候选长度");
    expect(repairPrompt).toContain("要求范围=30-80");
    expect(repairPrompt).toContain("上次不合格候选");
    expect(repairPrompt).toContain("证据呢");
  });

  it("tells long custom repair attempts to meet the final range without over-expanding", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-expand-underlength",
        is_default: true,
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(openAiStreamText(candidateJson([
        "甲".repeat(60),
        "乙".repeat(61),
        "丙".repeat(62),
        "丁".repeat(63),
      ])))
      .mockResolvedValueOnce(openAiStreamText(candidateJson([
        "戊".repeat(92),
        "己".repeat(90),
        "庚".repeat(88),
        "辛".repeat(86),
      ])));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "检测长目标修复扩写" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "克制反驳",
        settings: { activeSkillId: "restrained_breakdown", lengthMode: "自定义", customLengthTarget: 100, ammoBoxIds: [] },
      },
    });

    expect(response.candidates.map((candidate) => countEffectiveChars(candidate))).toEqual([92, 90, 88]);
    const repairBody = JSON.parse(String((fetchMock.mock.calls[1][1] as { body: string }).body));
    const repairPrompt = repairBody.messages.map((message: { content: string }) => message.content).join("\n");
    expect(repairPrompt).toContain("上次候选只有 60-63 字");
    expect(repairPrompt).toContain("接近目标 100 个汉字");
    expect(repairPrompt).toContain("补一个具体点或因果解释");
    expect(repairPrompt).not.toContain("每条至少再补 80 个汉字");
    expect(repairPrompt).not.toContain("按 160-180 字写");
    expect(repairPrompt).not.toContain("Selected Sample:");
    expect(repairPrompt).not.toContain("style_profile.json");
  });

  it("includes a short token budget and free-text 4-candidate requirement in generation request body", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-regression",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async () => openAiStreamText(candidateJson([
      "先把证据补齐再说话。",
      "前提没立住就别下结论。",
      "这是逻辑问题不是态度问题。",
    ])));
    vi.stubGlobal("fetch", fetchMock);

    await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "检测请求体" },
        context: { pageTitle: "测试", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [] },
      },
    });

    const requestCalls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    const body = JSON.parse(String(requestCalls[0][1].body));
    expect(body.max_tokens).toBe(512);
    expect(body.stream).toBe(true);
    expect(body.response_format).toBeUndefined();
    const prompt = body.messages.map((message: { content: string }) => message.content).join("\n");
    expect(prompt).toContain("输出 4 条候选");
    expect(prompt).toContain("每条候选独立一行");
    expect(prompt).toContain("以 1.、2.、3.、4. 开头");
    expect(prompt).toContain("意图是攻击态度和方向");
    expect(prompt).not.toContain("/no_think");
    expect(prompt).toContain("系统只采纳前 3 条合格候选");
  });

  it("parses free-text plain, numbered, and bullet candidate lines", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-free-text",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async () => openAiStreamText([
      "1. 先把证据链补齐，再谈态度。",
      "- 前提还没站住，结论就别急着飞。",
      "• 这不是观点尖锐，是推理中间断了一截。",
      "第四条留给系统备用，不会先展示。",
    ].join("\n")));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "检测自由文本解析" },
        context: { pageTitle: "测试", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "展开", ammoBoxIds: [] },
      },
    });

    expect(response.candidates).toEqual([
      "先把证据链补齐，再谈态度。",
      "前提还没站住，结论就别急着飞。",
      "这不是观点尖锐，是推理中间断了一截。",
    ]);
    const requestCalls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    const requestBody = JSON.parse(String(requestCalls[0][1].body));
    expect(requestBody.response_format).toBeUndefined();
  });

  it("parses numbered candidates when the model puts them on one line", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-inline-numbered",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async () => openAiStreamText(
      "1. 先把证据链补齐，再谈态度。 2. 前提还没站住，结论就别急着飞。 3. 这不是观点尖锐，是推理中间断了一截。 4. 第四条留给系统备用，不会先展示。",
    ));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "检测同一行编号解析" },
        context: { pageTitle: "测试", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "展开", ammoBoxIds: [] },
      },
    });

    expect(response.candidates).toEqual([
      "先把证据链补齐，再谈态度。",
      "前提还没站住，结论就别急着飞。",
      "这不是观点尖锐，是推理中间断了一截。",
    ]);
  });

  it("accepts slightly over-target complete custom-length model candidates without truncation", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-custom-overlong",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async () => openAiStreamText(candidateJson([
      "甲".repeat(113),
      "乙".repeat(115),
      "丙".repeat(108),
    ])));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "检测只裁剪模型原文" },
        context: { pageTitle: "测试", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 100, ammoBoxIds: [] },
      },
    });

    expect(response.candidates.map((candidate) => [...candidate].length)).toEqual([113, 115, 108]);
    expect(response.candidates[0]).toBe("甲".repeat(113));
    expect(response.candidates[1]).toBe("乙".repeat(115));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries generation when the first streaming response has reasoning but empty final content", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-empty-content-retry",
        is_default: true,
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(openAiStreamText("", { reasoningContent: "我还在分析，没有给最终答案。" }))
      .mockResolvedValueOnce(openAiStreamText(candidateJson([
        "先把证据补齐再说话。",
        "前提没立住就别下结论。",
        "这是逻辑问题不是态度问题。",
      ])));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "检测空内容重试" },
        context: { pageTitle: "测试", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [] },
      },
    });

    expect(response.candidates).toEqual([
      "先把证据补齐再说话。",
      "前提没立住就别下结论。",
      "这是逻辑问题不是态度问题。",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws instead of falling back locally when reasoning-only output is truncated", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-reasoning-length",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async () => openAiStreamText("", {
      finishReason: "length",
      reasoningContent: "模型一直在推理，没有给最终可见候选。",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "检测 reasoning-only 截断" },
        context: { pageTitle: "测试", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 100, ammoBoxIds: [] },
      },
    })).rejects.toThrow("generation_failed:output_truncated");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws instead of falling back locally when the single repair attempt is reasoning-truncated", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-repair-reasoning-length",
        is_default: true,
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(openAiStreamText(candidateJson(["太短"])))
      .mockResolvedValueOnce(openAiStreamText("", {
        finishReason: "length",
        reasoningContent: "修复阶段仍然只输出推理，没有给最终候选。",
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "检测 repair reasoning-only 截断" },
        context: { pageTitle: "测试", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 100, ammoBoxIds: [] },
      },
    })).rejects.toThrow("generation_failed:output_truncated");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries generation when the first request times out", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-timeout-retry",
        is_default: true,
      },
    });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("model_request_timeout"))
      .mockResolvedValueOnce(openAiStreamText(candidateJson([
        "先把证据补齐再说话。",
        "前提没立住就别下结论。",
        "这是逻辑问题不是态度问题。",
      ])));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "检测超时重试" },
        context: { pageTitle: "测试", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [] },
      },
    });

    expect(response.candidates).toEqual([
      "先把证据补齐再说话。",
      "前提没立住就别下结论。",
      "这是逻辑问题不是态度问题。",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses an expanded token budget for custom long generation requests", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-long-budget",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async () => openAiStreamText(candidateJson([
      "甲".repeat(80),
      "乙".repeat(80),
      "丙".repeat(80),
    ])));
    vi.stubGlobal("fetch", fetchMock);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "检测长文本请求体" },
        context: { pageTitle: "测试", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 80, ammoBoxIds: [] },
      },
    });

    const requestCalls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    const body = JSON.parse(String(requestCalls[0][1].body));
    expect(body.max_tokens).toBe(1024);
    expect(body.stream).toBe(true);
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 180000);
    timeoutSpy.mockRestore();
  });

  it("caps ultra-long custom generation requests at the largest dynamic budget", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-ultra-budget",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async () => openAiStreamText(candidateJson([
      "甲".repeat(150),
      "乙".repeat(150),
      "丙".repeat(150),
    ])));
    vi.stubGlobal("fetch", fetchMock);

    await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "检测超长文本请求体" },
        context: { pageTitle: "测试", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 150, ammoBoxIds: [] },
      },
    });

    const requestCalls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    const body = JSON.parse(String(requestCalls[0][1].body));
    expect(body.max_tokens).toBe(1536);
  });

  it("generation throws visible error when model is configured but request fails", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-error-bubble",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "internal server error" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      handleExtensionMessage({
        type: "generation:generateCandidates",
        payload: {
          platform: "zhihu",
          target: { id: "t1", text: "测试错误冒泡" },
          context: { pageTitle: "测试", nearbyComments: [] },
          intent: "反驳",
          settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [] },
        },
      }),
    ).rejects.toThrow("model_request_failed");
  });

  it("repair prompt shows meaningful message when no candidates passed first attempt", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-repair-empty-candidates",
        is_default: true,
      },
    });
    const repaired = [
      "先补证据，再谈结论。",
      "前提没立住，别急着判。",
      "逻辑链断了，先补上。",
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(openAiStreamText(candidateJson(["测试空候选文案", "测试空候选文案", "测试空候选文案"])))
      .mockResolvedValueOnce({
        ...openAiStreamText(candidateJson(repaired)),
      });
    vi.stubGlobal("fetch", fetchMock);

    await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "测试空候选文案" },
        context: { pageTitle: "测试", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [] },
      },
    });

    const repairBody = JSON.parse(String((fetchMock.mock.calls[1][1] as { body: string }).body));
    const repairPrompt = repairBody.messages.map((message: { content: string }) => message.content).join("\n");
    expect(repairPrompt).toContain("首次生成全部不满足要求");
  });

  it("throws a visible insufficient-candidates error after one repair attempt", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-insufficient-fallback",
        is_default: true,
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(openAiStreamText(candidateJson(["先补证据"])))
      .mockResolvedValueOnce({
        ...openAiStreamText(candidateJson(["这条候选故意写得很长很长很长超过短句限制", "这条候选也故意写得很长很长很长超过短句限制"])),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "你就是不懂装懂" },
        context: { pageTitle: "测试", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [] },
      },
    })).rejects.toThrow("generation_failed:insufficient_candidates");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws instead of returning a Skill tryout fallback when no model reply is available", async () => {
    const saved = await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-tryout-fallback",
        is_default: true,
      },
    });
    const box = await handleExtensionMessage({
      type: "corpus:createBox",
      payload: { name: "短打素材", description: "", platform: "zhihu" },
    });
    await handleExtensionMessage({
      type: "corpus:addEntries",
      payload: {
        boxId: box.id,
        entries: [
          { source: "zhihu", content: "短促反击时先抓对方论证漏洞。" },
          { source: "zhihu", content: "不要复读原句，直接压结论。" },
          { source: "zhihu", content: "控制字数，把证据和前提放前面。" },
        ],
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(generatedSkillPayload("短打 Skill", "短促反击，不复读对方。")) } }] }),
    })));
    const draft = await handleExtensionMessage({
      type: "skills:createDraft",
      payload: { source_box_ids: [box.id], skill_name: "短打 Skill", skill_goal: "短促反击" },
    });
    await handleExtensionMessage({ type: "models:delete", payload: { id: saved.id } });

    await expect(handleExtensionMessage({
      type: "skills:runTryout",
      payload: {
        draftId: draft.id,
        user_utterance: "这个特别长的输入不能让降级回复超出自定义长度",
        round_index: 1,
        lengthMode: "自定义",
        customLengthTarget: 8,
      },
    })).rejects.toThrow("skill_creator_model_required");
  });

  it("sends Skill, ammo, source context, target, intent, and length to the model provider", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-context",
        is_default: true,
      },
    });
    const ammoBox = await handleExtensionMessage({
      type: "ammo:createBox",
      payload: { name: "逻辑弹药", category: "knowledge", description: "常用反驳依据" },
    });
    await handleExtensionMessage({
      type: "ammo:addEntry",
      payload: {
        boxId: ammoBox.id,
        term: "偷换概念",
        description: "把A问题悄悄换成B问题再下结论。",
      },
    });
    const fetchMock = vi.fn(async () => openAiStreamText(candidateJson(["候选一", "候选二", "候选三"])));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "你就是不懂装懂" },
        context: {
          pageTitle: "如何讨论公共议题",
          sourceTitle: "公共讨论需要证据",
          sourceText: "原文强调讨论公共议题时要先给证据，再给判断。",
          nearbyComments: ["你这个前提不成立"],
        },
        intent: "克制反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "20字以内", ammoBoxIds: [ammoBox.id] },
      },
    });

    expect(response.candidates).toEqual(["候选一", "候选二", "候选三"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, { body?: unknown }];
    const requestBody = JSON.parse(String(requestInit.body));
    const prompt = requestBody.messages.map((message: { content: string }) => message.content).join("\n");
    expect(prompt).toContain("焚锋");
    expect(prompt).toContain("Direct personal attacks stacked with Chinese fighting slang");
    expect(prompt).toContain("偷换概念");
    expect(prompt).toContain("把A问题悄悄换成B问题再下结论。");
    expect(prompt).toContain("公共讨论需要证据");
    expect(prompt).toContain("原文强调讨论公共议题时要先给证据，再给判断。");
    expect(prompt).toContain("你就是不懂装懂");
    expect(prompt).toContain("克制反驳");
    expect(prompt).toContain("20字以内");
  });

  it("guards only overlong generation prompts while preserving Skill guidance", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenAI",
        model_name: "gpt-test",
        base_url: "https://api.openai.com/v1",
        api_key: "sk-generation-overlong-prompt",
        is_default: true,
      },
    });
    const ammoBox = await handleExtensionMessage({
      type: "ammo:createBox",
      payload: { name: "超长弹药", category: "knowledge", description: "压测 prompt" },
    });
    for (let index = 0; index < 20; index += 1) {
      await handleExtensionMessage({
        type: "ammo:addEntry",
        payload: {
          boxId: ammoBox.id,
          term: `弹药${index}`,
          description: index === 19 ? "AMMO_TAIL_MARKER".repeat(80) : "冗长弹药描述".repeat(80),
        },
      });
    }
    const fetchMock = vi.fn(async () => openAiStreamText(candidateJson(["候选一", "候选二", "候选三"])));
    vi.stubGlobal("fetch", fetchMock);

    await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "你就是不懂装懂" },
        context: {
          pageTitle: "如何讨论公共议题",
          sourceTitle: "公共讨论需要证据",
          sourceText: "SOURCE_TAIL_MARKER".repeat(300),
          nearbyComments: [
            ...Array.from({ length: 45 }, () => "附近评论特别长".repeat(60)),
            "NEARBY_TAIL_MARKER".repeat(80),
          ],
        },
        intent: "克制反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "展开", ammoBoxIds: [ammoBox.id] },
      },
    });

    const requestCalls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>;
    const requestBody = JSON.parse(String(requestCalls[0][1].body));
    const prompt = requestBody.messages.map((message: { content: string }) => message.content).join("\n");
    expect([...prompt].length).toBeLessThanOrEqual(12000);
    expect(prompt).toContain("焚锋");
    expect(prompt).toContain("Direct personal attacks stacked with Chinese fighting slang");
    expect(prompt).not.toContain("NEARBY_TAIL_MARKER");
    expect(prompt).not.toContain("AMMO_TAIL_MARKER");
  });

  it("generates candidates through Anthropic-compatible messages providers", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "qwen3.7-plus",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-generation-messages",
        api_protocol: "anthropic_messages",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: candidateJson(["候选一", "候选二", "候选三"]) }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "你这个前提不成立" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "克制反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [] },
      },
    });

    expect(response.candidates).toEqual(["候选一", "候选二", "候选三"]);
    const [url, requestInit] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(requestInit.headers["x-api-key"]).toBe("sk-generation-messages");
    const requestBody = JSON.parse(requestInit.body);
    expect(requestBody.system).toContain("中文评论区回复候选生成器");
    expect(requestBody.messages[0].content).toContain("你这个前提不成立");
  });

  it("falls back to OpenCode messages when generation chat completions are unavailable", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-generation-opencode-fallback",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/chat/completions")) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: "not found" } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: "text", text: candidateJson(["候选一", "候选二", "候选三"]) }],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "你这个前提不成立" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "克制反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [] },
      },
    });

    expect(response.candidates).toEqual(["候选一", "候选二", "候选三"]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://opencode.ai/zen/go/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://opencode.ai/zen/go/v1/messages",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("repairs repeated or over-length model candidates using explicit length constraints", async () => {
    await handleExtensionMessage({
      type: "models:save",
      payload: {
        provider: "OpenCode Go",
        model_name: "deepseek-v4-flash",
        base_url: "https://opencode.ai/zen/go/v1",
        api_key: "sk-generation-opencode",
        api_protocol: "openai_chat",
        is_default: true,
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ...openAiStreamText(candidateJson(["你就是不懂装懂", "这句话特别特别特别长超过限制"])),
      })
      .mockResolvedValueOnce({
        ...openAiStreamText(candidateJson(["证据呢", "先补前提", "别跳结论"])),
      });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "你就是不懂装懂" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "短促反击",
        settings: { activeSkillId: "full_fire", lengthMode: "10字以内", ammoBoxIds: [] },
      },
    });

    expect(response.candidates).toEqual(["证据呢", "先补前提", "别跳结论"]);
    expect(response.candidates.every((candidate) => [...candidate].length <= 10)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0][1] as { body: string }).body));
    const firstPrompt = firstBody.messages.map((message: { content: string }) => message.content).join("\n");
    expect(firstPrompt).toContain("不超过 10 个汉字");
    expect(firstPrompt).toContain("不要复读目标评论");
  });
});
