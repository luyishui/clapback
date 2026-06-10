import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleExtensionMessage } from "./handlers";
import { normalizeSkillDetailForRead, resetExtensionDataForTests } from "./idbStore";

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
      style_profile: { tone: "短促" },
      attack_playbook: fixedAttackPlaybook({ moves: ["补证据"] }),
      sample_outputs: [
        { prompt: "你不懂", reply: "先把证据摆出来。" },
        { prompt: "大家都这么说", reply: "共识不是证据。" },
      ],
    };
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
    const fallback = await handleExtensionMessage({
      type: "generation:generate",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "删除模型后不应串用旧 key" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [] },
      },
    });
    expect(fallback.candidates).toHaveLength(3);
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
      max_tokens: 1,
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
      max_tokens: 1,
    }));
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
          { source: "zhihu", content: "别把情绪包装成证据，先把前提讲清楚。" },
          { source: "zhihu", content: "你这个结论跳得太快，中间缺了三步论证。" },
          { source: "zhihu", content: "先把定义框住，再拆对方偷换概念的地方。" },
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
              style_profile: { tone: "冷静短促", source_box_ids: [box.id] },
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
    const prompt = JSON.stringify(JSON.parse(requestInit.body));
    expect(prompt).toContain("deepseek-v4-flash");
    expect(prompt).toContain("别把情绪包装成证据");
    expect(prompt).toContain("拆解没证据的评论");
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

  it("returns the model failure reason when Skill tryouts fall back", async () => {
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

    const result = await handleExtensionMessage({
      type: "skills:runTryout",
      payload: { draftId: draft.id, user_utterance: "你就是不懂", round_index: 1 },
    });

    expect(result.degraded).toBe(true);
    expect(result).toEqual(expect.objectContaining({
      degraded_reason: expect.stringContaining("skill_creator_model_request_failed_401"),
    }));
    expect(JSON.stringify(result)).not.toContain("sk-secret-value");
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
      json: async () => ({ choices: [{ message: { content: "先把证据摆出来。" } }] }),
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
    expect(prompt).toContain("10 到 26 个汉字");
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
            style_profile: { tone: "短促" },
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
            style_profile: { tone: "更冷更短" },
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
      style_profile: { tone: `短促 ${version}` },
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
            style_profile: { tone: "短促" },
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

  it("generates deterministic fallback candidates without exposing API key to content callers", async () => {
    const response = await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "你这就是杠" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "反驳",
        settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [] },
      },
    });

    expect(response.candidates).toHaveLength(3);
    expect(response.candidates.join("\n")).toContain("你这就是杠");
  });

  it("keeps deterministic fallback candidates within custom target length bounds", async () => {
    const response = await handleExtensionMessage({
      type: "generation:generateCandidates",
      payload: {
        platform: "zhihu",
        target: { id: "t1", text: "这个特别长的目标评论不能被原样塞进短回复里" },
        context: { pageTitle: "讨论", nearbyComments: [] },
        intent: "短促反击",
        settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 12, ammoBoxIds: [] },
      },
    });

    expect(response.candidates).toHaveLength(3);
    expect(response.candidates.every((candidate) => [...candidate].length <= 22)).toBe(true);
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
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "证据呢\n先补前提\n别跳结论" } }] }),
    }));
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
    expect(prompt).toContain("10 到 26 个汉字");
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
      "你先把前提补完整，再谈这个结论是不是站得住，不然只是把情绪包装成判断。",
      "问题不是你态度够不够硬，而是证据链断在中间，结论自然没有说服力。",
      "别急着给别人扣帽子，先把定义、证据和推理顺序摆出来，讨论才有意义。",
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "证据呢\n补前提\n别跳步" } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: repaired.join("\n") } }] }),
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
    expect(response.candidates.every((candidate) => [...candidate].length >= 44 && [...candidate].length <= 60)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const repairBody = JSON.parse(String((fetchMock.mock.calls[1][1] as { body: string }).body));
    const repairPrompt = repairBody.messages.map((message: { content: string }) => message.content).join("\n");
    expect(repairPrompt).toContain("目标 50 个汉字");
    expect(repairPrompt).toContain("44 到 60 个汉字");
  });

  it("keeps Skill tryout fallback replies within custom target length bounds", async () => {
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

    const result = await handleExtensionMessage({
      type: "skills:runTryout",
      payload: {
        draftId: draft.id,
        user_utterance: "这个特别长的输入不能让降级回复超出自定义长度",
        round_index: 1,
        lengthMode: "自定义",
        customLengthTarget: 8,
      },
    });

    expect([...result.reply].length).toBeLessThanOrEqual(8);
    expect(result.degraded).toBe(true);
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
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "候选一\n候选二\n候选三" } }] }),
    }));
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
    expect(prompt).toContain("高压、短促、直接地反击低质量言论。");
    expect(prompt).toContain("偷换概念");
    expect(prompt).toContain("把A问题悄悄换成B问题再下结论。");
    expect(prompt).toContain("公共讨论需要证据");
    expect(prompt).toContain("原文强调讨论公共议题时要先给证据，再给判断。");
    expect(prompt).toContain("你就是不懂装懂");
    expect(prompt).toContain("克制反驳");
    expect(prompt).toContain("20字以内");
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
        content: [{ type: "text", text: "候选一\n候选二\n候选三" }],
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
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "你就是不懂装懂\n这句话特别特别特别长超过限制" } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "证据呢\n先补前提\n别跳结论" } }],
        }),
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
