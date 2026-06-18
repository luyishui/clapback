# 评论生成 Agent Pipeline 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把评论生成从单次 one-shot 改成稳定的 `Skill Activation -> Confirmation -> Parallel Execute -> Refine/Repair` 流水线，确保真实 Zhihu 场景下使用 OpenCode Go `deepseek-v4-flash` 稳定返回 3 条来自模型 `content` 的候选。

**Architecture:** 完整 Skill 仍然是唯一权威来源，每轮生成先用独立请求完整阅读 Skill 并结合目标评论生成本轮攻击计划。最终评论生成阶段只读取本轮 activation 产物和单个角度，3 路并行执行；修复只在缺候选、明显超长、过短或输出异常时触发。默认不做人工确认、不默认读取素材箱、不修改 `GenerateResponse` 契约。

**Tech Stack:** MV3 browser extension, TypeScript, Vite, Vitest, OpenAI-compatible chat completions, OpenCode Go `deepseek-v4-flash`, Edge + Zhihu E2E.

---

## 最高优先级红线

- 不要把“关闭 DeepSeek thinking”当成根因修复。上一轮已经犯过这个方向性错误：专门针对 `deepseek-v4-flash` 关闭思考后，确实可能让 `content` 更容易出来，但这只是避开症状，不是解决 one-shot 压力、上下文污染、硬裁剪和无阶段诊断这些根因。
- 新方案必须通过架构拆分修复：完整 Skill 阅读进入 `Skill Activation`，候选生成进入并行 `Execute`，明显失败进入受控 `Refine/Repair`。
- Thinking 策略只能作为阶段参数和 E2E A/B 变量，不能作为兜底补丁。不要新增“只要 DeepSeek 就强制关 thinking 才算修复”的代码。
- 如果 `provider_default` thinking 在短输入 execute 下能稳定返回内容且质量更好，应按真实 E2E 证据选择它；如果不稳定，也要在报告里说明根因和证据，而不是静默强关。
- 任何失败都必须可诊断：空 content、reasoning-only、`finish_reason=length`、超时、候选不足，都不能被本地模板或硬裁剪伪装成成功。

## 测试凭据说明

- 真实 E2E 使用本机扩展/浏览器里已经配置好的 OpenCode Go key。
- 不要在代码、文档、测试输出、console 截图、E2E JSON 或 commit message 中写入真实 key。
- 不要把真实 key 从浏览器 storage 中复制出来。
- 单元测试只能使用假 key，例如 `sk-opencode-secret`、`sk-test`、`sk-generation-*`。
- 真实测试套餐和模型固定为：OpenCode Go 套餐，模型 `deepseek-v4-flash`。

## 已确认事实

- 用户点击“嘴替”后要直接出结果，不加入人工确认。
- 核心成功标准是稳定生成真实模型内容，而不是本地兜底或假成功。
- 正式评论生成默认不读取素材箱；只有 `ammoBoxIds` 非空时沿用现有少量素材路径。
- Skill 不能被静态摘要替代。每轮生成必须有 `Skill Activation` 阶段完整读取当前 Skill，并结合本轮目标评论、用户意图、长度目标形成“这一次准备怎么打”的任务态计划。
- 页面上下文保持短摘录：目标评论完整保留，用户意图完整保留，页面标题保留，source/nearby 沿用现有限制，不做长文 chunking。
- 100 字目标下，116、120、125 字的完整评论可以接受；禁止把完整句子硬裁剪成半截。
- `finish_reason=length`、空 content、只有 reasoning、超时都不能算成功。
- 真实验收只使用 OpenCode Go `deepseek-v4-flash`。
- 真实验收页面是 `https://www.zhihu.com/question/654798998`。
- 四个 Skill 是 `full_fire`、`restrained_breakdown`、`sarcastic_ironic`、`wenyan_attack`。

## 当前问题定位

当前实现已经能让 OpenCode Go DeepSeek 返回内容，但仍有两个架构问题：

- `apps/extension/src/api/generation.ts:143` 的 compact 路径把“理解 Skill、理解目标、生成候选”压在短 prompt 和固定角度里，仍然不是完整 agent pipeline。
- `apps/extension/src/api/generation.ts:542` 的 `fitModelCandidateToLength` 会调用 `trimToMaxChars`，导致略超长但完整的模型输出被硬切断。

历史 E2E 里 36 条候选有 19 条最终长度正好卡在 110，且 provider 内容比最终候选更长，说明“稳定返回”不等于“稳定生成可用评论”。

## 文件结构

### 修改

- `apps/extension/src/api/modelConnection.ts`
  - 给内部 `ModelTextRequest` 增加可选 `thinkingMode`，不改变 `requestModelCompletion(model, apiKey, request)` 函数签名。
  - OpenCode DeepSeek 的 thinking 行为改成阶段策略：activation/plan 允许 provider 默认 thinking；execute 阶段必须做 `disabled` 和 `provider_default` A/B。不要把强制关闭 thinking 当作最终答案。

- `apps/extension/src/api/lengthConstraints.ts`
  - 调整自定义长度的软硬边界。
  - 移除“略超就硬切”的行为入口，保留通用工具给别处使用。

- `apps/extension/src/api/generation.ts`
  - 保留旧路径作为 baseline 对照的参考实现。
  - 对自定义长度 `>= 80` 且 OpenCode Go DeepSeek 的评论生成切到 agent pipeline。
  - 删除或绕开候选硬裁剪。

- `apps/extension/src/api/handlers.test.ts`
  - 调整旧长度断言，新增 agent pipeline 的端到端单元覆盖。

- `apps/extension/src/api/modelConnection.test.ts`
  - 覆盖 per-stage thinking 控制。

### 创建

- `apps/extension/src/api/commentAgentPipeline.ts`
  - 负责编排 `Skill Activation -> Confirmation -> Execute -> Refine/Repair`。

- `apps/extension/src/api/commentAgentPrompts.ts`
  - 集中生成 activation、repair、execute、refine prompt。

- `apps/extension/src/api/commentAgentTypes.ts`
  - 定义内部 `SkillActivationPlan`、`ExecutionAngle`、`PipelineStageDiagnostics` 等类型。

- `apps/extension/src/api/commentAgentParsing.ts`
  - 宽松解析 activation JSON、候选自由文本、编号、bullet、旧 JSON。

- `apps/extension/src/api/commentAgentPipeline.test.ts`
  - 测试新 pipeline 的编排、并行、失败处理、长度策略和无本地兜底。

## 实施任务

### Task 0: 先跑旧路径基线

**Files:**
- Read: `docs/goal-result-报告.md`
- Output: `.tmp-edge-zhihu-e2e-agent-pipeline/baseline-legacy-YYYY-MM-DD.json`

- [ ] **Step 1: 记录当前 git 状态**

Run:

```powershell
git status --short
```

Expected: 输出 dirty worktree。不要 revert 用户改动。

- [ ] **Step 2: 构建当前扩展**

Run:

```powershell
npm run build:extension
```

Expected: `tsc --noEmit` 和两个 Vite build 通过。

- [ ] **Step 3: 跑旧路径真实基线**

使用真实 Edge，加载 `apps/extension/dist`，打开：

```text
https://www.zhihu.com/question/654798998
```

要求：

- 使用页面里的真实“嘴替”按钮。
- 模型只用 OpenCode Go `deepseek-v4-flash`。
- 用户意图填写同一条，例如：`反驳对方把复杂伤害简化成作息问题`。
- 目标长度 `100`。
- 四个 Skill 各跑 1 次。
- 记录每轮耗时、候选文本、候选长度、provider content length、reasoning length、finish reason、是否出现硬裁剪。

Expected: 生成 baseline JSON。不得打印 API key。

### Task 1: 增加 per-stage thinking 控制

**Files:**
- Modify: `apps/extension/src/api/modelConnection.ts`
- Modify: `apps/extension/src/api/modelConnection.test.ts`

- [ ] **Step 1: 写失败测试**

在 `modelConnection.test.ts` 增加覆盖：

```ts
it("can omit DeepSeek thinking disable for planning stages", async () => {
  await requestModelCompletion(openCodeDeepSeekModel, "sk-opencode-secret", {
    system: "plan",
    user: "read skill and plan",
    maxTokens: 2048,
    temperature: 0.2,
    thinkingMode: "provider_default",
  });

  const body = JSON.parse(fetchMock.calls[0].requestBody);
  expect(body.thinking).toBeUndefined();
});

it("keeps DeepSeek thinking disabled by default for ordinary generation calls", async () => {
  await requestModelCompletion(openCodeDeepSeekModel, "sk-opencode-secret", {
    system: "write",
    user: "one candidate",
    maxTokens: 1024,
    temperature: 0.5,
  });

  const body = JSON.parse(fetchMock.calls[0].requestBody);
  expect(body.thinking).toEqual({ type: "disabled" });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm --workspace @clapback/extension test -- src/api/modelConnection.test.ts
```

Expected: `thinkingMode` 类型不存在或行为不匹配。

- [ ] **Step 3: 实现内部字段**

在 `ModelTextRequest` 增加：

```ts
thinkingMode?: "disabled" | "provider_default";
```

在 `requestOpenAiChat` 中把 thinking 生成改成：

```ts
thinking: shouldDisableDeepSeekThinking(baseUrl, modelName) && request.thinkingMode !== "provider_default"
  ? { type: "disabled" }
  : undefined,
```

`request.thinkingMode === "disabled"` 对普通 provider 不发送未知字段，仍由 allowlist 控制。

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
npm --workspace @clapback/extension test -- src/api/modelConnection.test.ts
```

Expected: 新旧 thinking 测试均通过。

### Task 2: 调整长度策略，禁止略超硬裁剪

**Files:**
- Modify: `apps/extension/src/api/lengthConstraints.ts`
- Modify: `apps/extension/src/api/generation.ts`
- Modify: `apps/extension/src/api/handlers.test.ts`

- [ ] **Step 1: 写失败测试**

新增或修改测试，覆盖 100 字目标接受 125 字以内完整输出：

```ts
it("accepts complete custom-length candidates that are slightly over target", async () => {
  const response = await handleMessage({
    type: "generation:generateCandidates",
    payload: {
      platform: "zhihu",
      target: { id: "t1", text: "把复杂关系伤害说成吃饭睡觉就能好。" },
      context: { pageTitle: "知乎问题", nearbyComments: [] },
      intent: "反驳这种简化",
      settings: { activeSkillId: "full_fire", lengthMode: "自定义", customLengthTarget: 100, ammoBoxIds: [] },
    },
  });

  expect(response.candidates[0].length).toBeGreaterThan(110);
  expect(response.candidates[0].length).toBeLessThanOrEqual(125);
  expect(response.candidates[0]).not.toMatch(/传销$/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm --workspace @clapback/extension test -- src/api/handlers.test.ts
```

Expected: 当前实现会裁剪到旧 `maxChars` 或拒绝略长候选。

- [ ] **Step 3: 修改自定义长度约束**

在 `resolveLengthConstraint` 中，自定义长度 `target > 10` 使用：

```ts
const minChars = Math.max(1, target - 6);
const maxChars = Math.min(CUSTOM_LENGTH_MAX_CHARS, Math.max(target + 10, Math.ceil(target * 1.25)));
```

100 字目标的硬上限变成 125。标签改成：

```ts
label: `目标 ${target} 个汉字，完整表达优先，建议不少于 ${minChars} 个汉字，最多 ${maxChars} 个汉字`
```

- [ ] **Step 4: 移除评论候选硬裁剪**

在 `generation.ts` 中把：

```ts
const text = fitModelCandidateToLength(candidate.trim(), lengthConstraint);
```

改为：

```ts
const text = candidate.trim();
```

并删除或停止使用 `fitModelCandidateToLength`。超过硬上限的候选进入 refine/repair，不直接切断。

- [ ] **Step 5: 更新 prompt 文案**

把 `strictLengthInstruction` 和 `compactLengthRangeInstruction` 中的“略超过上限会由系统裁剪”改成：

```text
完整表达优先；明显超过硬上限会被要求压缩，不会直接截断半句。
```

- [ ] **Step 6: 运行长度相关测试**

Run:

```powershell
npm --workspace @clapback/extension test -- src/api/handlers.test.ts
```

Expected: 100 字略超候选被接受，10 字以内等硬短限制仍然生效。

### Task 3: 创建 Agent Pipeline 类型和解析器

**Files:**
- Create: `apps/extension/src/api/commentAgentTypes.ts`
- Create: `apps/extension/src/api/commentAgentParsing.ts`
- Create: `apps/extension/src/api/commentAgentPipeline.test.ts`

- [ ] **Step 1: 定义内部类型**

创建 `commentAgentTypes.ts`：

```ts
export type ExecutionAngle = {
  id: string;
  focus: string;
  howToApply: string;
  styleNote: string;
};

export type SkillActivationPlan = {
  skillIdentity: string[];
  targetReading: string;
  attackDirection: string;
  sharedConstraints: string[];
  forbiddenPatterns: string[];
  angles: ExecutionAngle[];
  lengthStrategy: string;
};

export type PipelineStageName = "activation" | "activation_repair" | "execute" | "refine" | "补位";

export type PipelineStageDiagnostics = {
  stage: PipelineStageName;
  provider: string;
  model: string;
  promptLength: number;
  maxTokens: number;
  thinkingMode: "disabled" | "provider_default";
  finishReason: string;
  contentLength: number;
  reasoningLength: number;
  accepted: number;
  rejected: number;
};
```

- [ ] **Step 2: 写解析测试**

在 `commentAgentPipeline.test.ts` 覆盖：

```ts
it("parses activation JSON from plain text and fenced output", () => {
  const parsed = parseSkillActivationPlan("```json\n{\"skillIdentity\":[\"冷讥\"],\"targetReading\":\"偷换\",\"attackDirection\":\"拆偷换\",\"sharedConstraints\":[\"反话\"],\"forbiddenPatterns\":[\"空骂\"],\"angles\":[{\"id\":\"a1\",\"focus\":\"偷换概念\",\"howToApply\":\"指出对方把关系伤害降维\",\"styleNote\":\"先假赞同再反转\"},{\"id\":\"a2\",\"focus\":\"责任转移\",\"howToApply\":\"指出对方替伤害卸责\",\"styleNote\":\"用冷讥收尾\"},{\"id\":\"a3\",\"focus\":\"因果链条\",\"howToApply\":\"说清操控到崩溃\",\"styleNote\":\"短句推进\"}],\"lengthStrategy\":\"100字完整表达\"}\n```");
  expect(parsed.ok).toBe(true);
});
```

- [ ] **Step 3: 实现解析器**

创建 `commentAgentParsing.ts`，导出：

```ts
export function parseSkillActivationPlan(content: string):
  | { ok: true; plan: SkillActivationPlan }
  | { ok: false; detail: string } {
  const text = stripFence(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "parse_failed" };
  }
  return normalizeActivationPlan(parsed);
}
```

`normalizeActivationPlan` 必须检查：

- `skillIdentity.length >= 1`
- `targetReading` 非空
- `attackDirection` 非空
- `sharedConstraints.length >= 1`
- `angles.length >= 3`
- 每个 angle 的 `focus`、`howToApply`、`styleNote` 非空

- [ ] **Step 4: 运行解析测试**

Run:

```powershell
npm --workspace @clapback/extension test -- src/api/commentAgentPipeline.test.ts
```

Expected: 新解析测试通过。

### Task 4: 创建 Prompt 生成模块

**Files:**
- Create: `apps/extension/src/api/commentAgentPrompts.ts`
- Modify: `apps/extension/src/api/commentAgentPipeline.test.ts`

- [ ] **Step 1: 写 prompt 测试**

测试 activation prompt 必须包含完整 Skill、目标、意图和长度，但不包含素材箱空路径：

```ts
it("builds activation prompt from full skill and current target", () => {
  const prompt = buildSkillActivationPrompt({
    platform: "zhihu",
    targetText: "把复杂关系伤害说成吃饭睡觉就好。",
    intent: "反驳这种简化",
    lengthLabel: "目标 100 个汉字，完整表达优先，最多 125 个汉字",
    pageTitle: "知乎问题",
    sourceText: "问题回答摘录",
    skillName: "焚锋",
    skillGoal: "高攻击性反驳",
    skillSummary: "直接拆逻辑",
    skillText: "完整 Skill Markdown",
    styleProfileText: "{\"rhythm\":\"short\"}",
    attackPlaybookText: "{\"moves\":[\"偷换概念\"]}",
    selectedSampleText: "示例: ...",
  });

  expect(prompt).toContain("完整 Skill Markdown");
  expect(prompt).toContain("把复杂关系伤害说成吃饭睡觉就好");
  expect(prompt).toContain("反驳这种简化");
  expect(prompt).not.toContain("弹药");
});
```

- [ ] **Step 2: 实现 activation prompt**

`buildSkillActivationPrompt` 输出要求：

```text
任务: 阅读完整 Skill，并结合本轮目标评论，生成本轮 Skill Activation Plan。
不要生成评论正文。
输出严格 JSON，不要 Markdown，不要解释。
必须给出 3 到 5 个互不重复的 angles。
```

JSON 字段固定为 `skillIdentity`、`targetReading`、`attackDirection`、`sharedConstraints`、`forbiddenPatterns`、`angles`、`lengthStrategy`。

- [ ] **Step 3: 实现 execute prompt**

`buildExecutePrompt` 输入一个 angle，只要求输出一条评论正文：

```text
只输出一条中文评论正文，不解释，不编号，不要 JSON。
完整表达优先，明显超出硬上限才需要压缩。
```

Execute prompt 只能包含：

- target comment
- user intent
- page title / short source excerpt
- activation shared constraints
- 当前 angle
- length strategy
- selected example 1-2 条

不能塞完整 Skill。

- [ ] **Step 4: 运行 prompt 测试**

Run:

```powershell
npm --workspace @clapback/extension test -- src/api/commentAgentPipeline.test.ts
```

Expected: prompt 测试通过。

### Task 5: 实现 Skill Activation 和 Confirmation

**Files:**
- Create: `apps/extension/src/api/commentAgentPipeline.ts`
- Modify: `apps/extension/src/api/commentAgentPipeline.test.ts`

- [ ] **Step 1: 写 activation 成功测试**

Mock `requestModelCompletion` 返回合法 activation JSON，断言：

- 调用 `thinkingMode: "provider_default"`
- `maxTokens` 为 `2400`
- 不传 `responseFormat`
- plan 至少有 3 个角度

- [ ] **Step 2: 写 activation repair 测试**

首轮返回不可解析 content，第二轮 repair 返回合法 JSON，断言只 repair 一次。

- [ ] **Step 3: 写 activation 失败测试**

首轮和 repair 都不可解析，最终抛出：

```text
generation_failed:plan_invalid
```

- [ ] **Step 4: 实现 `activateSkillForTarget`**

函数形状：

```ts
async function activateSkillForTarget(input: ActivationInput): Promise<SkillActivationPlan>
```

行为：

- 首轮 `maxTokens: 2400`
- `temperature: 0.2`
- `thinkingMode: "provider_default"`
- `stream: true`
- 不使用 `responseFormat`
- `finishReason === "length"` 直接视为 `plan_truncated`
- content 为空视为 `plan_empty`
- 解析失败进入一次 repair

- [ ] **Step 5: 实现本地 confirmation**

`confirmActivationPlan(plan)` 必须检查：

- 至少 3 个 angle
- angle focus 去重后不少于 3 个
- `attackDirection`、`targetReading` 非空
- `skillIdentity` 和 `sharedConstraints` 非空

失败时走一次 activation repair；repair 后仍失败则抛错。

- [ ] **Step 6: 运行 activation 测试**

Run:

```powershell
npm --workspace @clapback/extension test -- src/api/commentAgentPipeline.test.ts
```

Expected: activation 成功、repair、失败测试通过。

### Task 6: 实现并行 Execute

**Files:**
- Modify: `apps/extension/src/api/commentAgentPipeline.ts`
- Modify: `apps/extension/src/api/commentAgentPipeline.test.ts`

- [ ] **Step 1: 写并行测试**

用三个 deferred promise mock 模型请求，断言三个 execute 请求在任意一个 resolve 前都已发起：

```ts
expect(executeCalls.length).toBe(3);
```

- [ ] **Step 2: 写 execute thinking A/B 支持测试**

实现内部策略参数：

```ts
type ExecuteThinkingPolicy = "disabled" | "provider_default";
```

测试两种 policy 会传给 `requestModelCompletion`。

- [ ] **Step 3: 写 execute 成功测试**

三个 execute 分支各返回一条完整候选，断言返回 3 条候选，且没有本地 fallback。

- [ ] **Step 4: 实现 execute**

函数形状：

```ts
async function executeAngles(input: ExecuteAnglesInput): Promise<ExecuteAnglesResult>
```

行为：

- 取 activation 中前 3 个互异 angles。
- `Promise.all` 并行发起。
- 每个请求只输出一条候选。
- `maxTokens` 使用 `generationMaxTokens(lengthConstraint)`，100 字目标通常是 `1024`。
- `temperature` 依 Skill 控制：`wenyan_attack` 可低一点，其他中等。
- `thinkingMode` 由 policy 控制。
- `finishReason === "length"` 的分支不采纳。
- content 为空不采纳。

- [ ] **Step 5: 运行 execute 测试**

Run:

```powershell
npm --workspace @clapback/extension test -- src/api/commentAgentPipeline.test.ts
```

Expected: execute 并行和 A/B policy 测试通过。

### Task 7: 实现 Refine 和补位

**Files:**
- Modify: `apps/extension/src/api/commentAgentPipeline.ts`
- Modify: `apps/extension/src/api/commentAgentPrompts.ts`
- Modify: `apps/extension/src/api/commentAgentPipeline.test.ts`

- [ ] **Step 1: 写略超接受测试**

100 字目标下，长度 116、120、125 的完整候选直接接受，不调用 refine。

- [ ] **Step 2: 写明显超长 refine 测试**

长度 150 且硬上限 125 时，调用 refine prompt，要求模型压缩但保留含义。

- [ ] **Step 3: 写过短 expand 测试**

长度低于 `minChars` 时，调用 refine prompt 扩写。

- [ ] **Step 4: 写补位测试**

三个 execute 里一个空 content，一个 `finishReason=length`，一个成功。系统最多发一次补位请求，最终不足 3 条则抛错，不使用本地模板。

- [ ] **Step 5: 实现 accept/refine 策略**

规则：

- `minChars <= length <= maxChars` 直接接受。
- `length > maxChars` 调用 refine 压缩。
- `length < minChars` 调用 refine 扩写。
- refine 失败不使用硬裁剪。
- 补位最多一次，每个缺口使用未用 angle 或补位 prompt。

- [ ] **Step 6: 运行 refine 测试**

Run:

```powershell
npm --workspace @clapback/extension test -- src/api/commentAgentPipeline.test.ts
```

Expected: 略超接受、明显超长 refine、过短 expand、补位失败可诊断测试通过。

### Task 8: 接入 `generateCandidates`

**Files:**
- Modify: `apps/extension/src/api/generation.ts`
- Modify: `apps/extension/src/api/commentAgentPipeline.ts`
- Modify: `apps/extension/src/api/handlers.test.ts`

- [ ] **Step 1: 写接入测试**

当模型是 OpenCode Go DeepSeek 且自定义长度 `>= 80` 时，`generateCandidates` 调用 agent pipeline。

- [ ] **Step 2: 写短评保持旧路径测试**

`lengthMode: "短"` 继续走现有简单生成路径，避免扩大风险面。

- [ ] **Step 3: 接入 pipeline**

在 `generateCandidates` 中保留：

```ts
const lengthConstraint = resolveLengthConstraint(request.settings);
```

新增判断：

```ts
if (shouldUseCommentAgentPipeline(resolvedModel, lengthConstraint)) {
  return {
    candidates: await generateCandidatesWithCommentAgentPipeline({
      request,
      promptContext,
      lengthConstraint,
      model: resolvedModel,
      apiKey,
      executeThinkingPolicy: "disabled",
    }),
  };
}
```

初始实现可以临时以 `executeThinkingPolicy: "disabled"` 保持现有稳定性，但这不是最终根因修复。真实 E2E 必须跑 `disabled` 和 `provider_default` A/B，并按证据决定默认值。

- [ ] **Step 4: 保留旧 compact 代码直到 E2E 通过**

不要立即删除旧 compact 路径。E2E 通过后再清理，避免无法回滚。

- [ ] **Step 5: 运行接入测试**

Run:

```powershell
npm --workspace @clapback/extension test -- src/api/handlers.test.ts src/api/commentAgentPipeline.test.ts
```

Expected: 接入测试通过。

### Task 9: 诊断和安全边界

**Files:**
- Modify: `apps/extension/src/api/commentAgentPipeline.ts`
- Modify: `apps/extension/src/api/generation.ts`

- [ ] **Step 1: 增加 `console.debug` 诊断**

每个阶段输出：

```ts
console.debug("[clapback:generation:pipeline]", {
  stage,
  provider,
  model,
  promptLength,
  maxTokens,
  thinkingMode,
  finishReason,
  contentLength,
  reasoningLength,
  accepted,
  rejected,
  reason,
});
```

- [ ] **Step 2: 保持无存储写入**

诊断只走 console。不要写 `chrome.storage`、IndexedDB、文件。

- [ ] **Step 3: 保持 API 契约**

`GenerateResponse` 仍然是：

```ts
export type GenerateResponse = {
  candidates: string[];
};
```

不要加入 degraded、diagnostic 等字段。

- [ ] **Step 4: 扫描密钥**

Run:

```powershell
rg -n "sk-[A-Za-z0-9_-]{10,}|api[_-]?key|OPENAI_API_KEY|OPENCODE" . --glob "!node_modules/**" --glob "!.git/**"
```

Expected: 只允许测试 fixture 的假 key。真实 key 不得出现在文档、日志或代码中。

### Task 10: 常规验证

**Files:**
- All touched files

- [ ] **Step 1: 跑新单测**

Run:

```powershell
npm --workspace @clapback/extension test -- src/api/modelConnection.test.ts src/api/commentAgentPipeline.test.ts src/api/handlers.test.ts
```

Expected: 相关测试通过。

- [ ] **Step 2: 跑完整测试**

Run:

```powershell
npm test
```

Expected: 全部 Vitest 测试通过，历史 skipped 可保留。

- [ ] **Step 3: 构建扩展**

Run:

```powershell
npm run build:extension
```

Expected: TypeScript 和 Vite build 通过。

## 真实 E2E 验收

### 环境

- 浏览器：真实 Edge 实例。
- 扩展：`apps/extension/dist`。
- 页面：`https://www.zhihu.com/question/654798998`。
- 模型：OpenCode Go `deepseek-v4-flash`。
- API key：使用本地已配置 key，不打印、不写入文件。
- 用户意图：`反驳对方把复杂伤害简化成作息问题`。
- 长度：自定义 `100`。
- Skill：`full_fire`、`restrained_breakdown`、`sarcastic_ironic`、`wenyan_attack`。

### 测试矩阵

- 旧路径 baseline：四个 Skill 各 1 次，使用 Task 0 结果。
- 新 pipeline，execute thinking disabled：四个 Skill 各 3 次，共 12 次。
- 新 pipeline，execute provider default thinking：四个 Skill 各 3 次，共 12 次。

### 必须记录

每轮记录：

- skill id
- run index
- target text 摘录
- intent
- execute thinking policy
- total latency ms
- activation latency ms
- execute branch latency ms
- refine/repair latency ms
- candidates
- candidate lengths
- provider content lengths
- reasoning lengths
- finish reasons
- accepted/rejected counts
- whether refined
- whether repaired
- whether fallback-like
- failure reason

### 硬通过标准

新 pipeline 每个 thinking policy 单独统计：

- 12/12 次请求返回 3 条候选。
- 每条候选来自非空 provider `content`。
- 0 条本地 fallback。
- 0 条明显半句硬裁剪。
- 0 次 `finish_reason=length` 被当作成功。
- `contentLength > 0` 的 execute 分支占比至少 95%。
- 中位耗时不超过 25 秒。
- 单轮耗时超过 30 秒需要在报告中解释原因。

### Execute thinking 默认策略选择

E2E 后按规则决定：

- 如果 `provider_default` 12/12 成功，且中位耗时不超过 `disabled` 的 130%，且人工抽查质量更好或不差，则把生产默认改为 `provider_default`。
- 否则保持 `disabled`。

这个决定必须写入最终报告，不允许凭感觉选择。

## 审查清单

实现完成后进行代码审查，发现问题先列 findings，再列总结。

### 架构审查

- Skill 是否每轮被完整读取到 activation 阶段。
- Execute 是否只读 activation 产物和单个 angle，而不是完整 Skill。
- Confirmation 是否是本地校验和一次 repair，没有人工确认。
- 默认评论生成是否不读取素材箱。
- 短评旧路径是否没有被无关改坏。

### 可靠性审查

- 空 content 是否会失败或 repair，不会成功。
- `finish_reason=length` 是否不会被采纳。
- reasoning-only 是否不会被当成 content。
- repair 次数是否受控，不能无限多轮消耗。
- Promise 并行失败是否能局部处理并补位。

### 长度审查

- 100 字目标下 116/120/125 字完整候选是否直接接受。
- 明显超长是否走模型压缩，不硬切。
- 过短是否走模型扩写或失败，不填本地模板。
- 10 字以内、20 字以内等短硬限制是否仍然严格。

### Provider 审查

- OpenCode Go DeepSeek planning/activation 是否可使用 provider 默认 thinking。
- OpenCode Go DeepSeek 默认生成是否仍可禁用 thinking。
- 普通 OpenAI-compatible provider 是否不携带未知 thinking 字段。
- 不注入 `/no_think` 到 prompt。

### 安全审查

- 没有明文 API key。
- 没有把诊断写入 storage/IndexedDB/文件。
- 没有修改 `GenerateResponse`。
- 没有提交临时 E2E 输出。

## 最终报告要求

完成后在 `docs/goal-result-报告.md` 追加或更新：

- 代码改动摘要，带文件路径。
- 单元测试结果。
- `npm test` 结果。
- `npm run build:extension` 结果。
- 旧路径 baseline 表格。
- 新 pipeline disabled thinking E2E 表格。
- 新 pipeline provider default thinking E2E 表格。
- execute thinking 默认策略选择和证据。
- 至少 8 条候选的人工质量抽查，覆盖四个 Skill。
- 明确说明是否还有失败、超时、截断或质量回退。

## Goal Prompt

把下面这段直接交给后续 agent：

```text
你是 Codex，在当前仓库根目录工作。请以 handoff/comment-generation-agent-pipeline-plan.md 为主要参考和执行依据，实现评论生成 Agent Pipeline。

硬性要求：
- 使用 OpenCode Go `deepseek-v4-flash` 做真实 E2E。
- 真实 E2E 使用本机扩展/浏览器里已经配置好的 OpenCode Go key；不要读取、打印、复制、写入或提交真实 key。
- 先跑旧路径 baseline，再实现新 pipeline。
- 新 pipeline 必须是 Skill Activation -> Confirmation -> Parallel Execute -> Refine/Repair。
- Skill Activation 每轮完整读取当前 Skill，并结合目标评论、用户意图、长度目标生成本轮任务态计划；禁止用静态摘要替代 Skill。
- 默认正式评论生成不读取素材箱，除非 request.settings.ammoBoxIds 非空。
- 不加入人工确认 UI。
- 不修改 GenerateResponse 契约，仍然只返回 `{ candidates }`。
- 不使用本地 fallback 假装模型成功。
- 不把 `/no_think` 注入 prompt。
- 不要把“针对 DeepSeek with Flash 强行关闭 thinking”当成修复。Thinking 只能作为阶段策略和 A/B 变量；根因必须通过 pipeline 拆分、局部失败处理、候选修复和长度策略解决。
- 不把真实 API key 写入代码、文档、日志或测试输出。
- 100 字目标下，116/120/125 字完整评论应接受；禁止硬裁剪成半句。
- `finish_reason=length`、空 content、reasoning-only 都不能当成功。
- Execute thinking 要做 A/B：disabled vs provider_default，并按计划中的证据规则决定最终默认值。

必须完成的验证：
- `npm --workspace @clapback/extension test -- src/api/modelConnection.test.ts src/api/commentAgentPipeline.test.ts src/api/handlers.test.ts`
- `npm test`
- `npm run build:extension`
- 真实 Edge + Zhihu E2E：打开 https://www.zhihu.com/question/654798998，加载 apps/extension/dist，点击真实“嘴替”按钮，四个 Skill：full_fire、restrained_breakdown、sarcastic_ironic、wenyan_attack，目标长度 100，填写用户意图，记录旧路径 baseline、新 pipeline disabled thinking、新 pipeline provider_default thinking。

完成后更新 docs/goal-result-报告.md，报告必须包含代码改动、测试输出、E2E 表格、候选质量抽查、execute thinking 默认策略选择依据和剩余风险。
```

## Plan Self-Review

- Spec coverage: 本计划覆盖了 Skill 完整读取、任务态 activation、机器 confirmation、并行 execute、懒 refine、无人工确认、无素材箱默认读取、长度软硬边界、E2E A/B 和审查。
- Placeholder scan: 本计划没有 `TBD`、`TODO`、`implement later`。
- Type consistency: 内部类型使用 `SkillActivationPlan`、`ExecutionAngle`、`PipelineStageDiagnostics`；公开返回仍为 `GenerateResponse { candidates: string[] }`。
- Scope check: 第一版不做完整 RAG、不做 UI plan 确认、不做长期 plan 缓存，只解决 100 字正式评论生成可靠性。
