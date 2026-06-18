import type { GenerateRequest } from "../content/types";
import type { AmmoEntry, ModelConfig, SkillDetail } from "../workbench/runtimeApi";
import type { LengthConstraint } from "./lengthConstraints";
import type { ModelCompletion } from "./modelConnection";

export type ExecuteThinkingPolicy = "disabled" | "provider_default";

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
  thinkingMode: ExecuteThinkingPolicy;
  finishReason: string;
  contentLength: number;
  reasoningLength: number;
  accepted: number;
  rejected: number;
  reason?: string;
};

export type CommentAgentPromptContext = {
  sourceTitle: string;
  sourceText: string;
  skill: SkillDetail | null;
  skillText: string;
  styleProfileText: string;
  attackPlaybookText: string;
  ammo: AmmoEntry[];
  selectedSampleText: string;
};

export type RequestModelCompletion = (
  model: ModelConfig,
  apiKey: string,
  request: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    responseFormat?: "json_object";
    stream?: boolean;
    thinkingMode?: ExecuteThinkingPolicy;
  },
) => Promise<ModelCompletion>;

export type GenerateCommentAgentPipelineInput = {
  request: GenerateRequest;
  promptContext: CommentAgentPromptContext;
  lengthConstraint: LengthConstraint;
  model: ModelConfig;
  apiKey: string;
  executeThinkingPolicy: ExecuteThinkingPolicy;
  requestModelCompletion?: RequestModelCompletion;
};
