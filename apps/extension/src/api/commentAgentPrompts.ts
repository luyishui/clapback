import type { ExecutionAngle, SkillActivationPlan } from "./commentAgentTypes";

export type SkillActivationPromptInput = {
  platform: string;
  targetText: string;
  intent: string;
  lengthLabel: string;
  pageTitle: string;
  sourceText: string;
  nearbyComments: string[];
  skillName: string;
  skillGoal: string;
  skillSummary: string;
  skillText: string;
  styleProfileText: string;
  attackPlaybookText: string;
  selectedSampleText: string;
  ammoText: string;
};

export type ExecutePromptInput = {
  platform: string;
  targetText: string;
  intent: string;
  pageTitle: string;
  sourceText: string;
  nearbyComments: string[];
  plan: SkillActivationPlan;
  angle: ExecutionAngle;
  lengthLabel: string;
  selectedSampleText: string;
  existingCandidates: string[];
};

export function buildSkillActivationPrompt(input: SkillActivationPromptInput): string {
  return [
    "任务: 阅读完整 Skill，并结合本轮目标评论，生成本轮 Skill Activation Plan。",
    "不要生成评论正文。",
    "输出严格 JSON，不要 Markdown，不要解释。",
    "必须给出 3 到 5 个互不重复的 angles。",
    "JSON 字段固定为 skillIdentity、targetReading、attackDirection、sharedConstraints、forbiddenPatterns、angles、lengthStrategy。",
    "angles 每项固定为 id、focus、howToApply、styleNote。",
    "字段必须简短可执行: targetReading 不超过 160 字，attackDirection 不超过 100 字，sharedConstraints 每项不超过 40 字，angle.focus 不超过 24 字，howToApply 不超过 80 字，styleNote 不超过 50 字。",
    "",
    `平台: ${input.platform}`,
    `目标评论: ${truncate(input.targetText, 1800)}`,
    `用户意图: ${input.intent || "反驳"}`,
    `长度目标: ${input.lengthLabel}`,
    `页面标题: ${input.pageTitle}`,
    input.sourceText ? `页面/回答短摘录: ${truncate(input.sourceText, 500)}` : "",
    input.nearbyComments.length ? `附近评论: ${truncate(input.nearbyComments.join(" / "), 300)}` : "",
    "",
    "完整 Skill:",
    `名称: ${input.skillName}`,
    `目标: ${input.skillGoal}`,
    `摘要: ${input.skillSummary}`,
    input.skillText,
    input.styleProfileText ? `style_profile.json:\n${input.styleProfileText}` : "",
    input.attackPlaybookText ? `attack_playbook.json:\n${input.attackPlaybookText}` : "",
    input.selectedSampleText,
    input.ammoText ? `弹药:\n${input.ammoText}` : "",
  ].filter(Boolean).join("\n");
}

export function buildActivationRepairPrompt(input: {
  originalPrompt: string;
  invalidContent: string;
  failureDetail: string;
}): string {
  return [
    "任务: 修复上一轮 Skill Activation Plan 输出。",
    "只输出严格 JSON，不要 Markdown，不要解释，不要生成评论正文。",
    `失败原因: ${input.failureDetail}`,
    input.invalidContent ? `上一轮输出:\n${truncate(input.invalidContent, 1800)}` : "上一轮输出为空。",
    "原始任务:",
    input.originalPrompt,
  ].join("\n");
}

export function buildExecutePrompt(input: ExecutePromptInput): string {
  return [
    "只输出一条中文评论正文，不解释，不编号，不要 JSON。",
    "完整表达优先，围绕目标字数自然收束。",
    "字数控制: 贴近目标值即可；标点、空格、引号不计入字数；不要为了凑字解释写作过程。",
    "",
    `平台: ${input.platform}`,
    `目标评论: ${input.targetText}`,
    `用户意图: ${input.intent || "反驳"}`,
    [
      `约束: 回复必须针对【目标评论】；意图是攻击态度和方向(如"反驳""讽刺""冷静拆解")，`,
      `用于指导怎么打，不是被打的对象；不要把意图文字当成你要反驳的内容。`,
    ].join(""),
    `页面标题: ${input.pageTitle}`,
    input.sourceText ? `页面/回答短摘录: ${input.sourceText}` : "",
    input.nearbyComments.length ? `附近评论: ${input.nearbyComments.join(" / ")}` : "",
    "",
    "本轮 Activation:",
    `Skill 身份: ${input.plan.skillIdentity.join(" / ")}`,
    `目标解读: ${input.plan.targetReading}`,
    `总攻击方向: ${input.plan.attackDirection}`,
    `共享约束: ${input.plan.sharedConstraints.join("；")}`,
    input.plan.forbiddenPatterns.length ? `禁忌: ${input.plan.forbiddenPatterns.join("；")}` : "",
    `长度策略: ${input.plan.lengthStrategy || input.lengthLabel}`,
    `长度目标: ${input.lengthLabel}；系统内部会按完整评论验收，禁止硬截断半句。`,
    "",
    "当前角度:",
    `id: ${input.angle.id}`,
    `focus: ${input.angle.focus}`,
    `howToApply: ${input.angle.howToApply}`,
    `styleNote: ${input.angle.styleNote}`,
    input.existingCandidates.length ? `不要重复这些候选:\n${formatCandidates(input.existingCandidates)}` : "",
    input.selectedSampleText ? trimSelectedSamples(input.selectedSampleText) : "",
  ].filter(Boolean).join("\n");
}

export function buildRefinePrompt(input: {
  targetText: string;
  intent: string;
  plan: SkillActivationPlan;
  angle: ExecutionAngle;
  candidate: string;
  lengthLabel: string;
  mode: "compress" | "expand";
}): string {
  return [
    input.mode === "compress"
      ? "任务: 压缩下面这条模型候选，保留原意、语气和攻击角度。"
      : "任务: 扩写下面这条模型候选，保留原意、语气和攻击角度。",
    "只输出一条中文评论正文，不解释，不编号，不要 JSON。",
    "禁止硬截断半句；必须输出完整句子。",
    `目标评论: ${input.targetText}`,
    `用户意图: ${input.intent || "反驳"}`,
    `Activation 方向: ${input.plan.attackDirection}`,
    `当前角度: ${input.angle.focus}；${input.angle.howToApply}`,
    `长度要求: ${input.lengthLabel}`,
    input.mode === "expand"
      ? "扩写要求: 向目标字数靠拢；增加一个具体因果点或反问，补到完整评论后就停。"
      : "压缩要求: 向目标字数靠拢；保留完整句子和核心攻击点，不要压成短梗。",
    `原候选: ${input.candidate}`,
  ].join("\n");
}

export function buildFillPrompt(input: ExecutePromptInput): string {
  return [
    "任务: 补位生成一条新的模型候选。",
    buildExecutePrompt(input),
  ].join("\n");
}

function formatCandidates(candidates: string[]): string {
  return candidates.map((candidate, index) => `${index + 1}. ${candidate}`).join("\n");
}

function trimSelectedSamples(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => !/^Selected Sample:$/i.test(line.trim()));
  return truncate(lines.join("\n"), 900);
}

function truncate(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > limit ? compact.slice(0, limit) : compact;
}
