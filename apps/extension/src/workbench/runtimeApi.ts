import { sendExtensionMessage } from "../api/client";
import type { ExtensionHealthStatus } from "../api/types";

export type SkillSampleSelections = Record<string, Partial<Record<"短" | "中" | "长", string>>>;

export type RuntimeSettings = {
  base_url: string;
  api_key_set: boolean;
  model: string;
  theme: string;
  language?: string;
  skill_tryout_rounds?: number;
  skill_sample_selections?: SkillSampleSelections;
};

export type CorpusBox = {
  id: number;
  name: string;
  description: string;
  platform?: string;
  entry_count?: number;
  updated_at?: string;
  status?: "ready" | "running" | "blocked" | "failed";
};

export type CorpusEntry = {
  id: number;
  box_id: number;
  source: string;
  content: string;
  metadata: Record<string, unknown>;
};

export type SkillInfo = {
  id: string;
  name: string;
  goal: string;
  summary: string;
  version?: string;
  score?: number;
  confidence?: "low" | "medium" | "high";
  recommended_default?: boolean;
  risk_tips?: string[];
  quality?: Record<string, unknown>;
  source?: string;
  lineage?: string;
  compile_status?: "compiled" | "builtin" | "failed";
};

export type SkillDetail = SkillInfo & {
  skill_md: string;
  sample_outputs: Array<{ prompt?: string; reply?: string; input?: string; output?: string; lengthBucket?: "短" | "中" | "长" }>;
  files?: Record<string, string>;
  manifest?: Record<string, unknown>;
};

export type HealthStatus = ExtensionHealthStatus;

export type ModelApiProtocol = "openai_chat" | "anthropic_messages";

export type ModelConfig = {
  id: number;
  provider: string;
  model_name: string;
  base_url: string;
  api_key_masked: string;
  api_protocol: ModelApiProtocol;
  is_default: boolean;
  created_at?: string;
};

export type ModelConfigInput = {
  provider: string;
  model_name: string;
  base_url: string;
  api_key: string;
  api_protocol?: ModelApiProtocol;
  is_default?: boolean;
};

export type ModelOption = {
  id: string;
  api_protocol: ModelApiProtocol;
};

export type ModelDetectionResult =
  | { ok: true; models: ModelOption[] }
  | { ok: false; error: string; status?: number };

export type ModelConnectionTestResult =
  | { ok: true; model: string }
  | { ok: false; error: string; status?: number };

export type AmmoCategory = "meme" | "knowledge";

export type AmmoBoxSummary = {
  id: number;
  name: string;
  category: AmmoCategory;
  description: string;
  entry_count: number;
  updated_at?: string;
  status?: "ready" | "loading";
};

export type AmmoEntry = {
  id: number;
  box_id: number;
  term: string;
  description: string;
};

export type CrawlJob = {
  id: number;
  session_id?: string;
  tab_id?: number;
  box_id: number;
  platform: string;
  status: "running" | "completed" | "blocked" | "failed";
  current_count: number;
  requested_count: number;
  reason?: string;
  message?: string;
  imported?: number;
  deduped?: number;
  source_mode?: "extension_page" | "";
  created_at?: string;
  updated_at?: string;
};

export type SkillDraft = {
  id: number;
  name: string;
  goal: string;
  status: string;
  files: Record<string, string>;
  draft_version: number;
  feedback_cycles: number;
  source_box_ids?: number[];
};

export type SkillTryoutResult = {
  id: number;
  draft_version: number;
  round_index: number;
  user_utterance: string;
  reply: string;
  degraded?: boolean;
  degraded_reason?: string;
  user_rating?: "accepted" | "rejected" | null;
  rejection_reason?: string;
  user_annotation?: string;
};

const collectionJobSessions = new Map<number, { sessionId: string; tabId?: number; boxId: number; platform: string; requestedCount: number; createdAt?: string }>();

export function setRuntimeBaseUrl(_url: string): void {
  // Kept as a no-op for older callers during the pure-extension migration.
}

export function getRuntimeBaseUrl(): string {
  return "extension://background";
}

export const runtimeApi = {
  health: () => sendExtensionMessage("extension:health"),

  getSettings: () => sendExtensionMessage("settings:get"),

  saveSettings: (payload: Partial<{ model: string; theme: string; language: string; skill_tryout_rounds: number; skill_sample_selections: SkillSampleSelections }>) =>
    sendExtensionMessage("settings:save", payload),

  listModels: () => sendExtensionMessage("models:list"),

  createModel: (data: ModelConfigInput) =>
    sendExtensionMessage("models:save", data),

  updateModel: (id: number, data: Partial<ModelConfigInput>) =>
    sendExtensionMessage("models:save", { ...data, id }),

  detectModels: (data: { base_url: string; api_key?: string; api_protocol?: ModelApiProtocol }) =>
    sendExtensionMessage("models:detect", data),

  testModel: (data: Partial<ModelConfigInput> & { id?: number; api_protocol?: ModelApiProtocol }) =>
    sendExtensionMessage("models:test", data),

  deleteModel: (id: number) =>
    sendExtensionMessage("models:delete", { id }),

  listBoxes: () => sendExtensionMessage("corpus:listBoxes"),

  createBox: (name: string, description: string) =>
    sendExtensionMessage("corpus:createBox", { name, description, platform: "zhihu" }),

  deleteBox: (boxId: number) =>
    sendExtensionMessage("corpus:deleteBox", { boxId }),

  listEntries: (boxId: number) =>
    sendExtensionMessage("corpus:listEntries", { boxId }),

  addEntries: (boxId: number, entries: Array<{ source: string; content: string; metadata?: Record<string, unknown> }>) =>
    sendExtensionMessage("corpus:addEntries", { boxId, entries }),

  listSkills: () => sendExtensionMessage("skills:list"),

  getSkillDetail: (skillId: string) =>
    sendExtensionMessage("skills:getDetail", { skillId }),

  compileSkill: (payload: { files?: Record<string, string>; skillId?: string } | Record<string, unknown>) =>
    sendExtensionMessage("skills:compile", {
      files: "files" in payload && payload.files && typeof payload.files === "object"
        ? payload.files as Record<string, string>
        : payload as Record<string, string>,
      skillId: "skillId" in payload && typeof payload.skillId === "string" ? payload.skillId : undefined,
    }),

  startCrawlJob: async (payload: {
    platform: string;
    mode: string;
    box_id: number;
    creator_url: string;
    requested_count: number;
  }) => {
    const session = await sendExtensionMessage("collection:startSession", {
      platform: payload.platform as "zhihu" | "weibo" | "xiaohongshu",
      box_id: payload.box_id,
      creator_url: payload.creator_url,
      requested_count: payload.requested_count,
    });
    const jobId = Number(session.id.replace(/\D+/g, "").slice(0, 9)) || Date.now();
    collectionJobSessions.set(jobId, {
      sessionId: session.id,
      tabId: session.tab_id,
      boxId: session.box_id,
      platform: session.platform,
      requestedCount: session.requested_count,
      createdAt: session.created_at,
    });
    return {
      id: jobId,
      session_id: session.id,
      tab_id: session.tab_id,
      box_id: session.box_id,
      platform: session.platform,
      status: "running",
      current_count: session.current_count,
      requested_count: session.requested_count,
      source_mode: "",
      created_at: session.created_at,
      updated_at: session.updated_at,
    } satisfies CrawlJob;
  },

  getCrawlJob: async (jobId: number) => {
    const job = collectionJobSessions.get(jobId);
    if (!job) {
      return {
        id: jobId,
        box_id: 0,
        platform: "zhihu",
        status: "failed",
        current_count: 0,
        requested_count: 1,
        reason: "collection_session_not_found",
      } satisfies CrawlJob;
    }
    const session = await sendExtensionMessage("collection:getSession", { sessionId: job.sessionId });
    if (!session) {
      collectionJobSessions.delete(jobId);
      return {
        id: jobId,
        box_id: job.boxId,
        platform: job.platform,
        status: "failed",
        current_count: 0,
        requested_count: job.requestedCount,
        reason: "collection_session_not_found",
      } satisfies CrawlJob;
    }
    const status: CrawlJob["status"] = session.status === "active"
      ? "running"
      : session.status === "imported"
        ? "completed"
        : "failed";
    return {
      id: jobId,
      session_id: job.sessionId,
      tab_id: job.tabId,
      box_id: job.boxId,
      platform: job.platform,
      status,
      current_count: session.current_count,
      requested_count: session.requested_count,
      imported: session.imported_count,
      deduped: session.skipped_count,
      reason: session.status === "ended" ? "collection_session_ended" : undefined,
      source_mode: "",
      created_at: session.created_at,
      updated_at: session.updated_at,
    } satisfies CrawlJob;
  },

  listAmmoBoxes: () => sendExtensionMessage("ammo:listBoxes"),

  getAmmoBox: async (id: number) => {
    const boxes = await sendExtensionMessage("ammo:listBoxes");
    const box = boxes.find((item) => item.id === id);
    if (!box) throw new Error("ammo_box_not_found");
    return box;
  },

  createAmmoBox: (data: { name: string; category: AmmoCategory; description: string }) =>
    sendExtensionMessage("ammo:createBox", data),

  deleteAmmoBox: (id: number) =>
    sendExtensionMessage("ammo:deleteBox", { id }),

  listAmmoEntries: (boxId: number) =>
    sendExtensionMessage("ammo:listEntries", { boxId }),

  createAmmoEntry: (boxId: number, data: { term: string; description: string }) =>
    sendExtensionMessage("ammo:addEntry", { boxId, ...data }),

  deleteAmmoEntry: (boxId: number, entryId: number) =>
    sendExtensionMessage("ammo:deleteEntry", { boxId, entryId }),

  startRuntime: async () => undefined,

  createSkillDraft: (data: { source_box_ids: number[]; skill_name: string; skill_goal: string }) =>
    sendExtensionMessage("skills:createDraft", data),

  runSkillTryout: (draftId: number, data: {
    user_utterance: string;
    round_index: number;
    lengthMode?: string;
    customLengthTarget?: number;
  }) =>
    sendExtensionMessage("skills:runTryout", { draftId, ...data }),

  sendSkillFeedback: (draftId: number, data: { feedback: string; tags: string[] }) =>
    sendExtensionMessage("skills:applyFeedback", { draftId, ...data }),

  publishSkillDraft: (draftId: number, data: { accepted_tryout_ids: number[] }) =>
    sendExtensionMessage("skills:publish", { draftId, ...data }),

  rateTryout: (tryoutId: number, data: {
    rating: "accepted" | "rejected" | null;
    rejectionReason?: string;
    annotation?: string;
  }) =>
    sendExtensionMessage("skills:rateTryout", { tryoutId, ...data }),
};
