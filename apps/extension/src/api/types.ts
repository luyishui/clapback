import type {
  AmmoBoxSummary,
  AmmoCategory,
  AmmoEntry,
  CorpusBox,
  CorpusEntry,
  ModelConnectionTestResult,
  ModelConfig,
  ModelConfigInput,
  ModelDetectionResult,
  ModelApiProtocol,
  RuntimeSettings,
  SkillDetail,
  SkillDraft,
  SkillInfo,
  SkillTryoutResult,
} from "../workbench/runtimeApi";
import type { GenerateRequest, GenerateResponse } from "../content/types";

export type CollectionPlatform = "zhihu" | "weibo" | "xiaohongshu";

export type CollectionCandidate = {
  platform: CollectionPlatform;
  kind: "answer" | "article" | "post" | "note" | "comment" | "unknown";
  text: string;
  title?: string;
  url?: string;
  sourceId?: string;
  publishedAt?: string;
};

export type CollectionBasketItem = CollectionCandidate & {
  id: string;
  session_id: string;
  dedupe_key: string;
  created_at: string;
};

export type CollectionSession = {
  id: string;
  tab_id?: number;
  platform: CollectionPlatform;
  box_id: number;
  box_name?: string;
  creator_url: string;
  requested_count: number;
  status: "active" | "imported" | "ended";
  current_count: number;
  imported_count: number;
  skipped_count: number;
  created_at: string;
  updated_at: string;
};

export type CollectionAddResult = {
  added: number;
  skipped: number;
  basket_count: number;
  limit_reached: boolean;
};

export type CollectionImportResult = {
  imported: number;
  skipped: number;
  box_id: number;
};

export type ExtensionHealthStatus = {
  ok: boolean;
  service: "clapback-extension";
  version: string;
};

export type UpdateCheckResult =
  | {
      ok: true;
      hasUpdate: boolean;
      currentVersion: string;
      latestVersion: string;
      tagName: string;
      releaseUrl: string;
      releaseNotes?: string;
      source: string;
      mirrors: Array<{ id: string; labelKey: string; url: string }>;
    }
  | { ok: false; error: string };

export type ExtensionRequestMap = {
  "settings:get": { payload: undefined; response: RuntimeSettings };
  "settings:save": { payload: Partial<Omit<RuntimeSettings, "api_key_set" | "base_url">>; response: RuntimeSettings };
  "models:list": { payload: undefined; response: ModelConfig[] };
  "models:save": { payload: Partial<ModelConfigInput> & { id?: number }; response: ModelConfig };
  "models:detect": { payload: { base_url: string; api_key?: string; api_protocol?: ModelApiProtocol }; response: ModelDetectionResult };
  "models:test": { payload: Partial<ModelConfigInput> & { id?: number; api_protocol?: ModelApiProtocol }; response: ModelConnectionTestResult };
  "models:delete": { payload: { id: number }; response: void };
  "corpus:listBoxes": { payload: undefined; response: CorpusBox[] };
  "corpus:createBox": { payload: { name: string; description: string; platform?: string }; response: CorpusBox };
  "corpus:listEntries": { payload: { boxId: number }; response: CorpusEntry[] };
  "corpus:addEntries": {
    payload: { boxId: number; entries: Array<{ source: string; content: string; metadata?: Record<string, unknown> }> };
    response: CorpusEntry[];
  };
  "corpus:deleteBox": { payload: { boxId: number }; response: void };
  "collection:startSession": {
    payload: { platform: CollectionPlatform; box_id: number; creator_url: string; requested_count: number };
    response: CollectionSession;
  };
  "collection:getSessionForTab": { payload: { tabId?: number }; response: CollectionSession | null };
  "collection:getSession": { payload: { sessionId: string }; response: CollectionSession | null };
  "collection:addCandidates": {
    payload: { sessionId: string; candidates: CollectionCandidate[] };
    response: CollectionAddResult;
  };
  "collection:listBasket": { payload: { sessionId: string }; response: CollectionBasketItem[] };
  "collection:removeCandidate": { payload: { sessionId: string; candidateId: string }; response: void };
  "collection:importBasket": { payload: { sessionId: string }; response: CollectionImportResult };
  "collection:endSession": { payload: { sessionId: string }; response: void };
  "skills:list": { payload: undefined; response: SkillInfo[] };
  "skills:getDetail": { payload: { skillId: string }; response: SkillDetail };
  "skills:compile": { payload: { files: Record<string, string>; skillId?: string; require_samples?: boolean }; response: { ok: boolean; skill?: SkillInfo; errors?: string[] } };
  "skills:delete": { payload: { skillId: string }; response: void };
  "skills:createDraft": {
    payload: { source_box_ids: number[]; skill_name: string; skill_goal: string };
    response: SkillDraft;
  };
  "skills:runTryout": {
    payload: { draftId: number; user_utterance: string; round_index: number; lengthMode?: string; customLengthTarget?: number };
    response: SkillTryoutResult;
  };
  "skills:applyFeedback": { payload: { draftId: number; feedback: string; tags: string[] }; response: SkillDraft };
  "skills:publish": { payload: { draftId: number; accepted_tryout_ids?: number[] }; response: SkillInfo & { stability_warning?: string } };
  "skills:rateTryout": {
    payload: { tryoutId: number; rating: "accepted" | "rejected" | null; rejectionReason?: string; annotation?: string };
    response: SkillTryoutResult;
  };
  "ammo:listBoxes": { payload: undefined; response: AmmoBoxSummary[] };
  "ammo:createBox": { payload: { name: string; category: AmmoCategory; description: string }; response: AmmoBoxSummary };
  "ammo:listEntries": { payload: { boxId: number }; response: AmmoEntry[] };
  "ammo:addEntry": { payload: { boxId: number; term: string; description: string }; response: AmmoEntry };
  "ammo:deleteEntry": { payload: { boxId: number; entryId: number }; response: void };
  "ammo:deleteBox": { payload: { id: number }; response: void };
  "generation:generateCandidates": { payload: GenerateRequest; response: GenerateResponse };
  "generation:generate": { payload: GenerateRequest; response: GenerateResponse };
  "extension:health": { payload: undefined; response: ExtensionHealthStatus };
  "extension:checkUpdate": { payload: undefined; response: UpdateCheckResult };
};

export type ExtensionMessageType = keyof ExtensionRequestMap;

export type ExtensionMessage<T extends ExtensionMessageType = ExtensionMessageType> = {
  type: T;
  payload?: ExtensionRequestMap[T]["payload"];
};

export type ExtensionMessageResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
