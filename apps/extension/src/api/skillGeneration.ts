import type { CorpusEntry, ModelConfig, SkillDetail, SkillDraft, SkillTryoutResult } from "../workbench/runtimeApi";
import type { LengthConstraint } from "./lengthConstraints";
import { requestModelText } from "./modelConnection";

export type SkillDraftGeneration = {
  skill_md: string;
  style_profile: Record<string, unknown>;
  attack_playbook: Record<string, unknown>;
  sample_outputs: Array<{ prompt?: string; reply?: string; input?: string; output?: string }>;
  summary?: string;
};

export const ATTACK_TAXONOMY = [
  "classification",
  "rhetorical_question",
  "analogy",
  "counterfactual",
  "reduction",
  "irony",
  "definition_war",
  "compressed_conclusion",
] as const;

const MIN_SKILL_CREATOR_STYLE_SIGNALS = 2;
const MIN_SKILL_CREATOR_ATTACK_SIGNALS = 2;
const SKILL_CREATOR_MAX_TOKENS = 2400;
const MAX_SKILL_CREATOR_EVIDENCE_ENTRIES = 24;
const MAX_SKILL_CREATOR_EVIDENCE_CHARS = 520;
const STYLE_SIGNAL_KEYS = [
  "catchphrases",
  "sentence_patterns",
  "rhythm",
  "keywords",
  "punctuation",
];
const GENERIC_STYLE_SIGNAL_TERMS = [
  "clear",
  "direct",
  "generic",
  "high",
  "placeholder",
  "professional",
  "quality",
  "sharp",
  "style",
  "target",
  "有力",
  "高质量",
  "质量",
  "清晰",
  "犀利",
  "尖锐",
  "专业",
  "理性",
  "直接",
  "简洁",
  "克制",
  "回复",
  "回应",
  "反驳",
  "输出",
  "生成",
  "目标",
  "用户",
  "内容",
  "观点",
  "评论",
  "根据",
  "进行",
  "保持",
  "风格",
  "语气",
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
  skillCreatorSkill?: SkillDetail;
}): Promise<SkillDraftGeneration> {
  const systemPrompt = buildSkillCreatorSystemPrompt(payload.skillCreatorSkill);

  const content = await requestModelText(payload.model, payload.apiKey, {
    system: systemPrompt,
    user: [
      `Skill 名称: ${payload.skillName}`,
      `创建目标: ${payload.skillGoal}`,
      `素材箱 ID: ${payload.sourceBoxIds.join(", ")}`,
      "素材样本（本地裁片，最多 24 条；保留开头、结尾与风格标记句，不是模型预摘要）:",
      ...buildSkillCreatorEvidence(payload.entries),
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
        "试打记录（每条是一个独立样例）:",
        ...payload.tryouts.map((t, i) => {
          const rating = t.user_rating === "accepted" ? "[接受 - 保持此风格]"
                       : t.user_rating === "rejected" ? `[拒绝 - 原因：${t.rejection_reason ?? "不满意"}]`
                       : "[未评价]";
          const note = t.user_annotation ? `\n  用户标注：${t.user_annotation}` : "";
          return [
            `样例${i + 1} ${rating}`,
            `  用户言论：${t.user_utterance}`,
            `  当前反驳：${t.reply}${note}`,
          ].join("\n");
        }),
        "",
        "请据此修改 SKILL.md、style_profile.json、attack_playbook.json：",
        "- 保持被接受样例的风格特征（语气、句式、攻击路径）",
        "- 修正被拒绝样例中的具体问题",
        "- 若样例有用户标注，必须按标注要求调整对应的风格信号或攻击策略",
      ].join("\n") : "",
      payload.feedback || payload.tags?.length ? [
        "用户反馈:",
        payload.tags?.length ? `标签: ${payload.tags.join(", ")}` : "",
        payload.feedback ? `文字: ${payload.feedback}` : "",
        "请基于反馈重建完整 Skill，不要只记录反馈。",
      ].filter(Boolean).join("\n") : "",
      "请从素材中提炼语气、常用攻击路径、禁忌和至少 2 个试打样例。",
      "最终只输出符合 schema 的 JSON object。",
    ].join("\n"),
    temperature: 0.45,
    maxTokens: SKILL_CREATOR_MAX_TOKENS,
    responseFormat: "json_object",
  });
  return normalizeSkillDraftGeneration(content, payload.skillName, payload.skillGoal, payload.sourceBoxIds);
}

export function buildSkillCreatorEvidence(entries: CorpusEntry[]): string[] {
  return entries
    .slice(0, MAX_SKILL_CREATOR_EVIDENCE_ENTRIES)
    .map((entry, index) => formatSkillCreatorEvidence(entry, index));
}

function formatSkillCreatorEvidence(entry: CorpusEntry, index: number): string {
  const title = metadataString(entry.metadata, "title") || metadataString(entry.metadata, "name");
  const url = metadataString(entry.metadata, "url") || metadataString(entry.metadata, "source_url");
  const header = [
    `${index + 1}. 来源: ${sanitizeInlineText(entry.source) || "unknown"}`,
    title ? `标题: ${sanitizeInlineText(title)}` : "",
    url ? `URL: ${sanitizeInlineText(url)}` : "",
  ].filter(Boolean).join(" / ");
  return `${header}\n片段: ${clipSkillCreatorEvidenceText(entry.content)}`;
}

function clipSkillCreatorEvidenceText(content: string): string {
  const sentences = splitEvidenceSentences(content);
  if (sentences.length === 0) return "";
  const opening = sentences.slice(0, 1);
  const ending = sentences.length > 1 ? sentences.slice(-1) : [];
  const edge = new Set([...opening, ...ending]);
  const markers = sentences
    .filter((sentence) => !edge.has(sentence))
    .filter(isStyleMarkerSentence)
    .slice(0, 4);
  return truncateEvidencePieces(uniqueStrings([...opening, ...markers, ...ending]), MAX_SKILL_CREATOR_EVIDENCE_CHARS);
}

function splitEvidenceSentences(content: string): string[] {
  const sentences = content
    .split(/\r?\n+/)
    .flatMap((line) => line.match(/[^。！？!?；;]+[。！？!?；;]?/gu) ?? [])
    .map((sentence) => sanitizeInlineText(sentence))
    .filter(Boolean);
  return mergeCausalQuestionPairs(sentences);
}

function mergeCausalQuestionPairs(sentences: string[]): string[] {
  const merged: string[] = [];
  for (let index = 0; index < sentences.length; index += 1) {
    const current = sentences[index];
    const next = sentences[index + 1] ?? "";
    if (/为什么.*[？?]$/.test(current) && /^因为/.test(next)) {
      merged.push(`${current}${next}`);
      index += 1;
    } else {
      merged.push(current);
    }
  }
  return merged;
}

function isStyleMarkerSentence(sentence: string): boolean {
  return /[？?]/.test(sentence) ||
    /(为什么|因为|但是|然而|不过|而是|如果|那么|所以|先|再|最后|定义|所谓|换句话说|本质|结论|前提|因果|类比|反过来|说白了)/.test(sentence) ||
    /不是.+而是/.test(sentence);
}

function truncateEvidencePieces(pieces: string[], maxChars: number): string {
  const result: string[] = [];
  let used = 0;
  for (const piece of pieces) {
    const remaining = maxChars - used - (result.length > 0 ? 3 : 0);
    if (remaining <= 0) break;
    const clipped = truncateChars(piece, remaining);
    if (!clipped) continue;
    result.push(clipped);
    used += [...clipped].length + (result.length > 1 ? 3 : 0);
  }
  return result.join(" / ");
}

function truncateChars(value: string, maxChars: number): string {
  const chars = [...value];
  if (chars.length <= maxChars) return value;
  if (maxChars <= 1) return "";
  return `${chars.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.replace(/\s+/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSkillCreatorSystemPrompt(skillCreatorSkill?: SkillDetail): string {
  const skillCreatorLabel = skillCreatorSkill
    ? `内置方法论: ${skillCreatorSkill.name} - ${skillCreatorSkill.summary}`
    : "内置方法论: 从素材抽取可复用表达信号和攻击路径。";
  return [
    "你是一个中文评论区 Skill 设计器。",
    skillCreatorLabel,
    "",
    "不要输出思考过程；不要解释；不要 Markdown 代码围栏；最终 content 必须直接是一个 JSON object。",
    "JSON 字段必须包含 skill_md, style_profile, attack_playbook, sample_outputs, summary。",
    "",
    "style_profile 必须包含具体、可复用、来自素材的文本信号：",
    JSON.stringify({
      catchphrases: ["简单来说", "我始终认为", "说一个许多人忽视的问题"],
      sentence_patterns: ["如果A是问题，那么导致A的B，又是谁的问题呢？", "为什么说A呢？因为B"],
      keywords: ["道德绑架", "社会共识", "信息平权"],
      rhythm: ["先归类，再解释，再压缩结论"],
      punctuation: ["反问句", "短句收尾"],
    }, null, 2),
    "",
    "attack_playbook.taxonomy 必须且只能包含以下 8 个键，且每个值必须是 0 到 1 的数字权重，不能写文字说明：",
    JSON.stringify({
      taxonomy: {
        classification: 0.2,
        rhetorical_question: 0.2,
        analogy: 0.15,
        counterfactual: 0.1,
        reduction: 0.1,
        irony: 0.05,
        definition_war: 0.1,
        compressed_conclusion: 0.1,
      },
      preferred_sequences: [
        ["classification", "rhetorical_question", "compressed_conclusion"],
        ["definition_war", "analogy", "reduction"],
      ],
    }, null, 2),
    "",
    "skill_md 要说明使用流程、适用场景、禁忌和输出契约。",
    "sample_outputs 至少 2 条，每条包含 prompt 和 reply，reply 要展示提取出的风格。",
    "如果素材不足以支持目标，也仍输出 JSON，但 summary 中明确说明不足点。",
  ].join("\n");
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
    !attackPlaybook ||
    validateSkillCreatorSignals(styleProfile, attackPlaybook).length > 0 ||
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
  const direct = parseJsonCandidate(trimmed);
  if (direct) return direct;
  throw new Error("skill_creator_invalid_output");
}

function parseJsonCandidate(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (!isPlainObject(parsed)) throw new Error("skill_creator_invalid_output");
    return parsed;
  } catch {
    return null;
  }
}

function extractFirstJsonObject(value: string): string | null {
  const start = value.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return null;
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
      .filter((item) => {
        const prompt = stringValue(item.prompt) || stringValue(item.input);
        const reply = stringValue(item.reply) || stringValue(item.output);
        return prompt.trim() !== "" && reply.trim() !== "";
      })
    : [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateSkillCreatorSignals(
  styleProfile: Record<string, unknown>,
  attackPlaybook: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  if (skillCreatorStyleSignalCount(styleProfile) < MIN_SKILL_CREATOR_STYLE_SIGNALS) {
    errors.push("style_profile.json must contain at least 2 reusable style signals");
  }
  if (!hasFixedAttackTaxonomy(attackPlaybook)) {
    errors.push("attack_playbook.json must define the fixed 8-class taxonomy");
  } else if (skillCreatorAttackSignalCount(attackPlaybook) < MIN_SKILL_CREATOR_ATTACK_SIGNALS) {
    errors.push("attack_playbook.json taxonomy must contain at least 2 non-zero attack signals");
  }
  return errors;
}

export function skillCreatorStyleSignalCount(profile: Record<string, unknown>): number {
  return STYLE_SIGNAL_KEYS.reduce((total, key) => total + reusableStyleSignalCount(profile[key]), 0);
}

export function skillCreatorAttackSignalCount(attackPlaybook: Record<string, unknown>): number {
  const taxonomy = objectValue(attackPlaybook.taxonomy);
  if (!taxonomy) return 0;
  return ATTACK_TAXONOMY.filter((key) => {
    const value = taxonomy[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }).length;
}

export function hasFixedAttackTaxonomy(attackPlaybook: Record<string, unknown>): boolean {
  const taxonomy = objectValue(attackPlaybook.taxonomy);
  if (!taxonomy) return false;
  return Object.keys(taxonomy).sort().join("|") === ATTACK_TAXONOMY.slice().sort().join("|");
}

function reusableStyleSignalCount(value: unknown): number {
  if (typeof value === "string") return isSpecificStyleText(value) ? 1 : 0;
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + reusableStyleSignalCount(item), 0);
  }
  if (isPlainObject(value)) {
    return Object.entries(value)
      .filter(([key]) => key !== "source_box_ids")
      .reduce((total, [, item]) => total + reusableStyleSignalCount(item), 0);
  }
  return 0;
}

function isSpecificStyleText(value: string): boolean {
  const raw = value.trim();
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
  if (!normalized) return /[!?！？。…~～]+/.test(raw);
  const genericPattern = new RegExp(
    GENERIC_STYLE_SIGNAL_TERMS
      .map((term) => term.toLowerCase())
      .sort((a, b) => b.length - a.length)
      .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|"),
    "g",
  );
  const remainder = normalized.replace(genericPattern, "");
  return remainder.length >= 2;
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
