import type { CorpusEntry, ModelConfig, SkillDraft, SkillTryoutResult } from "../workbench/runtimeApi";
import type { LengthConstraint } from "./lengthConstraints";
import { requestModelText } from "./modelConnection";

export type SkillDraftGeneration = {
  skill_md: string;
  style_profile: Record<string, unknown>;
  attack_playbook: Record<string, unknown>;
  sample_outputs: Array<{ prompt?: string; reply?: string; input?: string; output?: string }>;
  summary?: string;
};

const ATTACK_TAXONOMY = [
  "classification",
  "rhetorical_question",
  "analogy",
  "counterfactual",
  "reduction",
  "irony",
  "definition_war",
  "compressed_conclusion",
];

export async function generateSkillDraftFiles(payload: {
  model: ModelConfig;
  apiKey: string;
  skillName: string;
  skillGoal: string;
  sourceBoxIds: number[];
  entries: CorpusEntry[];
  previousFiles?: Record<string, string>;
  tryouts?: SkillTryoutResult[];
  feedback?: string;
  tags?: string[];
}): Promise<SkillDraftGeneration> {
  const content = await requestModelText(payload.model, payload.apiKey, {
    system: [
      "你是一个中文评论区 Skill 设计器。",
      "只输出 JSON，不要解释。",
      "JSON 字段必须包含 skill_md, style_profile, attack_playbook, sample_outputs, summary。",
      `attack_playbook.taxonomy 必须且只能包含这些键: ${ATTACK_TAXONOMY.join(", ")}。`,
    ].join("\n"),
    user: [
      `Skill 名称: ${payload.skillName}`,
      `创建目标: ${payload.skillGoal}`,
      `素材箱 ID: ${payload.sourceBoxIds.join(", ")}`,
      "素材样本:",
      ...payload.entries.slice(0, 24).map((entry, index) => `${index + 1}. ${entry.content}`),
      payload.previousFiles ? [
        "上一版 Skill 文件:",
        "SKILL.md:",
        payload.previousFiles["SKILL.md"] ?? "",
        "style_profile.json:",
        payload.previousFiles["style_profile.json"] ?? "{}",
        "attack_playbook.json:",
        payload.previousFiles["attack_playbook.json"] ?? "{}",
        "sample_outputs.json:",
        payload.previousFiles["sample_outputs.json"] ?? "[]",
      ].join("\n") : "",
      payload.tryouts?.length ? [
        "试打记录:",
        ...payload.tryouts.map((tryout) => [
          `轮次 ${tryout.round_index}`,
          `用户言论: ${tryout.user_utterance}`,
          `回复: ${tryout.reply}`,
        ].join(" / ")),
      ].join("\n") : "",
      payload.feedback || payload.tags?.length ? [
        "用户反馈:",
        payload.tags?.length ? `标签: ${payload.tags.join(", ")}` : "",
        payload.feedback ? `文字: ${payload.feedback}` : "",
        "请基于反馈重建完整 Skill，不要只记录反馈。",
      ].filter(Boolean).join("\n") : "",
      "请从素材中提炼语气、常用攻击路径、禁忌和至少 2 个试打样例。",
    ].join("\n"),
    temperature: 0.45,
    maxTokens: 1600,
  });
  return normalizeSkillDraftGeneration(content, payload.skillName, payload.skillGoal, payload.sourceBoxIds);
}

export async function runModelSkillTryout(payload: {
  model: ModelConfig;
  apiKey: string;
  draft: SkillDraft;
  userUtterance: string;
  roundIndex: number;
  lengthConstraint?: LengthConstraint;
}): Promise<string> {
  return requestModelText(payload.model, payload.apiKey, {
    system: [
      "你正在按一个中文评论区 Skill 进行试打。",
      "只输出一条中文回复，不要解释，不要编号。",
      "不要复读用户原话；优先体现 Skill 文件里的语气和攻击路径。",
      payload.lengthConstraint ? `长度要求: ${payload.lengthConstraint.label}` : "",
    ].filter(Boolean).join("\n"),
    user: [
      `试打轮次: ${payload.roundIndex}`,
      `用户言论: ${payload.userUtterance}`,
      payload.lengthConstraint ? `长度要求: ${payload.lengthConstraint.label}` : "",
      "SKILL.md:",
      payload.draft.files["SKILL.md"] ?? `# ${payload.draft.name}\n\n${payload.draft.goal}`,
      "style_profile.json:",
      payload.draft.files["style_profile.json"] ?? "{}",
      "attack_playbook.json:",
      payload.draft.files["attack_playbook.json"] ?? "{}",
    ].filter(Boolean).join("\n"),
    temperature: 0.72,
    maxTokens: 180,
  });
}

export function skillGenerationToFiles(
  generated: SkillDraftGeneration,
  sourceBoxIds: number[],
  packageInfo: { skillName: string; skillGoal: string },
): Record<string, string> {
  const name = packageInfo.skillName.trim() || parseSkillName(generated.skill_md);
  const id = toSkillPackageId(name);
  const skillMd = withSkillFrontmatter(generated.skill_md, id, packageInfo.skillGoal);
  return {
    "manifest.json": JSON.stringify({
      id,
      name,
      skill_name: id,
      goal: packageInfo.skillGoal,
      version: "0.1.0",
      summary: generated.summary ?? "",
      source_box_ids: sourceBoxIds,
    }, null, 2),
    "SKILL.md": skillMd,
    "style_profile.json": JSON.stringify({
      ...generated.style_profile,
      source_box_ids: sourceBoxIds,
    }, null, 2),
    "attack_playbook.json": JSON.stringify(generated.attack_playbook, null, 2),
    "sample_outputs.json": JSON.stringify(generated.sample_outputs, null, 2),
  };
}

function parseSkillName(skillMd: string): string {
  return skillMd.match(/^#\s+(.+)$/m)?.[1]?.trim() || "Generated Skill";
}

function toSkillPackageId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "generated-skill";
}

function withSkillFrontmatter(skillMd: string, skillId: string, skillGoal: string): string {
  const body = skillMd.trim().replace(/^---\s*[\s\S]*?\s*---\s*/, "").trim();
  const description = `Use when ${skillGoal.replace(/\s+/g, " ").trim() || "this generated Skill is selected"}`.slice(0, 180);
  return [
    "---",
    `name: ${skillId}`,
    `description: ${description}`,
    "---",
    "",
    body,
  ].join("\n");
}

function normalizeSkillDraftGeneration(
  content: string,
  skillName: string,
  skillGoal: string,
  sourceBoxIds: number[],
): SkillDraftGeneration {
  const parsed = parseJsonObject(content);
  const skillMd = stringValue(parsed.skill_md);
  const styleProfile = objectValue(parsed.style_profile);
  const attackPlaybook = objectValue(parsed.attack_playbook);
  const sampleOutputs = arrayOfObjects(parsed.sample_outputs);
  if (
    !isUsableSkillMd(skillMd, skillName, skillGoal) ||
    !styleProfile ||
    Object.keys(styleProfile).length === 0 ||
    !attackPlaybook ||
    Object.keys(attackPlaybook).length === 0 ||
    sampleOutputs.length < 2
  ) {
    throw new Error("skill_creator_invalid_output");
  }
  return {
    skill_md: skillMd,
    style_profile: styleProfile,
    attack_playbook: attackPlaybook,
    sample_outputs: sampleOutputs,
    summary: stringValue(parsed.summary),
  };
}

function parseJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (!isPlainObject(parsed)) throw new Error("skill_creator_invalid_output");
    return parsed;
  } catch {
    throw new Error("skill_creator_invalid_output");
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

function arrayOfObjects(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value
      .filter(isPlainObject)
      .filter((item) =>
        Boolean(stringValue(item.prompt) || stringValue(item.input)) &&
        Boolean(stringValue(item.reply) || stringValue(item.output))
      )
    : [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUsableSkillMd(skillMd: string, skillName: string, skillGoal: string): boolean {
  const body = skillMd
    .replace(/^#\s+.+$/m, "")
    .replace(skillName, "")
    .replace(skillGoal, "")
    .trim();
  const rawBody = skillMd.replace(/^#\s+.+$/m, "").trim();
  const meaningfulBody = body
    .replace(/\b(?:goal|purpose|summary|name)\b/gi, "")
    .replace(/[目标目的摘要名称技能创建要求说明描述]/g, "")
    .replace(/[^A-Za-z0-9\u4e00-\u9fa5]+/g, "")
    .trim();
  return skillMd.trim().length >= 16 && rawBody.length >= 8 && meaningfulBody.length > 0;
}
