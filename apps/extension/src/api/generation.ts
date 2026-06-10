import type { GenerateRequest, GenerateResponse } from "../content/types";
import type { AmmoEntry, SkillDetail } from "../workbench/runtimeApi";
import { getDefaultModelConfig, getRawApiKey, getSettings, getSkillDetail, listAmmoEntries } from "./idbStore";
import type { LengthConstraint } from "./lengthConstraints";
import { resolveLengthConstraint, trimToMaxChars } from "./lengthConstraints";
import { requestModelText } from "./modelConnection";

const FALLBACK_PREFIXES = [
  "先别急着下结论，",
  "问题不在声音大小，而在证据够不够，",
  "你这句话最薄弱的地方是，",
  "把结论包装成常识，并不会让它变成论证，",
];
const MAX_SKILL_TEXT_LENGTH = 1200;
const MAX_SOURCE_TEXT_LENGTH = 1800;
const MAX_AMMO_ENTRIES = 20;
const MAX_AMMO_DESCRIPTION_LENGTH = 160;

export async function generateCandidates(request: GenerateRequest): Promise<GenerateResponse> {
  const apiKey = await getRawApiKey();
  const model = await getDefaultModelConfig();
  if (!apiKey || !model) {
    return deterministicFallback(request);
  }

  try {
    const promptContext = await buildPromptContext(request);
    const lengthConstraint = resolveLengthConstraint(request.settings);
    const content = await requestModelText({
      ...model,
      model_name: model.model_name || (await getSettings()).model,
    }, apiKey, {
      system: "你是一个中文评论区回复候选生成器。只输出 3 条候选，每条一行，不要解释，不要编号。",
      user: buildUserPrompt(request, promptContext),
      temperature: 0.8,
    });
    const candidates = normalizeCandidates(parseCandidates(content), request.target.text, lengthConstraint);
    if (candidates.length >= 3) return { candidates: candidates.slice(0, 3) };

    const repaired = await requestModelText({
      ...model,
      model_name: model.model_name || (await getSettings()).model,
    }, apiKey, {
      system: "你是一个中文评论区回复候选修复器。只输出 3 条合格候选，每条一行，不要解释，不要编号。",
      user: buildRepairPrompt(request, promptContext, candidates, lengthConstraint),
      temperature: 0.5,
    });
    const repairedCandidates = normalizeCandidates(parseCandidates(repaired), request.target.text, lengthConstraint);
    if (repairedCandidates.length >= 3) return { candidates: repairedCandidates.slice(0, 3) };
  } catch {
    // Keep generation usable when a provider is misconfigured.
  }
  return deterministicFallback(request);
}

function parseCandidates(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)、])\s*/, "").trim())
    .filter(Boolean);
}

function normalizeCandidates(candidates: string[], targetText: string, lengthConstraint: LengthConstraint): string[] {
  const target = normalizeForCompare(targetText);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const text = candidate.trim();
    const normalized = normalizeForCompare(text);
    const length = [...text].length;
    if (!text || normalized === target || seen.has(normalized)) continue;
    if (length > lengthConstraint.maxChars) continue;
    if (lengthConstraint.minChars !== undefined && length < lengthConstraint.minChars) continue;
    seen.add(normalized);
    result.push(text);
  }
  return result;
}

function deterministicFallback(request: GenerateRequest): GenerateResponse {
  const target = request.target.text.trim() || "这句话";
  const lengthConstraint = resolveLengthConstraint(request.settings);
  const seed = hash([
    target,
    request.intent,
    request.settings.activeSkillId,
    request.settings.lengthMode,
    request.settings.customLengthTarget ?? "",
    ...(request.settings.ammoBoxIds ?? []),
  ].join(":"));
  return {
    candidates: [0, 1, 2].map((offset) => {
      const prefix = FALLBACK_PREFIXES[(seed + offset) % FALLBACK_PREFIXES.length];
      const template = offset === 0
        ? `${prefix}${target} 这里缺的是论证，不是态度。`
        : offset === 1
          ? `${prefix}你先把前提补上，再谈结论也不迟。`
          : `${prefix}这不是观点尖锐，是逻辑还没落地。`;
      return trimFallback(template, target, offset, lengthConstraint);
    }),
  };
}

function trimFallback(template: string, target: string, offset: number, lengthConstraint: LengthConstraint): string {
  if ([...template].length <= lengthConstraint.maxChars) return template;
  const targetAware = `${target}，证据呢`;
  if (offset === 0 && [...targetAware].length <= lengthConstraint.maxChars) return targetAware;
  const compactTemplates = [
    "先补证据，再下结论。",
    "前提没立住，结论就悬。",
    "这不是尖锐，是跳步。",
  ];
  const compact = compactTemplates[offset % compactTemplates.length];
  return trimToMaxChars(compact, lengthConstraint.maxChars);
}

async function buildPromptContext(request: GenerateRequest): Promise<{
  sourceTitle: string;
  sourceText: string;
  skill: SkillDetail | null;
  skillText: string;
  ammo: AmmoEntry[];
}> {
  const [skill, ammo] = await Promise.all([
    loadSkill(request.settings.activeSkillId),
    loadAmmo(request.settings.ammoBoxIds ?? []),
  ]);
  return {
    sourceTitle: truncate(request.context.sourceTitle ?? "", MAX_SOURCE_TEXT_LENGTH),
    sourceText: truncate(request.context.sourceText ?? "", MAX_SOURCE_TEXT_LENGTH),
    skill,
    skillText: truncate(skill?.skill_md ?? "", MAX_SKILL_TEXT_LENGTH),
    ammo,
  };
}

async function loadSkill(skillId: string): Promise<SkillDetail | null> {
  try {
    return await getSkillDetail(skillId);
  } catch {
    return null;
  }
}

function buildUserPrompt(
  request: GenerateRequest,
  promptContext: {
    sourceTitle: string;
    sourceText: string;
    skill: SkillDetail | null;
    skillText: string;
    ammo: AmmoEntry[];
  },
): string {
  const lengthConstraint = resolveLengthConstraint(request.settings);
  return [
    `平台: ${request.platform}`,
    `目标评论: ${request.target.text}`,
    `意图: ${request.intent || "反驳"}`,
    "输出要求: 只输出 3 条候选，每条一行；不要解释；不要编号；不要复读目标评论。",
    `长度要求: ${lengthConstraint.label}`,
    `上下文标题: ${request.context.pageTitle}`,
    promptContext.sourceTitle ? `来源标题: ${promptContext.sourceTitle}` : "",
    promptContext.sourceText ? `来源正文: ${promptContext.sourceText}` : "",
    `附近评论: ${request.context.nearbyComments.join(" / ")}`,
    promptContext.skill ? [
      "Skill:",
      `名称: ${promptContext.skill.name}`,
      `目标: ${promptContext.skill.goal}`,
      `摘要: ${promptContext.skill.summary}`,
      `说明: ${promptContext.skillText}`,
    ].join("\n") : "",
    promptContext.ammo.length > 0 ? [
      "弹药:",
      ...promptContext.ammo.map((entry) => `- ${entry.term}: ${truncate(entry.description, MAX_AMMO_DESCRIPTION_LENGTH)}`),
    ].join("\n") : "",
    `长度: ${request.settings.lengthMode}`,
  ].filter(Boolean).join("\n");
}

function buildRepairPrompt(
  request: GenerateRequest,
  promptContext: {
    sourceTitle: string;
    sourceText: string;
    skill: SkillDetail | null;
    skillText: string;
    ammo: AmmoEntry[];
  },
  acceptedCandidates: string[],
  lengthConstraint: LengthConstraint,
): string {
  return [
    buildUserPrompt(request, promptContext),
    acceptedCandidates.length > 0 ? `已合格候选: ${acceptedCandidates.join(" / ")}` : "",
    "上一次输出存在重复、超长或数量不足。",
    `请重新输出 3 条，必须${lengthConstraint.label}，不要复读目标评论。`,
  ].filter(Boolean).join("\n");
}

async function loadAmmo(boxIds: number[]): Promise<AmmoEntry[]> {
  const entries: AmmoEntry[] = [];
  for (const boxId of boxIds) {
    try {
      entries.push(...await listAmmoEntries(boxId));
    } catch {
      // Missing ammo boxes should not block generation.
    }
    if (entries.length >= MAX_AMMO_ENTRIES) break;
  }
  return entries.slice(0, MAX_AMMO_ENTRIES);
}

function truncate(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > limit ? compact.slice(0, limit) : compact;
}

function normalizeForCompare(value: string): string {
  return value.replace(/\s+/g, "").replace(/[，。！？、,.!?]/g, "").toLowerCase();
}

function hash(value: string): number {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) {
    result = (result * 31 + value.charCodeAt(i)) >>> 0;
  }
  return result;
}
