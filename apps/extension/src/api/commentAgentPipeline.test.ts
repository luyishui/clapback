import { describe, expect, it, vi } from "vitest";
import type { GenerateRequest } from "../content/types";
import type { ModelConfig } from "../workbench/runtimeApi";
import { resolveLengthConstraint } from "./lengthConstraints";
import { parseCandidateOutput, parseSkillActivationPlan } from "./commentAgentParsing";
import { buildExecutePrompt, buildSkillActivationPrompt } from "./commentAgentPrompts";
import { generateCandidatesWithCommentAgentPipeline } from "./commentAgentPipeline";
import type { SkillActivationPlan } from "./commentAgentTypes";
import type { ModelCompletion } from "./modelConnection";

const model: ModelConfig = {
  id: 1,
  provider: "OpenCode Go",
  model_name: "deepseek-v4-flash",
  base_url: "https://opencode.ai/zen/go/v1",
  api_key_masked: "sk-****",
  api_protocol: "openai_chat",
  is_default: true,
};

const request: GenerateRequest = {
  platform: "zhihu",
  target: { id: "t1", text: "把复杂关系伤害说成吃饭睡觉就好。" },
  context: {
    pageTitle: "知乎问题",
    sourceTitle: "回答标题",
    sourceText: "问题回答摘录",
    nearbyComments: ["附近评论一"],
  },
  intent: "反驳这种简化",
  settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 100, ammoBoxIds: [] },
};

const plan: SkillActivationPlan = {
  skillIdentity: ["冷讥", "假赞同后反转"],
  targetReading: "目标把长期关系伤害降维成吃饭睡觉。",
  attackDirection: "拆掉作息解释一切的偷换。",
  sharedConstraints: ["用户意图最高", "不要复读目标评论", "完整表达优先"],
  forbiddenPatterns: ["空骂", "只写短梗"],
  angles: [
    { id: "a1", focus: "偷换概念", howToApply: "指出对方把关系伤害降维成作息问题。", styleNote: "先假赞同再反转" },
    { id: "a2", focus: "责任转移", howToApply: "指出对方替关系里的伤害卸责。", styleNote: "冷静推进后收刀" },
    { id: "a3", focus: "因果链条", howToApply: "说清操控、索取到崩溃的顺序。", styleNote: "短句推进" },
  ],
  lengthStrategy: "目标 100 个汉字，完整表达优先，最多 125 个汉字",
};

describe("comment agent pipeline parsing and prompts", () => {
  it("parses activation JSON from plain text and fenced output", () => {
    const parsed = parseSkillActivationPlan("```json\n{\"skillIdentity\":[\"冷讥\"],\"targetReading\":\"偷换\",\"attackDirection\":\"拆偷换\",\"sharedConstraints\":[\"反话\"],\"forbiddenPatterns\":[\"空骂\"],\"angles\":[{\"id\":\"a1\",\"focus\":\"偷换概念\",\"howToApply\":\"指出对方把关系伤害降维\",\"styleNote\":\"先假赞同再反转\"},{\"id\":\"a2\",\"focus\":\"责任转移\",\"howToApply\":\"指出对方替伤害卸责\",\"styleNote\":\"用冷讥收尾\"},{\"id\":\"a3\",\"focus\":\"因果链条\",\"howToApply\":\"说清操控到崩溃\",\"styleNote\":\"短句推进\"}],\"lengthStrategy\":\"100字完整表达\"}\n```");

    expect(parsed.ok).toBe(true);
  });

  it("normalizes string activation fields from model JSON", () => {
    const parsed = parseSkillActivationPlan(JSON.stringify({
      skillIdentity: "焚锋",
      targetReading: "把复杂伤害说成作息问题",
      attackDirection: "拆掉降维偷换",
      sharedConstraints: "直接、具体；不要空骂",
      forbiddenPatterns: "复读目标",
      angles: [
        { id: "a1", focus: "偷换概念", howToApply: "指出降维", styleNote: "短句" },
        { id: "a2", focus: "责任转移", howToApply: "指出卸责", style: "反问" },
        { id: "a3", focus: "因果链", how: "说清操控到崩溃", style_note: "收束" },
      ],
      lengthStrategy: "目标 100 字",
    }));

    expect(parsed).toEqual(expect.objectContaining({ ok: true }));
    if (parsed.ok) {
      expect(parsed.plan.skillIdentity).toEqual(["焚锋"]);
      expect(parsed.plan.sharedConstraints.length).toBeGreaterThanOrEqual(1);
      expect(parsed.plan.angles).toHaveLength(3);
    }
  });

  it("parses free-text, numbered, and legacy JSON candidate outputs", () => {
    expect(parseCandidateOutput("1. 第一条\n2. 第二条\n3. 第三条")).toEqual({
      ok: true,
      candidates: ["第一条", "第二条", "第三条"],
    });
    expect(parseCandidateOutput(JSON.stringify({ candidates: ["甲", "乙"] }))).toEqual({
      ok: true,
      candidates: ["甲", "乙"],
    });
    expect(parseCandidateOutput("单条自由文本")).toEqual({ ok: true, candidates: ["单条自由文本"] });
  });

  it("builds activation prompt from full skill and current target", () => {
    const prompt = buildSkillActivationPrompt({
      platform: "zhihu",
      targetText: "把复杂关系伤害说成吃饭睡觉就好。",
      intent: "反驳这种简化",
      lengthLabel: "目标 100 个汉字，完整表达优先，最多 125 个汉字",
      pageTitle: "知乎问题",
      sourceText: "问题回答摘录",
      nearbyComments: [],
      skillName: "焚锋",
      skillGoal: "高攻击性反驳",
      skillSummary: "直接拆逻辑",
      skillText: "完整 Skill Markdown",
      styleProfileText: "{\"rhythm\":\"short\"}",
      attackPlaybookText: "{\"moves\":[\"偷换概念\"]}",
      selectedSampleText: "示例: ...",
      ammoText: "",
    });

    expect(prompt).toContain("完整 Skill Markdown");
    expect(prompt).toContain("把复杂关系伤害说成吃饭睡觉就好");
    expect(prompt).toContain("反驳这种简化");
    expect(prompt).toContain("不要生成评论正文");
    expect(prompt).not.toContain("弹药");
  });

  it("builds execute prompt from activation and one angle without full skill", () => {
    const prompt = buildExecutePrompt({
      platform: "zhihu",
      targetText: request.target.text,
      intent: request.intent,
      pageTitle: request.context.pageTitle,
      sourceText: request.context.sourceText ?? "",
      nearbyComments: [],
      plan,
      angle: plan.angles[0],
      lengthLabel: "目标 100 个汉字，完整表达优先，最多 125 个汉字",
      selectedSampleText: "Selected Sample:\nOutput: 范例",
      existingCandidates: [],
    });

    expect(prompt).toContain("只输出一条中文评论正文");
    expect(prompt).toContain("偷换概念");
    expect(prompt).toContain("完整表达优先");
    expect(prompt).toContain("不要贴着最多值写");
    expect(prompt).not.toContain("完整 Skill Markdown");
    expect(prompt).not.toContain("SKILL.md");
  });
});

describe("comment agent pipeline orchestration", () => {
  function completion(content: string, options: Partial<ModelCompletion> = {}): ModelCompletion {
    return {
      content,
      reasoningContent: options.reasoningContent ?? "",
      finishReason: options.finishReason ?? "stop",
      transport: options.transport ?? "stream",
    };
  }

  function planJson(value: SkillActivationPlan = plan): string {
    return JSON.stringify(value);
  }

  it("activates the skill with disabled thinking before executing", async () => {
    const requestModelCompletion = vi.fn()
      .mockResolvedValueOnce(completion(planJson()))
      .mockResolvedValueOnce(completion("甲".repeat(100)))
      .mockResolvedValueOnce(completion("乙".repeat(100)))
      .mockResolvedValueOnce(completion("丙".repeat(100)));

    const result = await generateCandidatesWithCommentAgentPipeline({
      request,
      promptContext: promptContext(),
      lengthConstraint: resolveLengthConstraint(request.settings),
      model,
      apiKey: "sk-test",
      executeThinkingPolicy: "disabled",
      requestModelCompletion,
    });

    expect(result).toEqual(["甲".repeat(100), "乙".repeat(100), "丙".repeat(100)]);
    expect(requestModelCompletion.mock.calls[0][2]).toEqual(expect.objectContaining({
      maxTokens: 2400,
      temperature: 0.2,
      stream: true,
      thinkingMode: "disabled",
    }));
    expect(requestModelCompletion.mock.calls[0][2].responseFormat).toBeUndefined();
  });

  it("uses complete Skill package files during activation", async () => {
    const context = promptContext();
    context.skill!.files!["style_profile.json"] = `{"rhythm":"short","tail":"${"完整".repeat(500)}"}`;
    context.skill!.files!["attack_playbook.json"] = `{"moves":["偷换概念"],"tail":"${"全量".repeat(500)}"}`;
    context.styleProfileText = "{\"rhythm\":\"short\"}";
    context.attackPlaybookText = "{\"moves\":[\"偷换概念\"]}";
    const requestModelCompletion = vi.fn()
      .mockResolvedValueOnce(completion(planJson()))
      .mockResolvedValueOnce(completion("甲".repeat(100)))
      .mockResolvedValueOnce(completion("乙".repeat(100)))
      .mockResolvedValueOnce(completion("丙".repeat(100)));

    await generateCandidatesWithCommentAgentPipeline({
      request,
      promptContext: context,
      lengthConstraint: resolveLengthConstraint(request.settings),
      model,
      apiKey: "sk-test",
      executeThinkingPolicy: "disabled",
      requestModelCompletion,
    });

    const activationPrompt = requestModelCompletion.mock.calls[0][2].user;
    expect(activationPrompt).toContain("完整".repeat(500));
    expect(activationPrompt).toContain("全量".repeat(500));
  });

  it("repairs invalid activation output once", async () => {
    const requestModelCompletion = vi.fn()
      .mockResolvedValueOnce(completion("不是 JSON"))
      .mockResolvedValueOnce(completion(planJson()))
      .mockResolvedValueOnce(completion("甲".repeat(100)))
      .mockResolvedValueOnce(completion("乙".repeat(100)))
      .mockResolvedValueOnce(completion("丙".repeat(100)));

    await expect(generateCandidatesWithCommentAgentPipeline({
      request,
      promptContext: promptContext(),
      lengthConstraint: resolveLengthConstraint(request.settings),
      model,
      apiKey: "sk-test",
      executeThinkingPolicy: "disabled",
      requestModelCompletion,
    })).resolves.toHaveLength(3);

    expect(requestModelCompletion.mock.calls[1][2].user).toContain("修复");
    expect(requestModelCompletion.mock.calls[1][2].thinkingMode).toBe("disabled");
  });

  it("fills a missing activation length strategy from the current length target", async () => {
    const { lengthStrategy: _lengthStrategy, ...planWithoutLengthStrategy } = plan;
    const requestModelCompletion = vi.fn()
      .mockResolvedValueOnce(completion(JSON.stringify(planWithoutLengthStrategy)))
      .mockResolvedValueOnce(completion("甲".repeat(100)))
      .mockResolvedValueOnce(completion("乙".repeat(100)))
      .mockResolvedValueOnce(completion("丙".repeat(100)));

    const result = await generateCandidatesWithCommentAgentPipeline({
      request,
      promptContext: promptContext(),
      lengthConstraint: resolveLengthConstraint(request.settings),
      model,
      apiKey: "sk-test",
      executeThinkingPolicy: "disabled",
      requestModelCompletion,
    });

    expect(result).toHaveLength(3);
    expect(requestModelCompletion.mock.calls[1][2].user).toContain("目标 100 个汉字");
    expect(requestModelCompletion.mock.calls[1][2].user).toContain("最多 125 个汉字");
  });

  it("throws plan_invalid when activation and repair cannot produce a confirmed plan", async () => {
    const requestModelCompletion = vi.fn()
      .mockResolvedValueOnce(completion("不是 JSON"))
      .mockResolvedValueOnce(completion("还是不是 JSON"));

    await expect(generateCandidatesWithCommentAgentPipeline({
      request,
      promptContext: promptContext(),
      lengthConstraint: resolveLengthConstraint(request.settings),
      model,
      apiKey: "sk-test",
      executeThinkingPolicy: "disabled",
      requestModelCompletion,
    })).rejects.toThrow("generation_failed:plan_invalid");
  });

  it("starts three execute branches in parallel", async () => {
    const deferred = [createDeferred<ModelCompletion>(), createDeferred<ModelCompletion>(), createDeferred<ModelCompletion>()];
    const requestModelCompletion = vi.fn()
      .mockResolvedValueOnce(completion(planJson()))
      .mockImplementationOnce(() => deferred[0].promise)
      .mockImplementationOnce(() => deferred[1].promise)
      .mockImplementationOnce(() => deferred[2].promise);

    const promise = generateCandidatesWithCommentAgentPipeline({
      request,
      promptContext: promptContext(),
      lengthConstraint: resolveLengthConstraint(request.settings),
      model,
      apiKey: "sk-test",
      executeThinkingPolicy: "disabled",
      requestModelCompletion,
    });
    for (let index = 0; index < 10 && requestModelCompletion.mock.calls.length < 4; index += 1) {
      await Promise.resolve();
    }

    expect(requestModelCompletion).toHaveBeenCalledTimes(4);
    deferred[0].resolve(completion("甲".repeat(100)));
    deferred[1].resolve(completion("乙".repeat(100)));
    deferred[2].resolve(completion("丙".repeat(100)));
    await expect(promise).resolves.toHaveLength(3);
  });

  it("passes execute thinking policy to each execute branch", async () => {
    const requestModelCompletion = vi.fn()
      .mockResolvedValueOnce(completion(planJson()))
      .mockResolvedValueOnce(completion("甲".repeat(100)))
      .mockResolvedValueOnce(completion("乙".repeat(100)))
      .mockResolvedValueOnce(completion("丙".repeat(100)));

    await generateCandidatesWithCommentAgentPipeline({
      request,
      promptContext: promptContext(),
      lengthConstraint: resolveLengthConstraint(request.settings),
      model,
      apiKey: "sk-test",
      executeThinkingPolicy: "provider_default",
      requestModelCompletion,
    });

    expect(requestModelCompletion.mock.calls.slice(1, 4).every((call) => call[2].thinkingMode === "provider_default")).toBe(true);
  });

  it("accepts complete 116, 120, and 125 character candidates without refine", async () => {
    const requestModelCompletion = vi.fn()
      .mockResolvedValueOnce(completion(planJson()))
      .mockResolvedValueOnce(completion("甲".repeat(116)))
      .mockResolvedValueOnce(completion("乙".repeat(120)))
      .mockResolvedValueOnce(completion("丙".repeat(125)));

    const result = await generateCandidatesWithCommentAgentPipeline({
      request,
      promptContext: promptContext(),
      lengthConstraint: resolveLengthConstraint(request.settings),
      model,
      apiKey: "sk-test",
      executeThinkingPolicy: "disabled",
      requestModelCompletion,
    });

    expect(result.map((candidate) => [...candidate].length)).toEqual([116, 120, 125]);
    expect(requestModelCompletion).toHaveBeenCalledTimes(4);
  });

  it("refines candidates that are clearly outside the hard range", async () => {
    const requestModelCompletion = vi.fn()
      .mockResolvedValueOnce(completion(planJson()))
      .mockResolvedValueOnce(completion("甲".repeat(150)))
      .mockResolvedValueOnce(completion("乙".repeat(100)))
      .mockResolvedValueOnce(completion("丙".repeat(100)))
      .mockResolvedValueOnce(completion("丁".repeat(110)));

    const result = await generateCandidatesWithCommentAgentPipeline({
      request,
      promptContext: promptContext(),
      lengthConstraint: resolveLengthConstraint(request.settings),
      model,
      apiKey: "sk-test",
      executeThinkingPolicy: "disabled",
      requestModelCompletion,
    });

    expect(result).toEqual(["丁".repeat(110), "乙".repeat(100), "丙".repeat(100)]);
    expect(requestModelCompletion.mock.calls[4][2].user).toContain("压缩");
    expect(requestModelCompletion.mock.calls[4][2].user).toContain("不要超过长度要求里的最多值");
  });

  it("expands candidates below the minimum range", async () => {
    const requestModelCompletion = vi.fn()
      .mockResolvedValueOnce(completion(planJson()))
      .mockResolvedValueOnce(completion("太短"))
      .mockResolvedValueOnce(completion("乙".repeat(100)))
      .mockResolvedValueOnce(completion("丙".repeat(100)))
      .mockResolvedValueOnce(completion("丁".repeat(100)));

    await generateCandidatesWithCommentAgentPipeline({
      request,
      promptContext: promptContext(),
      lengthConstraint: resolveLengthConstraint(request.settings),
      model,
      apiKey: "sk-test",
      executeThinkingPolicy: "disabled",
      requestModelCompletion,
    });

    expect(requestModelCompletion.mock.calls[4][2].user).toContain("扩写");
  });

  it("keeps requesting model fill candidates when rejected branches leave fewer than three", async () => {
    const planWithMoreAngles = {
      ...plan,
      angles: [
        ...plan.angles,
        { id: "a4", focus: "避重就轻", howToApply: "指出对方避开核心关系伤害。", styleNote: "反问收尾" },
        { id: "a5", focus: "轻飘飘归因", howToApply: "指出对方把系统伤害说成生活小事。", styleNote: "冷静收束" },
      ],
    };
    const requestModelCompletion = vi.fn()
      .mockResolvedValueOnce(completion(planJson(planWithMoreAngles)))
      .mockResolvedValueOnce(completion("甲".repeat(100)))
      .mockResolvedValueOnce(completion("乙".repeat(150)))
      .mockResolvedValueOnce(completion("丙".repeat(150)))
      .mockResolvedValueOnce(completion("乙".repeat(130)))
      .mockResolvedValueOnce(completion("丙".repeat(130)))
      .mockResolvedValueOnce(completion("丁".repeat(150)))
      .mockResolvedValueOnce(completion("丁".repeat(130)))
      .mockResolvedValueOnce(completion("戊".repeat(100)))
      .mockResolvedValueOnce(completion("己".repeat(100)));

    const result = await generateCandidatesWithCommentAgentPipeline({
      request,
      promptContext: promptContext(),
      lengthConstraint: resolveLengthConstraint(request.settings),
      model,
      apiKey: "sk-test",
      executeThinkingPolicy: "disabled",
      requestModelCompletion,
    });

    expect(result).toEqual(["甲".repeat(100), "戊".repeat(100), "己".repeat(100)]);
    expect(requestModelCompletion).toHaveBeenCalledTimes(10);
  });

  it("throws after model fill attempts are exhausted and never uses local fallback", async () => {
    const requestModelCompletion = vi.fn()
      .mockResolvedValueOnce(completion(planJson({
        ...plan,
        angles: [
          ...plan.angles,
          { id: "a4", focus: "避重就轻", howToApply: "指出对方避开核心关系伤害。", styleNote: "反问收尾" },
        ],
      })))
      .mockResolvedValueOnce(completion(""))
      .mockResolvedValueOnce(completion("乙".repeat(100), { finishReason: "length" }))
      .mockResolvedValueOnce(completion("丙".repeat(100)))
      .mockResolvedValueOnce(completion("丁".repeat(100)))
      .mockResolvedValueOnce(completion(""))
      .mockResolvedValueOnce(completion("乙".repeat(100), { finishReason: "length" }))
      .mockResolvedValueOnce(completion(""));

    await expect(generateCandidatesWithCommentAgentPipeline({
      request,
      promptContext: promptContext(),
      lengthConstraint: resolveLengthConstraint(request.settings),
      model,
      apiKey: "sk-test",
      executeThinkingPolicy: "disabled",
      requestModelCompletion,
    })).rejects.toThrow("generation_failed:insufficient_candidates");

    expect(requestModelCompletion).toHaveBeenCalledTimes(8);
  });

  it("treats refine request failures as branch failures and fills once", async () => {
    const requestModelCompletion = vi.fn()
      .mockResolvedValueOnce(completion(planJson()))
      .mockResolvedValueOnce(completion("甲".repeat(150)))
      .mockResolvedValueOnce(completion("乙".repeat(100)))
      .mockResolvedValueOnce(completion("丙".repeat(100)))
      .mockRejectedValueOnce(new Error("temporary refine failure"))
      .mockResolvedValueOnce(completion("丁".repeat(100)));

    const result = await generateCandidatesWithCommentAgentPipeline({
      request,
      promptContext: promptContext(),
      lengthConstraint: resolveLengthConstraint(request.settings),
      model,
      apiKey: "sk-test",
      executeThinkingPolicy: "disabled",
      requestModelCompletion,
    });

    expect(result).toEqual(["乙".repeat(100), "丙".repeat(100), "丁".repeat(100)]);
    expect(requestModelCompletion).toHaveBeenCalledTimes(6);
  });
});

function promptContext() {
  return {
    sourceTitle: "回答标题",
    sourceText: "问题回答摘录",
    skill: {
      id: "full_fire",
      name: "焚锋",
      goal: "高攻击性反驳",
      summary: "直接拆逻辑",
      skill_md: "完整 Skill Markdown",
      sample_outputs: [],
      files: {
        "SKILL.md": "完整 Skill Markdown",
        "style_profile.json": "{\"rhythm\":\"short\"}",
        "attack_playbook.json": "{\"moves\":[\"偷换概念\"]}",
      },
    },
    skillText: "完整 Skill Markdown",
    styleProfileText: "{\"rhythm\":\"short\"}",
    attackPlaybookText: "{\"moves\":[\"偷换概念\"]}",
    ammo: [],
    selectedSampleText: "Selected Sample:\nOutput: 范例",
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}
