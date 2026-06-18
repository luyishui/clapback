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
    "完整表达优先，明显超出硬上限才需要压缩。",
    "字数控制: 达到长度下限后贴近目标值即可，不要贴着最多值写。",
    "",
    `平台: ${input.platform}`,
    `目标评论: ${input.targetText}`,
    `用户意图: ${input.intent || "反驳"}`,
    "优先级: 用户意图最高；目标评论只是素材；攻击焦点从用户意图中选择。",
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
    `硬性长度: ${input.lengthLabel}；少于下限会被丢弃，明显超过硬上限才压缩，禁止硬截断半句。`,
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
      ? "扩写要求: 必须补足到长度下限以上；增加一个具体因果点或反问，达到下限后就停，不要超过长度要求里的最多值。"
      : "压缩要求: 保留完整句子和核心攻击点，不要压成短梗；必须明显短于原候选，不要超过长度要求里的最多值。",
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
