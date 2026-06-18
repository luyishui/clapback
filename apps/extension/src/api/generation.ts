import type { GenerateRequest, GenerateResponse } from "../content/types";
import type { AmmoEntry, ModelConfig, SkillDetail } from "../workbench/runtimeApi";
import { getDefaultModelConfig, getRawApiKey, getSettings, getSkillDetail, listAmmoEntries } from "./idbStore";
import type { LengthConstraint } from "./lengthConstraints";
import { isWithinLengthConstraint, resolveLengthConstraint } from "./lengthConstraints";
import type { ModelCompletion } from "./modelConnection";
import { requestModelCompletion } from "./modelConnection";
import { INTERNAL_STRATEGY_LABEL_OUTPUT_RULE } from "./internalStrategyLabels";
import { formatSelectedSampleForPrompt, samplesFromSkillDetail, selectSampleForLength } from "./skillSamples";
import { generateCandidatesWithCommentAgentPipeline } from "./commentAgentPipeline";

const MODEL_CANDIDATE_COUNT = 4;
const RETURN_CANDIDATE_COUNT = 3;
const SHORT_GENERATION_MAX_TOKENS = 512;
const STANDARD_GENERATION_MAX_TOKENS = 1024;
const ULTRA_LONG_GENERATION_MAX_TOKENS = 1536;
const MAX_SKILL_TEXT_LENGTH = 1200;
const MAX_SKILL_FILE_TEXT_LENGTH = 800;
const MAX_SOURCE_TEXT_LENGTH = 1800;
const MAX_AMMO_ENTRIES = 20;
const MAX_AMMO_DESCRIPTION_LENGTH = 160;
const MODEL_GENERATION_TIMEOUT_MS = 180_000;
const MAX_GENERATION_PROMPT_LENGTH = 12_000;
const OVERLONG_SOURCE_TEXT_LENGTH = 600;
const OVERLONG_NEARBY_COMMENTS_LENGTH = 800;
const OVERLONG_AMMO_ENTRIES = 8;
const OVERLONG_AMMO_DESCRIPTION_LENGTH = 80;
const OVERLONG_SKILL_TEXT_LENGTH = 900;
const OVERLONG_SKILL_FILE_TEXT_LENGTH = 600;
const OVERLONG_SELECTED_SAMPLE_LENGTH = 600;
const OPENCODE_DEEPSEEK_COMPACT_MAX_TOKENS = 1024;

function generationMaxTokens(lengthConstraint: LengthConstraint): number {
  if (lengthConstraint.maxChars <= 30) return SHORT_GENERATION_MAX_TOKENS;
  if ((lengthConstraint.targetChars ?? lengthConstraint.maxChars) > 120 || lengthConstraint.maxChars > 130) {
    return ULTRA_LONG_GENERATION_MAX_TOKENS;
  }
  return STANDARD_GENERATION_MAX_TOKENS;
}

function modelCandidateCount(lengthConstraint: LengthConstraint): number {
  return lengthConstraint.targetChars !== undefined && lengthConstraint.targetChars >= 80
    ? RETURN_CANDIDATE_COUNT
    : MODEL_CANDIDATE_COUNT;
}

type PromptContext = {
  sourceTitle: string;
  sourceText: string;
  skill: SkillDetail | null;
  skillText: string;
  styleProfileText: string;
  attackPlaybookText: string;
  ammo: AmmoEntry[];
  selectedSampleText: string;
};

type CandidateAttemptStage = "primary" | "repair";
type CandidateFailureReason = "content_empty" | "output_truncated" | "invalid_output" | "insufficient_candidates" | "model_request_failed";
type CandidateAttemptFailure = {
  ok: false;
  stage: CandidateAttemptStage;
  reason: CandidateFailureReason;
  detail: string;
  acceptedCandidates: string[];
  rejectedCandidates: string[];
  rawCandidateCount: number;
};
type CandidateAttemptSuccess = {
  ok: true;
  candidates: string[];
  rawCandidateCount: number;
};
type CandidateAttemptResult = CandidateAttemptSuccess | CandidateAttemptFailure;
type AttemptDiagnostics = {
  provider: string;
  model: string;
  promptLength: number;
  maxTokens: number;
  stream: boolean;
};

export async function generateCandidates(request: GenerateRequest): Promise<GenerateResponse> {
  const [apiKey, model, promptContext] = await Promise.all([
    getRawApiKey(),
    getDefaultModelConfig(),
    buildPromptContext(request),
  ]);
  if (!apiKey || !model) {
    throw new Error("generation_model_required");
  }

  const lengthConstraint = resolveLengthConstraint(request.settings);
  const candidateCount = modelCandidateCount(lengthConstraint);
  const maxTokens = generationMaxTokens(lengthConstraint);
  const resolvedModel = { ...model, model_name: model.model_name || (await getSettings()).model };
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
  if (shouldUseOpenCodeDeepSeekCompactStrategy(resolvedModel, lengthConstraint)) {
    return {
      candidates: await generateOpenCodeDeepSeekCompactCandidates(request, promptContext, lengthConstraint, resolvedModel, apiKey),
    };
  }
  const userPrompt = buildUserPrompt(request, promptContext, lengthConstraint, candidateCount);
  const diagnostics = generationDiagnostics(resolvedModel.provider, resolvedModel.model_name, userPrompt, maxTokens, true);

  const primary = await runCandidateAttempt("primary", request, lengthConstraint, diagnostics, async () => (
    requestModelCompletion(resolvedModel, apiKey, {
      system: buildGenerationSystemPrompt(candidateCount, strictLengthInstruction(lengthConstraint, candidateCount)),
      user: userPrompt,
      temperature: 0.8,
      maxTokens,
      timeoutMs: MODEL_GENERATION_TIMEOUT_MS,
      stream: true,
    })
  ));
  if (primary.ok) return { candidates: primary.candidates };
  if (shouldStopWithoutRepair(primary)) {
    throwGenerationFailure(primary);
  }
  if (primary.reason === "model_request_failed" && !isRetryableModelRequestFailure(primary)) {
    throwGenerationFailure(primary);
  }

  const repairPrompt = buildRepairPrompt(request, promptContext, primary.acceptedCandidates, primary.rejectedCandidates, lengthConstraint, candidateCount, primary.detail);
  const repair = await runCandidateAttempt("repair", request, lengthConstraint, {
    ...diagnostics,
    promptLength: countChars(repairPrompt),
  }, async () => (
    requestModelCompletion(resolvedModel, apiKey, {
      system: buildRepairSystemPrompt(strictLengthInstruction(lengthConstraint, candidateCount)),
      user: repairPrompt,
      temperature: 0.4,
      maxTokens,
      timeoutMs: MODEL_GENERATION_TIMEOUT_MS,
      stream: true,
    })
  ), primary.acceptedCandidates);
  if (repair.ok) return { candidates: repair.candidates };
  if (shouldStopWithoutRepair(repair)) {
    throwGenerationFailure(repair);
  }
  throwGenerationFailure(repair);
}

async function generateOpenCodeDeepSeekCompactCandidates(
  request: GenerateRequest,
  promptContext: PromptContext,
  lengthConstraint: LengthConstraint,
  resolvedModel: ModelConfig,
  apiKey: string,
): Promise<string[]> {
  const prompts = buildOpenCodeDeepSeekCompactPrompts(request, promptContext, lengthConstraint);
  const maxTokens = Math.min(generationMaxTokens(lengthConstraint), OPENCODE_DEEPSEEK_COMPACT_MAX_TOKENS);
  const attempts = await runOpenCodeDeepSeekCompactBatch(
    "primary",
    prompts,
    request,
    lengthConstraint,
    resolvedModel,
    apiKey,
    maxTokens,
  );

  let candidates = mergeUniqueCandidates(
    attempts.flatMap((attempt) => attempt.ok ? attempt.candidates : attempt.acceptedCandidates),
  );
  if (candidates.length >= RETURN_CANDIDATE_COUNT) return candidates.slice(0, RETURN_CANDIDATE_COUNT);

  const repairPrompts = buildOpenCodeDeepSeekCompactRepairPrompts(
    request,
    promptContext,
    lengthConstraint,
    attempts,
    candidates,
  );
  const repairs = repairPrompts.length > 0
    ? await runOpenCodeDeepSeekCompactBatch(
      "repair",
      repairPrompts,
      request,
      lengthConstraint,
      resolvedModel,
      apiKey,
      maxTokens,
    )
    : [];
  candidates = mergeUniqueCandidates([
    ...candidates,
    ...repairs.flatMap((attempt) => attempt.ok ? attempt.candidates : attempt.acceptedCandidates),
  ]);
  if (candidates.length >= RETURN_CANDIDATE_COUNT) return candidates.slice(0, RETURN_CANDIDATE_COUNT);

  const failure = compactFailure([...attempts, ...repairs], candidates);
  throwGenerationFailure(failure);
}

async function runOpenCodeDeepSeekCompactBatch(
  stage: CandidateAttemptStage,
  prompts: CompactPrompt[],
  request: GenerateRequest,
  lengthConstraint: LengthConstraint,
  resolvedModel: ModelConfig,
  apiKey: string,
  maxTokens: number,
): Promise<CandidateAttemptResult[]> {
  return Promise.all(prompts.map(async (prompt) => {
    const diagnostics = generationDiagnostics(
      resolvedModel.provider,
      resolvedModel.model_name,
      prompt.user,
      maxTokens,
      true,
    );
    try {
      const completion = await requestModelCompletion(resolvedModel, apiKey, {
        system: prompt.system,
        user: prompt.user,
        temperature: prompt.temperature,
        maxTokens,
        timeoutMs: MODEL_GENERATION_TIMEOUT_MS,
        stream: true,
      });
      const result = evaluateCompactCompletion(stage, completion, request.target.text, lengthConstraint);
      debugCandidateAttempt(stage, diagnostics, completion, result);
      return result;
    } catch (error) {
      const result: CandidateAttemptFailure = {
        ok: false,
        stage,
        reason: "model_request_failed",
        detail: redactModelError(error),
        acceptedCandidates: [],
        rejectedCandidates: [],
        rawCandidateCount: 0,
      };
      debugCandidateAttempt(stage, diagnostics, undefined, result);
      return result;
    }
  }));
}

function shouldUseCommentAgentPipeline(
  model: { model_name: string; base_url: string },
  lengthConstraint: LengthConstraint,
): boolean {
  return lengthConstraint.targetChars !== undefined
    && lengthConstraint.targetChars >= 80
    && model.base_url.toLowerCase().includes("opencode.ai/zen/go")
    && /deepseek/i.test(model.model_name);
}

function shouldUseOpenCodeDeepSeekCompactStrategy(
  _model: { model_name: string; base_url: string },
  _lengthConstraint: LengthConstraint,
): boolean {
  return false;
}

function shouldStopWithoutRepair(failure: CandidateAttemptFailure): boolean {
  return failure.reason === "output_truncated";
}

function isRetryableModelRequestFailure(failure: CandidateAttemptFailure): boolean {
  return failure.reason === "model_request_failed"
    && /timeout|timed out|failed to fetch|network|abort/i.test(failure.detail);
}

async function runCandidateAttempt(
  stage: CandidateAttemptStage,
  request: GenerateRequest,
  lengthConstraint: LengthConstraint,
  diagnostics: AttemptDiagnostics,
  callModel: () => Promise<ModelCompletion>,
  existingCandidates: string[] = [],
): Promise<CandidateAttemptResult> {
  try {
    const completion = await callModel();
    const result = evaluateCompletion(stage, completion, request.target.text, lengthConstraint, existingCandidates);
    debugCandidateAttempt(stage, diagnostics, completion, result);
    return result;
  } catch (error) {
    const result: CandidateAttemptFailure = {
      ok: false,
      stage,
      reason: "model_request_failed",
      detail: redactModelError(error),
      acceptedCandidates: existingCandidates,
      rejectedCandidates: [],
      rawCandidateCount: existingCandidates.length,
    };
    debugCandidateAttempt(stage, diagnostics, undefined, result);
    return result;
  }
}

function evaluateCompletion(
  stage: CandidateAttemptStage,
  completion: ModelCompletion,
  targetText: string,
  lengthConstraint: LengthConstraint,
  existingCandidates: string[] = [],
): CandidateAttemptResult {
  if (completion.finishReason === "length") {
    return failure(stage, "output_truncated", completion, existingCandidates);
  }
  if (!completion.content.trim()) {
    return failure(stage, "content_empty", completion, existingCandidates);
  }
  const parsed = parseCandidateOutput(completion.content);
  if (!parsed.ok) {
    return {
      ok: false,
      stage,
      reason: "invalid_output",
      detail: `invalid_output:${parsed.detail}; content_length=${countChars(completion.content)}; reasoning_length=${countChars(completion.reasoningContent)}; transport=${completion.transport}`,
      acceptedCandidates: existingCandidates,
      rejectedCandidates: [],
      rawCandidateCount: existingCandidates.length,
    };
  }
  const candidates = normalizeCandidates([...existingCandidates, ...parsed.candidates], targetText, lengthConstraint);
  if (candidates.length >= RETURN_CANDIDATE_COUNT) {
    return {
      ok: true,
      candidates: candidates.slice(0, RETURN_CANDIDATE_COUNT),
      rawCandidateCount: existingCandidates.length + parsed.candidates.length,
    };
  }
  return {
    ok: false,
    stage,
    reason: "insufficient_candidates",
    detail: `insufficient_candidates: accepted=${candidates.length}; raw=${existingCandidates.length + parsed.candidates.length}; content_length=${countChars(completion.content)}; reasoning_length=${countChars(completion.reasoningContent)}; transport=${completion.transport}${candidateLengthDiagnostic(parsed.candidates, lengthConstraint)}`,
    acceptedCandidates: candidates,
    rejectedCandidates: parsed.candidates,
    rawCandidateCount: existingCandidates.length + parsed.candidates.length,
  };
}

function evaluateCompactCompletion(
  stage: CandidateAttemptStage,
  completion: ModelCompletion,
  targetText: string,
  lengthConstraint: LengthConstraint,
): CandidateAttemptResult {
  if (!completion.content.trim()) {
    return failure(
      stage,
      completion.finishReason === "length" ? "output_truncated" : "content_empty",
      completion,
      [],
    );
  }
  const parsed = parseCandidateOutput(completion.content);
  if (!parsed.ok) {
    return {
      ok: false,
      stage,
      reason: "invalid_output",
      detail: `invalid_output:${parsed.detail}; content_length=${countChars(completion.content)}; reasoning_length=${countChars(completion.reasoningContent)}; transport=${completion.transport}`,
      acceptedCandidates: [],
      rejectedCandidates: [],
      rawCandidateCount: 0,
    };
  }
  const candidates = normalizeCandidates(parsed.candidates, targetText, lengthConstraint);
  if (candidates.length > 0) {
    return {
      ok: true,
      candidates,
      rawCandidateCount: parsed.candidates.length,
    };
  }
  return {
    ok: false,
    stage,
    reason: "insufficient_candidates",
    detail: `insufficient_candidates: accepted=0; raw=${parsed.candidates.length}; content_length=${countChars(completion.content)}; reasoning_length=${countChars(completion.reasoningContent)}; transport=${completion.transport}${candidateLengthDiagnostic(parsed.candidates, lengthConstraint)}`,
    acceptedCandidates: [],
    rejectedCandidates: parsed.candidates,
    rawCandidateCount: parsed.candidates.length,
  };
}

function compactFailure(attempts: CandidateAttemptResult[], candidates: string[]): CandidateAttemptFailure {
  const failed = attempts.filter((attempt): attempt is CandidateAttemptFailure => !attempt.ok);
  const detail = [
    `opencode_compact_attempts=${attempts.length}`,
    `accepted=${candidates.length}`,
    ...failed.slice(0, 3).map((attempt) => `${attempt.reason}:${attempt.detail}`),
  ].join("; ");
  return {
    ok: false,
    stage: "primary",
    reason: candidates.length > 0 ? "insufficient_candidates" : failed[0]?.reason ?? "insufficient_candidates",
    detail,
    acceptedCandidates: candidates,
    rejectedCandidates: failed.flatMap((attempt) => attempt.rejectedCandidates).slice(0, MODEL_CANDIDATE_COUNT),
    rawCandidateCount: attempts.reduce((sum, attempt) => sum + attempt.rawCandidateCount, 0),
  };
}

function mergeUniqueCandidates(candidates: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeForCompare(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(candidate);
  }
  return result;
}

function candidateLengthDiagnostic(candidates: string[], lengthConstraint: LengthConstraint): string {
  if (candidates.length === 0) return "";
  const lengths = candidates.map((candidate) => countChars(candidate.trim())).join(",");
  const min = lengthConstraint.minChars ?? 1;
  return `; 候选长度=${lengths}; 要求范围=${min}-${lengthConstraint.maxChars}`;
}

function failure(
  stage: CandidateAttemptStage,
  reason: CandidateFailureReason,
  completion: ModelCompletion,
  acceptedCandidates: string[],
): CandidateAttemptFailure {
  return {
    ok: false,
    stage,
    reason,
    detail: `${reason}: finish_reason=${completion.finishReason ?? "unknown"}; content_length=${countChars(completion.content)}; reasoning_length=${countChars(completion.reasoningContent)}; transport=${completion.transport}`,
    acceptedCandidates,
    rejectedCandidates: [],
    rawCandidateCount: acceptedCandidates.length,
  };
}

function parseCandidateOutput(content: string): { ok: true; candidates: string[] } | { ok: false; detail: string } {
  const json = parseCandidateJson(content);
  if (json.ok) return json;
  const lineCandidates = parseCandidateLines(content);
  if (lineCandidates.length > 0) return { ok: true, candidates: lineCandidates };
  return { ok: false, detail: `${json.detail}; no_candidate_lines` };
}

function parseCandidateJson(content: string): { ok: true; candidates: string[] } | { ok: false; detail: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripOutputFence(content));
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "parse_failed" };
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { candidates?: unknown }).candidates)) {
    return { ok: false, detail: "missing_candidates_array" };
  }
  const candidates = (parsed as { candidates: unknown[] }).candidates
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  return { ok: true, candidates };
}

function parseCandidateLines(content: string): string[] {
  return stripOutputFence(content)
    .replace(/\s+(?=(?:[-*•]\s+|\d{1,2}[.)、]\s+|[（(]?\d{1,2}[）)]\s+|[一二三四五六七八九十]+[、.)]\s+))/g, "\n")
    .split(/\r?\n/)
    .map(cleanCandidateLine)
    .filter((line) => line.length > 0 && !isNonCandidateLine(line));
}

function cleanCandidateLine(line: string): string {
  return line
    .trim()
    .replace(/^(?:[-*•]\s*|\d{1,2}[.)、]\s*|[（(]?\d{1,2}[）)]\s*|[一二三四五六七八九十]+[、.)]\s*)/, "")
    .replace(/^候选\s*[一二三四五六七八九十\d]*\s*[:：]\s*/, "")
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .trim();
}

function isNonCandidateLine(line: string): boolean {
  return /^(```|以下|好的|当然|输出要求|长度要求|平台[:：]|目标评论[:：]|意图[:：])/i.test(line);
}

function stripOutputFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json|text)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function throwGenerationFailure(failure: CandidateAttemptFailure): never {
  throw new Error(`generation_failed:${failure.reason}; stage=${failure.stage}; ${failure.detail}`);
}

function generationDiagnostics(
  provider: string,
  model: string,
  prompt: string,
  maxTokens: number,
  stream: boolean,
): AttemptDiagnostics {
  return {
    provider,
    model,
    promptLength: countChars(prompt),
    maxTokens,
    stream,
  };
}

function debugCandidateAttempt(
  stage: CandidateAttemptStage,
  diagnostics: AttemptDiagnostics,
  completion: ModelCompletion | undefined,
  result: CandidateAttemptResult,
): void {
  const accepted = result.ok ? result.candidates.length : result.acceptedCandidates.length;
  console.debug("[clapback:generation]", {
    stage,
    provider: diagnostics.provider,
    model: diagnostics.model,
    promptLength: diagnostics.promptLength,
    maxTokens: diagnostics.maxTokens,
    stream: diagnostics.stream,
    finishReason: completion ? completion.finishReason ?? "unknown" : "request_failed",
    contentLength: completion ? countChars(completion.content) : 0,
    reasoningLength: completion ? countChars(completion.reasoningContent) : 0,
    accepted,
    rejected: Math.max(0, result.rawCandidateCount - accepted),
    reason: result.ok ? "ok" : result.reason,
  });
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
    if (!isWithinLengthConstraint(text, lengthConstraint)) continue;
    seen.add(normalized);
    result.push(text);
  }
  return result;
}

async function buildPromptContext(request: GenerateRequest): Promise<PromptContext> {
  const ammoBoxIds = request.settings.ammoBoxIds ?? [];
  const [skill, ammo, settings] = await Promise.all([
    loadSkill(request.settings.activeSkillId),
    ammoBoxIds.length > 0 ? loadAmmo(ammoBoxIds) : Promise.resolve([]),
    getSettings(),
  ]);
  const samples = samplesFromSkillDetail(skill);
  const selections = settings.skill_sample_selections ?? {};
  const skillId = request.settings.activeSkillId;
  const selectedSample = selectSampleForLength(samples, selections[skillId], request.settings);
  return {
    sourceTitle: truncate(request.context.sourceTitle ?? "", MAX_SOURCE_TEXT_LENGTH),
    sourceText: truncate(request.context.sourceText ?? "", MAX_SOURCE_TEXT_LENGTH),
    skill,
    skillText: truncate(skill?.skill_md ?? "", MAX_SKILL_TEXT_LENGTH),
    styleProfileText: skillFileText(skill, "style_profile.json"),
    attackPlaybookText: skillFileText(skill, "attack_playbook.json"),
    ammo,
    selectedSampleText: formatSelectedSampleForPrompt(selectedSample),
  };
}

function skillFileText(skill: SkillDetail | null, name: string): string {
  const value = skill?.files?.[name];
  return typeof value === "string" ? truncate(value, MAX_SKILL_FILE_TEXT_LENGTH) : "";
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
  promptContext: PromptContext,
  lengthConstraint: LengthConstraint,
  candidateCount: number,
): string {
  const normal = renderUserPrompt(request, promptContext, lengthConstraint, candidateCount, "normal");
  if (countChars(normal) <= MAX_GENERATION_PROMPT_LENGTH) return normal;

  const contextTrimmed = renderUserPrompt(request, promptContext, lengthConstraint, candidateCount, "trimContext");
  if (countChars(contextTrimmed) <= MAX_GENERATION_PROMPT_LENGTH) return contextTrimmed;

  const skillTrimmed = renderUserPrompt(request, promptContext, lengthConstraint, candidateCount, "trimSkill");
  if (countChars(skillTrimmed) <= MAX_GENERATION_PROMPT_LENGTH) return skillTrimmed;

  return trimChars(skillTrimmed, MAX_GENERATION_PROMPT_LENGTH);
}

type PromptRenderMode = "normal" | "trimContext" | "trimSkill";

function renderUserPrompt(
  request: GenerateRequest,
  promptContext: PromptContext,
  lengthConstraint: LengthConstraint,
  candidateCount: number,
  mode: PromptRenderMode,
): string {
  const sourceText = mode === "normal"
    ? promptContext.sourceText
    : truncate(promptContext.sourceText, OVERLONG_SOURCE_TEXT_LENGTH);
  const nearbyComments = mode === "normal"
    ? request.context.nearbyComments.join(" / ")
    : truncate(request.context.nearbyComments.join(" / "), OVERLONG_NEARBY_COMMENTS_LENGTH);
  return [
    `平台: ${request.platform}`,
    `目标评论: ${request.target.text}`,
    `意图: ${request.intent || "反驳"}`,
    `优先级: 用户意图是最高优先级；目标评论只是素材和上下文；攻击焦点必须从用户意图中选择。`,
    `输出要求: 输出 ${candidateCount} 条候选；每条候选独立一行，并以 ${candidateNumberList(candidateCount)} 开头；不要解释；不要 Markdown 代码块；不要复读目标评论。系统只采纳前 ${RETURN_CANDIDATE_COUNT} 条合格候选。`,
    `长度要求: ${lengthConstraint.label}`,
    strictLengthInstruction(lengthConstraint, candidateCount),
    `上下文标题: ${request.context.pageTitle}`,
    promptContext.sourceTitle ? `来源标题: ${promptContext.sourceTitle}` : "",
    sourceText ? `来源正文: ${sourceText}` : "",
    nearbyComments ? `附近评论: ${nearbyComments}` : "",
    renderSkillBlock(promptContext, mode),
    mode === "trimSkill" ? truncate(promptContext.selectedSampleText, OVERLONG_SELECTED_SAMPLE_LENGTH) : promptContext.selectedSampleText,
    renderAmmoBlock(promptContext.ammo, mode),
    `长度: ${request.settings.lengthMode}`,
  ].filter(Boolean).join("\n");
}

type CompactPrompt = {
  system: string;
  user: string;
  temperature: number;
};

function buildOpenCodeDeepSeekCompactPrompts(
  request: GenerateRequest,
  promptContext: PromptContext,
  lengthConstraint: LengthConstraint,
): CompactPrompt[] {
  const style = compactSkillStyle(request, promptContext);
  const writeInstruction = compactWriteInstruction(request, lengthConstraint);
  const context = compactSourceContext(request, promptContext);
  const targetText = compactTargetText(request);
  return compactAngles().map((angle, index) => ({
    system: "只输出一条中文评论正文，不解释，不编号，不要 JSON，不要 Markdown。",
    user: [
      `平台: ${request.platform}`,
      `目标评论摘录: ${targetText}`,
      `用户意图: ${request.intent || "反驳"}`,
      "优先级: 用户意图最高；目标评论只是素材；攻击焦点从用户意图中选择。",
      context,
      style,
      `角度: ${angle}`,
      writeInstruction,
      compactLengthRangeInstruction(lengthConstraint),
      `候选序号: ${index + 1}`,
    ].filter(Boolean).join("\n"),
    temperature: request.settings.activeSkillId === "wenyan_attack" ? 0.3 : 0.5,
  }));
}

function buildOpenCodeDeepSeekCompactRepairPrompts(
  request: GenerateRequest,
  promptContext: PromptContext,
  lengthConstraint: LengthConstraint,
  attempts: CandidateAttemptResult[],
  acceptedCandidates: string[],
): CompactPrompt[] {
  const seeds = mergeUniqueCandidates(
    attempts
      .filter((attempt): attempt is CandidateAttemptFailure => !attempt.ok)
      .flatMap((attempt) => attempt.rejectedCandidates)
      .filter((candidate) => candidate.trim().length > 0),
  ).slice(0, MODEL_CANDIDATE_COUNT + 2);
  const style = compactSkillStyle(request, promptContext);
  const target = lengthConstraint.targetChars ?? lengthConstraint.maxChars;
  const lengthRange = compactLengthRangeInstruction(lengthConstraint);
  const targetText = compactTargetText(request);
  const seedPrompts = seeds.map((seed, index) => ({
    system: "只输出一条中文评论正文，不解释，不编号，不要 JSON，不要 Markdown。",
    user: [
      `短候选: ${seed}`,
      `目标评论摘录: ${targetText}`,
      `用户意图: ${request.intent || "反驳"}`,
      style,
      request.settings.activeSkillId === "wenyan_attack"
        ? `任务: 保留短候选观点和文言风格，扩成接近 ${target} 字；加一句白话解释说明目标说法为什么盖不过真实伤害；不要精确数数，宁可略完整；明显超过硬上限会被要求压缩，不会直接截断半句。`
        : `任务: 保留短候选观点和 Skill 语气，扩成接近 ${target} 字；增加一个具体因果解释；不要精确数数，宁可略完整；明显超过硬上限会被要求压缩，不会直接截断半句。`,
      lengthRange,
      `修复序号: ${index + 1}`,
    ].join("\n"),
    temperature: request.settings.activeSkillId === "wenyan_attack" ? 0.25 : 0.35,
  }));
  const missing = Math.max(RETURN_CANDIDATE_COUNT - acceptedCandidates.length, 1);
  const directPrompts = compactAngles().slice(0, Math.max(8, missing * 4)).map((angle, index) => ({
    system: "只输出一条中文评论正文，不解释，不编号，不要 JSON，不要 Markdown。",
    user: [
      `任务: 补足缺失候选，写一条新的模型候选。`,
      `目标评论摘录: ${targetText}`,
      `用户意图: ${request.intent || "反驳"}`,
      "不要重复已合格候选。",
      acceptedCandidates.length ? `已合格候选:\n${acceptedCandidates.map((candidate, i) => `${i + 1}. ${candidate}`).join("\n")}` : "",
      style,
      `角度: ${angle}`,
      request.settings.activeSkillId === "wenyan_attack"
        ? `写法: 半文半白，接近 ${target} 字；指出情感操控、金钱压榨或心理崩溃不能被作息问题盖过；明显超过硬上限会被要求压缩，不会直接截断半句。`
        : `写法: 接近 ${target} 字；用一个具体因果解释拆掉目标偷换；明显超过硬上限会被要求压缩，不会直接截断半句。`,
      lengthRange,
      `补位序号: ${index + 1}`,
    ].filter(Boolean).join("\n"),
    temperature: request.settings.activeSkillId === "wenyan_attack" ? 0.25 : 0.35,
  }));
  return [...seedPrompts, ...directPrompts];
}

function compactAngles(): string[] {
  return [
    "抓偷换概念：把复杂关系伤害说成简单身体状态。",
    "抓关系控制：指出长期操控不是吃饭睡觉能解决。",
    "抓金钱压榨：把经济剥削和心理崩溃说清楚。",
    "抓责任转移：说明这种简化是在替真实伤害卸责。",
    "抓概念降维：把深层创伤压成作息问题，本身就荒谬。",
    "抓收束结论：用一句有力结尾压住对方偷换。",
    "抓表层建议：说明吃饭睡觉只是表层照顾，解释不了剥削链条。",
    "抓具体事实：把目标里的具体说法拉回来，指出它绕开了操控与压榨。",
    "抓心理创伤：说明身体疲惫可以恢复，长期被控制后的崩塌不能被抹平。",
    "抓反向推演：按对方逻辑推下去，显示它会把真实伤害洗成生活小毛病。",
    "抓承重前提：指出对方把最后的疲惫当成全部原因。",
    "抓因果链条：把操控、索取、崩溃之间的顺序讲清楚。",
    "抓避重就轻：说明表面关心身体，实际避开关系里的剥削。",
    "抓受害者视角：强调被持续消耗的人不是补觉就能脱身。",
    "抓荒谬类比：用一个具体比喻拆掉身体状态解释一切的说法。",
    "抓讨论边界：区分身体照顾有用和它不能解释真实伤害。",
  ];
}

function compactTargetText(request: GenerateRequest): string {
  return truncate(request.target.text, 420);
}

function compactSourceContext(request: GenerateRequest, promptContext: PromptContext): string {
  const source = promptContext.sourceText || request.context.pageTitle;
  return source ? `上下文摘录: ${truncate(source, 120)}` : "";
}

function compactSkillStyle(request: GenerateRequest, promptContext: PromptContext): string {
  const skill = promptContext.skill;
  if (!skill) return "Skill风格: 直接反驳，具体、有力，不写泛泛套话。";
  if (request.settings.activeSkillId === "wenyan_attack" || skill.name.includes("文言")) {
    return [
      "Skill风格: 文言；半文半白，现代人能看懂。",
      "要点: 像古代判词但不要掉书袋；可用“舍本逐末”“岂不谬哉”；文雅诛心，以判词收尾。",
    ].join("\n");
  }
  if (request.settings.activeSkillId === "full_fire") {
    return "Skill风格: 焚锋；直接、嘲讽、攻击性强，可以反问和狠收尾，但必须抓住逻辑漏洞，不要空骂。";
  }
  if (request.settings.activeSkillId === "restrained_breakdown") {
    return "Skill风格: 静辨；冷静拆前提，用具体画面说明偷换，结尾一刀见骨。";
  }
  if (request.settings.activeSkillId === "sarcastic_ironic") {
    return "Skill风格: 冷讥；可以假赞同、荒谬化、反话推进，最后必须转向反驳目标。";
  }
  return [
    `Skill: ${skill.name}`,
    `目标: ${truncate(skill.goal, 160)}`,
    `摘要: ${truncate(skill.summary, 180)}`,
  ].join("\n");
}

function compactWriteInstruction(request: GenerateRequest, lengthConstraint: LengthConstraint): string {
  const target = lengthConstraint.targetChars ?? lengthConstraint.maxChars;
  if (request.settings.activeSkillId === "wenyan_attack") {
    return [
      `写法: 接近 ${target} 字；不要精确数数，宁可略完整；明显超过硬上限会被要求压缩，不会直接截断半句。`,
      "结构: 判词开头，指出情感操控/金钱压榨/心理崩溃，再加一句白话解释说明目标说法为什么盖不过关系中的真实伤害。",
    ].join("\n");
  }
  return [
    `写法: 三到四个分句，接近 ${target} 字；不要精确数数，宁可略完整；明显超过硬上限会被要求压缩，不会直接截断半句。`,
    "内容: 至少包含一个具体因果解释，不要短梗，不要复读目标评论。",
  ].join("\n");
}

function compactLengthRangeInstruction(lengthConstraint: LengthConstraint): string {
  if (lengthConstraint.minChars !== undefined) {
    return `硬性长度: 至少 ${lengthConstraint.minChars} 个汉字，不超过 ${lengthConstraint.maxChars} 个汉字；少于下限会被丢弃，明显超过硬上限会被要求压缩，不会直接截断半句。`;
  }
  return `硬性长度: 不超过 ${lengthConstraint.maxChars} 个汉字；超过上限会被丢弃。`;
}

function strictLengthInstruction(lengthConstraint: LengthConstraint, candidateCount: number): string {
  const longTargetRule = lengthConstraint.targetChars !== undefined && lengthConstraint.targetChars >= 80
    ? `长目标写法: 直接输出最终候选，不要先写超长草稿；每条围绕目标文本的一到两个具体点展开，用 3 到 5 个分句说清漏洞、影响和收束结论；不要解释推理过程。`
    : "";
  if (lengthConstraint.minChars !== undefined) {
    return `硬性字数: 每条候选最终必须落在 ${lengthConstraint.minChars} 到 ${lengthConstraint.maxChars} 个汉字；这是每条候选单独计数，不是 ${candidateCount} 条合计；少于 ${lengthConstraint.minChars} 会被丢弃，明显超过硬上限会被要求压缩，不会直接截断半句。短句不是短回复；如果 Skill 要求短句，只能把一条候选拆成多句，不能少于下限。${longTargetRule}`;
  }
  return `硬性字数: 每条候选必须${lengthConstraint.label}；这是每条候选单独计数，不是 ${candidateCount} 条合计；超过上限会被丢弃。短句不是短回复；如果 Skill 要求短句，只能把一条候选拆成多句。${longTargetRule}`;
}

function candidateNumberList(candidateCount: number): string {
  return Array.from({ length: candidateCount }, (_, index) => `${index + 1}.`).join("、");
}

function renderSkillBlock(promptContext: PromptContext, mode: PromptRenderMode): string {
  if (!promptContext.skill) return "";
  const skillText = mode === "trimSkill"
    ? truncate(promptContext.skillText, OVERLONG_SKILL_TEXT_LENGTH)
    : promptContext.skillText;
  const styleProfileText = mode === "trimSkill"
    ? truncate(promptContext.styleProfileText, OVERLONG_SKILL_FILE_TEXT_LENGTH)
    : promptContext.styleProfileText;
  const attackPlaybookText = mode === "trimSkill"
    ? truncate(promptContext.attackPlaybookText, OVERLONG_SKILL_FILE_TEXT_LENGTH)
    : promptContext.attackPlaybookText;
  return [
    "Skill:",
    `名称: ${promptContext.skill.name}`,
    `目标: ${promptContext.skill.goal}`,
    `摘要: ${promptContext.skill.summary}`,
    `说明: ${skillText}`,
    styleProfileText ? `style_profile.json:\n${styleProfileText}` : "",
    attackPlaybookText ? `attack_playbook.json:\n${attackPlaybookText}` : "",
  ].filter(Boolean).join("\n");
}

function renderAmmoBlock(ammo: AmmoEntry[], mode: PromptRenderMode): string {
  if (ammo.length === 0) return "";
  const entries = mode === "normal" ? ammo : ammo.slice(0, OVERLONG_AMMO_ENTRIES);
  const descriptionLimit = mode === "normal" ? MAX_AMMO_DESCRIPTION_LENGTH : OVERLONG_AMMO_DESCRIPTION_LENGTH;
  return [
    "弹药:",
    ...entries.map((entry) => `- ${entry.term}: ${truncate(entry.description, descriptionLimit)}`),
  ].join("\n");
}

function buildRepairPrompt(
  request: GenerateRequest,
  promptContext: PromptContext,
  acceptedCandidates: string[],
  rejectedCandidates: string[],
  lengthConstraint: LengthConstraint,
  candidateCount: number,
  diagnostic: string,
): string {
  const sourceText = truncate(promptContext.sourceText, OVERLONG_SOURCE_TEXT_LENGTH);
  return [
    "任务: 修复上一轮候选；不要重新短写；优先解决失败诊断。保留模型已写出的语气和攻击角度，但必须把每条扩写到长度要求。",
    `平台: ${request.platform}`,
    `目标评论: ${request.target.text}`,
    `意图: ${request.intent || "反驳"}`,
    `优先级: 用户意图是最高优先级；目标评论只是素材和上下文；攻击焦点必须从用户意图中选择。`,
    `输出要求: 输出 ${candidateCount} 条候选；每条候选独立一行，并以 ${candidateNumberList(candidateCount)} 开头；不要解释；不要 Markdown 代码块；不要复读目标评论。系统只采纳前 ${RETURN_CANDIDATE_COUNT} 条合格候选。`,
    `长度要求: ${lengthConstraint.label}`,
    strictLengthInstruction(lengthConstraint, candidateCount),
    `上下文标题: ${request.context.pageTitle}`,
    promptContext.sourceTitle ? `来源标题: ${promptContext.sourceTitle}` : "",
    sourceText ? `来源正文摘录: ${sourceText}` : "",
    renderRepairSkillSummary(promptContext),
    acceptedCandidates.length > 0
      ? `已合格候选: ${acceptedCandidates.join(" / ")}`
      : "首次生成全部不满足要求（长度/重复/同目标）。",
    `失败诊断: ${diagnostic}`,
    "上一次输出存在空内容、截断、格式不可解析、重复、超长、过短或数量不足。",
    renderRejectedCandidateBlock(rejectedCandidates, candidateCount),
    renderRepairExpansionInstruction(rejectedCandidates, lengthConstraint),
    lengthConstraint.minChars !== undefined
      ? `修复重点: 每条候选必须落在 ${lengthConstraint.minChars}-${lengthConstraint.maxChars} 个汉字；如果失败诊断显示候选长度低于下限，必须扩写，不要再输出短梗。`
      : `修复重点: 每条候选不得超过 ${lengthConstraint.maxChars} 个汉字。`,
    acceptedCandidates.length > 0
      ? `只补足缺失候选，不要重复已合格候选；至少补 ${Math.max(1, RETURN_CANDIDATE_COUNT - acceptedCandidates.length)} 条，每条独立一行，必须${lengthConstraint.label}。`
      : `请重新输出 ${candidateCount} 条候选，每条独立一行，必须${lengthConstraint.label}，不要复读目标评论。系统只采纳前 ${RETURN_CANDIDATE_COUNT} 条合格候选。`,
  ].filter(Boolean).join("\n");
}

function renderRepairSkillSummary(promptContext: PromptContext): string {
  if (!promptContext.skill) return "";
  return [
    "Skill:",
    `名称: ${promptContext.skill.name}`,
    `目标: ${promptContext.skill.goal}`,
    `摘要: ${promptContext.skill.summary}`,
    "修复说明: 只保留该 Skill 的语气和攻击方式，不要被样例长度带短；上一轮候选若太短，必须扩写而不是改写成短梗。",
  ].join("\n");
}

function renderRejectedCandidateBlock(rejectedCandidates: string[], candidateCount: number): string {
  if (rejectedCandidates.length === 0) return "";
  return [
    "上次不合格候选（逐条扩写或修正到要求范围，不要照抄短句）:",
    ...rejectedCandidates.slice(0, candidateCount).map((candidate, index) => (
      `${index + 1}. (${countChars(candidate)}字) ${truncate(candidate, 180)}`
    )),
  ].join("\n");
}

function renderRepairExpansionInstruction(rejectedCandidates: string[], lengthConstraint: LengthConstraint): string {
  if (
    rejectedCandidates.length === 0
    || lengthConstraint.minChars === undefined
    || lengthConstraint.targetChars === undefined
    || lengthConstraint.targetChars < 80
  ) {
    return "";
  }
  const lengths = rejectedCandidates.map((candidate) => countChars(candidate.trim())).filter((length) => length > 0);
  if (lengths.length === 0) return "";
  const shortest = Math.min(...lengths);
  if (shortest >= lengthConstraint.minChars) return "";
  const longest = Math.max(...lengths);
  const lengthRange = shortest === longest ? `${shortest}` : `${shortest}-${longest}`;
  return `扩写硬令: 上次候选只有 ${lengthRange} 字，补到 ${lengthConstraint.minChars}-${lengthConstraint.maxChars} 个汉字；每条只补一个具体点或因果解释，再用一句收束，不要写超长草稿。`;
}

function buildGenerationSystemPrompt(candidateCount: number, extra = ""): string {
  return [
    `你是一个中文评论区回复候选生成器。只输出候选文本，每条独立一行；不要 JSON；不要 Markdown；不要解释；候选共 ${candidateCount} 条。系统只采纳前 ${RETURN_CANDIDATE_COUNT} 条合格候选。`,
    INTERNAL_STRATEGY_LABEL_OUTPUT_RULE,
    extra,
  ].filter(Boolean).join("\n");
}

function buildRepairSystemPrompt(extra = ""): string {
  return [
    `你是一个中文评论区回复候选修复器。只输出缺失候选文本，每条独立一行；不要 JSON；不要 Markdown；不要解释。`,
    INTERNAL_STRATEGY_LABEL_OUTPUT_RULE,
    extra,
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

function trimChars(value: string, limit: number): string {
  const chars = [...value.trim()];
  return chars.length > limit ? chars.slice(0, limit).join("") : value.trim();
}

function countChars(value: string): number {
  return [...value].length;
}

function normalizeForCompare(value: string): string {
  return value.replace(/\s+/g, "").replace(/[，。！？、,.!?]/g, "").toLowerCase();
}

function redactModelError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-••••");
}
