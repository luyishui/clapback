import type { GenerateRequest } from "../content/types";
import type { ModelConfig } from "../workbench/runtimeApi";
import type { LengthConstraint } from "./lengthConstraints";
import { isWithinLengthConstraint } from "./lengthConstraints";
import type { ModelCompletion } from "./modelConnection";
import { requestModelCompletion as defaultRequestModelCompletion } from "./modelConnection";
import {
  buildActivationRepairPrompt,
  buildExecutePrompt,
  buildFillPrompt,
  buildRefinePrompt,
  buildSkillActivationPrompt,
} from "./commentAgentPrompts";
import { parseCandidateOutput, parseSkillActivationPlan } from "./commentAgentParsing";
import type {
  CommentAgentPromptContext,
  ExecuteThinkingPolicy,
  ExecutionAngle,
  GenerateCommentAgentPipelineInput,
  PipelineStageName,
  RequestModelCompletion,
  SkillActivationPlan,
} from "./commentAgentTypes";

const RETURN_CANDIDATE_COUNT = 3;
const ACTIVATION_MAX_TOKENS = 2400;
const ACTIVATION_THINKING_MODE: ExecuteThinkingPolicy = "disabled";
const STANDARD_GENERATION_MAX_TOKENS = 1024;
const ULTRA_LONG_GENERATION_MAX_TOKENS = 1536;
const MODEL_GENERATION_TIMEOUT_MS = 180_000;

type CandidateRecord = {
  text: string;
  angle: ExecutionAngle;
  refined: boolean;
};

type BranchResult =
  | { ok: true; candidate: CandidateRecord; completion: ModelCompletion }
  | { ok: false; reason: string; angle: ExecutionAngle; completion?: ModelCompletion; rawCandidates: string[] };

export async function generateCandidatesWithCommentAgentPipeline(input: GenerateCommentAgentPipelineInput): Promise<string[]> {
  const requestModelCompletion = input.requestModelCompletion ?? defaultRequestModelCompletion;
  const activationPrompt = activationPromptForRequest(input.request, input.promptContext, input.lengthConstraint);
  const plan = await activateSkillForTarget({
    prompt: activationPrompt,
    model: input.model,
    apiKey: input.apiKey,
    requestModelCompletion,
  });
  const confirmed = confirmActivationPlan(plan);
  if (!confirmed.ok) {
    const repaired = await repairActivationPlan({
      originalPrompt: activationPrompt,
      invalidContent: JSON.stringify(plan),
      failureDetail: confirmed.detail,
      model: input.model,
      apiKey: input.apiKey,
      requestModelCompletion,
    });
    const repairedConfirmation = confirmActivationPlan(repaired);
    if (!repairedConfirmation.ok) throw new Error(`generation_failed:plan_invalid; ${repairedConfirmation.detail}`);
    return runExecutionPipeline(input, repaired, requestModelCompletion);
  }

  return runExecutionPipeline(input, plan, requestModelCompletion);
}

async function runExecutionPipeline(
  input: GenerateCommentAgentPipelineInput,
  plan: SkillActivationPlan,
  requestModelCompletion: RequestModelCompletion,
): Promise<string[]> {
  const allAngles = uniqueAngles(plan.angles);
  const angles = allAngles.slice(0, RETURN_CANDIDATE_COUNT);
  if (angles.length < RETURN_CANDIDATE_COUNT) throw new Error("generation_failed:plan_invalid; angles_min_3");
  const started = Date.now();
  const executeResults = await Promise.all(angles.map((angle) => executeAngle({
    ...input,
    plan,
    angle,
    requestModelCompletion,
    existingCandidates: [],
  })));

  const candidates: CandidateRecord[] = [];
  const rejected: Array<Extract<BranchResult, { ok: false }>> = [];
  for (const result of executeResults) {
    if (result.ok) {
      candidates.push(result.candidate);
    } else {
      rejected.push(result);
    }
  }

  const fillAngles = [...allAngles.slice(RETURN_CANDIDATE_COUNT), ...angles];
  for (const fillAngle of fillAngles) {
    if (candidates.length >= RETURN_CANDIDATE_COUNT) break;
    const fill = await executeAngle({
      ...input,
      plan,
      angle: fillAngle,
      requestModelCompletion,
      existingCandidates: candidates.map((candidate) => candidate.text),
      stage: "补位",
    });
    if (fill.ok) candidates.push(fill.candidate);
    else rejected.push(fill);
  }

  const unique = mergeUniqueCandidates(candidates.map((candidate) => candidate.text), input.request.target.text);
  if (unique.length >= RETURN_CANDIDATE_COUNT) {
    debugPipelineStage({
      stage: "execute",
      model: input.model,
      promptLength: 0,
      maxTokens: generationMaxTokens(input.lengthConstraint),
      thinkingMode: input.executeThinkingPolicy,
      completion: undefined,
      accepted: RETURN_CANDIDATE_COUNT,
      rejected: rejected.length,
      reason: `ok_total_ms=${Date.now() - started}`,
    });
    return unique.slice(0, RETURN_CANDIDATE_COUNT);
  }

  throw new Error(`generation_failed:insufficient_candidates; accepted=${unique.length}; rejected=${rejected.map((item) => item.reason).join(",")}`);
}

async function activateSkillForTarget(input: {
  prompt: string;
  model: ModelConfig;
  apiKey: string;
  requestModelCompletion: RequestModelCompletion;
}): Promise<SkillActivationPlan> {
  const first = await requestActivation(input.prompt, input.model, input.apiKey, input.requestModelCompletion, "activation");
  const firstParsed = activationFromCompletion(first);
  if (firstParsed.ok) return firstParsed.plan;
  return repairActivationPlan({
    originalPrompt: input.prompt,
    invalidContent: first.content,
    failureDetail: firstParsed.detail,
    model: input.model,
    apiKey: input.apiKey,
    requestModelCompletion: input.requestModelCompletion,
  });
}

async function repairActivationPlan(input: {
  originalPrompt: string;
  invalidContent: string;
  failureDetail: string;
  model: ModelConfig;
  apiKey: string;
  requestModelCompletion: RequestModelCompletion;
}): Promise<SkillActivationPlan> {
  const prompt = buildActivationRepairPrompt(input);
  const completion = await requestActivation(prompt, input.model, input.apiKey, input.requestModelCompletion, "activation_repair");
  const parsed = activationFromCompletion(completion);
  if (!parsed.ok) throw new Error(`generation_failed:plan_invalid; ${parsed.detail}`);
  return parsed.plan;
}

async function requestActivation(
  user: string,
  model: ModelConfig,
  apiKey: string,
  requestModelCompletion: RequestModelCompletion,
  stage: PipelineStageName,
): Promise<ModelCompletion> {
  const completion = await requestModelCompletion(model, apiKey, {
    system: "你是评论生成流水线的 Skill Activation 阶段。只输出严格 JSON。",
    user,
    maxTokens: ACTIVATION_MAX_TOKENS,
    temperature: 0.2,
    timeoutMs: MODEL_GENERATION_TIMEOUT_MS,
    stream: true,
    thinkingMode: ACTIVATION_THINKING_MODE,
  });
  debugPipelineStage({
    stage,
    model,
    promptLength: countChars(user),
    maxTokens: ACTIVATION_MAX_TOKENS,
    thinkingMode: ACTIVATION_THINKING_MODE,
    completion,
    accepted: completion.content.trim() ? 1 : 0,
    rejected: completion.content.trim() ? 0 : 1,
  });
  return completion;
}

function activationFromCompletion(completion: ModelCompletion):
  | { ok: true; plan: SkillActivationPlan }
  | { ok: false; detail: string } {
  if (completion.finishReason === "length") return { ok: false, detail: "plan_truncated" };
  if (!completion.content.trim()) return { ok: false, detail: "plan_empty" };
  return parseSkillActivationPlan(completion.content);
}

function confirmActivationPlan(plan: SkillActivationPlan): { ok: true } | { ok: false; detail: string } {
  const errors: string[] = [];
  if (plan.skillIdentity.length < 1) errors.push("skillIdentity_required");
  if (!plan.targetReading.trim()) errors.push("targetReading_required");
  if (!plan.attackDirection.trim()) errors.push("attackDirection_required");
  if (plan.sharedConstraints.length < 1) errors.push("sharedConstraints_required");
  if (plan.angles.length < 3) errors.push("angles_min_3");
  const uniqueFocus = new Set(plan.angles.map((angle) => normalizeForCompare(angle.focus)).filter(Boolean));
  if (uniqueFocus.size < 3) errors.push("angle_focus_unique_min_3");
  return errors.length > 0 ? { ok: false, detail: errors.join(",") } : { ok: true };
}

async function executeAngle(input: GenerateCommentAgentPipelineInput & {
  plan: SkillActivationPlan;
  angle: ExecutionAngle;
  requestModelCompletion: RequestModelCompletion;
  existingCandidates: string[];
  stage?: PipelineStageName;
}): Promise<BranchResult> {
  const stage = input.stage ?? "execute";
  const prompt = stage === "补位"
    ? buildFillPrompt(executePromptInput(input, input.existingCandidates))
    : buildExecutePrompt(executePromptInput(input, input.existingCandidates));
  const maxTokens = generationMaxTokens(input.lengthConstraint);
  let completion: ModelCompletion;
  try {
    completion = await input.requestModelCompletion(input.model, input.apiKey, {
      system: "你是中文评论正文生成器。只输出一条最终可见评论正文。",
      user: prompt,
      temperature: executionTemperature(input.request),
      maxTokens,
      timeoutMs: MODEL_GENERATION_TIMEOUT_MS,
      stream: true,
      thinkingMode: input.executeThinkingPolicy,
    });
  } catch (error) {
    debugPipelineStage({
      stage,
      model: input.model,
      promptLength: countChars(prompt),
      maxTokens,
      thinkingMode: input.executeThinkingPolicy,
      completion: undefined,
      accepted: 0,
      rejected: 1,
      reason: redactModelError(error),
    });
    return { ok: false, reason: "model_request_failed", angle: input.angle, rawCandidates: [] };
  }

  const evaluated = await evaluateCompletionCandidate({
    ...input,
    stage,
    prompt,
    maxTokens,
    completion,
  });
  return evaluated;
}

async function evaluateCompletionCandidate(input: GenerateCommentAgentPipelineInput & {
  plan: SkillActivationPlan;
  angle: ExecutionAngle;
  requestModelCompletion: RequestModelCompletion;
  existingCandidates: string[];
  stage: PipelineStageName;
  prompt: string;
  maxTokens: number;
  completion: ModelCompletion;
}): Promise<BranchResult> {
  if (input.completion.finishReason === "length") {
    debugCompletionRejected(input, "output_truncated", []);
    return { ok: false, reason: "output_truncated", angle: input.angle, completion: input.completion, rawCandidates: [] };
  }
  if (!input.completion.content.trim()) {
    debugCompletionRejected(input, "content_empty", []);
    return { ok: false, reason: "content_empty", angle: input.angle, completion: input.completion, rawCandidates: [] };
  }
  const parsed = parseCandidateOutput(input.completion.content);
  if (!parsed.ok || parsed.candidates.length === 0) {
    debugCompletionRejected(input, `invalid_output:${parsed.ok ? "empty" : parsed.detail}`, []);
    return { ok: false, reason: "invalid_output", angle: input.angle, completion: input.completion, rawCandidates: [] };
  }

  const raw = parsed.candidates.map((candidate) => candidate.trim()).filter(Boolean);
  for (const candidate of raw) {
    const refined = await acceptOrRefineCandidate(input, candidate);
    if (refined) {
      debugPipelineStage({
        stage: input.stage,
        model: input.model,
        promptLength: countChars(input.prompt),
        maxTokens: input.maxTokens,
        thinkingMode: input.executeThinkingPolicy,
        completion: input.completion,
        accepted: 1,
        rejected: 0,
      });
      return { ok: true, candidate: refined, completion: input.completion };
    }
  }
  debugCompletionRejected(input, "length_or_duplicate_rejected", raw);
  return { ok: false, reason: "length_or_duplicate_rejected", angle: input.angle, completion: input.completion, rawCandidates: raw };
}

async function acceptOrRefineCandidate(input: GenerateCommentAgentPipelineInput & {
  plan: SkillActivationPlan;
  angle: ExecutionAngle;
  requestModelCompletion: RequestModelCompletion;
  existingCandidates: string[];
}, candidate: string): Promise<CandidateRecord | null> {
  const cleaned = candidate.trim();
  if (!cleaned || isDuplicateOrTarget(cleaned, input.request.target.text, input.existingCandidates)) return null;
  if (isWithinLengthConstraint(cleaned, input.lengthConstraint)) {
    return { text: cleaned, angle: input.angle, refined: false };
  }

  const length = countChars(cleaned);
  const mode = length > input.lengthConstraint.maxChars ? "compress" : "expand";
  const prompt = buildRefinePrompt({
    targetText: input.request.target.text,
    intent: input.request.intent,
    plan: input.plan,
    angle: input.angle,
    candidate: cleaned,
    lengthLabel: input.lengthConstraint.label,
    mode,
  });
  let completion: ModelCompletion;
  try {
    completion = await input.requestModelCompletion(input.model, input.apiKey, {
      system: "你是中文评论候选修复器。只输出修复后的单条评论正文。",
      user: prompt,
      temperature: 0.3,
      maxTokens: generationMaxTokens(input.lengthConstraint),
      timeoutMs: MODEL_GENERATION_TIMEOUT_MS,
      stream: true,
      thinkingMode: input.executeThinkingPolicy,
    });
  } catch (error) {
    debugPipelineStage({
      stage: "refine",
      model: input.model,
      promptLength: countChars(prompt),
      maxTokens: generationMaxTokens(input.lengthConstraint),
      thinkingMode: input.executeThinkingPolicy,
      completion: undefined,
      accepted: 0,
      rejected: 1,
      reason: `${mode}:${redactModelError(error)}`,
    });
    return null;
  }
  debugPipelineStage({
    stage: "refine",
    model: input.model,
    promptLength: countChars(prompt),
    maxTokens: generationMaxTokens(input.lengthConstraint),
    thinkingMode: input.executeThinkingPolicy,
    completion,
    accepted: completion.content.trim() ? 1 : 0,
    rejected: completion.content.trim() ? 0 : 1,
    reason: mode,
  });
  if (completion.finishReason === "length" || !completion.content.trim()) return null;
  const parsed = parseCandidateOutput(completion.content);
  if (!parsed.ok) return null;
  const refined = parsed.candidates.map((item) => item.trim()).find((item) =>
    item && isWithinLengthConstraint(item, input.lengthConstraint) && !isDuplicateOrTarget(item, input.request.target.text, input.existingCandidates)
  );
  return refined ? { text: refined, angle: input.angle, refined: true } : null;
}

function activationPromptForRequest(
  request: GenerateRequest,
  promptContext: CommentAgentPromptContext,
  lengthConstraint: LengthConstraint,
): string {
  return buildSkillActivationPrompt({
    platform: request.platform,
    targetText: request.target.text,
    intent: request.intent,
    lengthLabel: lengthConstraint.label,
    pageTitle: request.context.pageTitle,
    sourceText: promptContext.sourceText,
    nearbyComments: request.context.nearbyComments,
    skillName: promptContext.skill?.name ?? request.settings.activeSkillId,
    skillGoal: promptContext.skill?.goal ?? "",
    skillSummary: promptContext.skill?.summary ?? "",
    skillText: fullSkillText(promptContext),
    styleProfileText: fullSkillFileText(promptContext, "style_profile.json"),
    attackPlaybookText: fullSkillFileText(promptContext, "attack_playbook.json"),
    selectedSampleText: promptContext.selectedSampleText,
    ammoText: promptContext.ammo.map((entry) => `- ${entry.term}: ${entry.description}`).join("\n"),
  });
}

function executePromptInput(input: GenerateCommentAgentPipelineInput & {
  plan: SkillActivationPlan;
  angle: ExecutionAngle;
}, existingCandidates: string[]) {
  return {
    platform: input.request.platform,
    targetText: input.request.target.text,
    intent: input.request.intent,
    pageTitle: input.request.context.pageTitle,
    sourceText: input.promptContext.sourceText,
    nearbyComments: input.request.context.nearbyComments,
    plan: input.plan,
    angle: input.angle,
    lengthLabel: input.lengthConstraint.label,
    selectedSampleText: input.promptContext.selectedSampleText,
    existingCandidates,
  };
}

function fullSkillText(promptContext: CommentAgentPromptContext): string {
  return promptContext.skill?.files?.["SKILL.md"] ?? promptContext.skill?.skill_md ?? promptContext.skillText;
}

function fullSkillFileText(promptContext: CommentAgentPromptContext, name: "style_profile.json" | "attack_playbook.json"): string {
  return promptContext.skill?.files?.[name]
    ?? (name === "style_profile.json" ? promptContext.styleProfileText : promptContext.attackPlaybookText);
}

function uniqueAngles(angles: ExecutionAngle[]): ExecutionAngle[] {
  const seen = new Set<string>();
  const result: ExecutionAngle[] = [];
  for (const angle of angles) {
    const key = normalizeForCompare(angle.focus);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(angle);
  }
  return result;
}

function mergeUniqueCandidates(candidates: string[], targetText: string): string[] {
  const target = normalizeForCompare(targetText);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const key = normalizeForCompare(candidate);
    if (!key || key === target || seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function isDuplicateOrTarget(candidate: string, targetText: string, existingCandidates: string[]): boolean {
  const key = normalizeForCompare(candidate);
  return key === normalizeForCompare(targetText)
    || existingCandidates.some((existing) => normalizeForCompare(existing) === key);
}

function generationMaxTokens(lengthConstraint: LengthConstraint): number {
  if ((lengthConstraint.targetChars ?? lengthConstraint.maxChars) > 120 || lengthConstraint.maxChars > 130) {
    return ULTRA_LONG_GENERATION_MAX_TOKENS;
  }
  return STANDARD_GENERATION_MAX_TOKENS;
}

function executionTemperature(request: GenerateRequest): number {
  return request.settings.activeSkillId === "wenyan_attack" ? 0.35 : 0.55;
}

function debugCompletionRejected(input: GenerateCommentAgentPipelineInput & {
  stage: PipelineStageName;
  prompt: string;
  maxTokens: number;
  completion: ModelCompletion;
}, reason: string, rawCandidates: string[]): void {
  debugPipelineStage({
    stage: input.stage,
    model: input.model,
    promptLength: countChars(input.prompt),
    maxTokens: input.maxTokens,
    thinkingMode: input.executeThinkingPolicy,
    completion: input.completion,
    accepted: 0,
    rejected: Math.max(1, rawCandidates.length),
    reason,
  });
}

function debugPipelineStage(input: {
  stage: PipelineStageName;
  model: ModelConfig;
  promptLength: number;
  maxTokens: number;
  thinkingMode: ExecuteThinkingPolicy;
  completion: ModelCompletion | undefined;
  accepted: number;
  rejected: number;
  reason?: string;
}): void {
  console.debug("[clapback:generation:pipeline]", {
    stage: input.stage,
    provider: input.model.provider,
    model: input.model.model_name,
    promptLength: input.promptLength,
    maxTokens: input.maxTokens,
    thinkingMode: input.thinkingMode,
    finishReason: input.completion ? input.completion.finishReason ?? "unknown" : "request_failed",
    contentLength: input.completion ? countChars(input.completion.content) : 0,
    reasoningLength: input.completion ? countChars(input.completion.reasoningContent) : 0,
    accepted: input.accepted,
    rejected: input.rejected,
    reason: input.reason,
  });
}

function normalizeForCompare(value: string): string {
  return value.replace(/\s+/g, "").replace(/[，。！？、,.!?；;：:]/g, "").toLowerCase();
}

function countChars(value: string): number {
  return [...value].length;
}

function redactModelError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-****");
}
