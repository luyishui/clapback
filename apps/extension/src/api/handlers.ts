import type { ExtensionMessage, ExtensionMessageType, ExtensionRequestMap } from "./types";
import { generateCandidates } from "./generation";
import { detectModels, testModelConnection } from "./modelConnection";
import {
  addAmmoEntry,
  addCollectionCandidates,
  addCorpusEntries,
  applySkillFeedback,
  compileSkill,
  createAmmoBox,
  createCorpusBox,
  createSkillDraft,
  deleteAmmoBox,
  deleteAmmoEntry,
  deleteCorpusBox,
  deleteModel,
  endCollectionSession,
  getCollectionSessionForTab,
  getCollectionSession,
  getSettings,
  getSkillDetail,
  importCollectionBasket,
  listAmmoBoxes,
  listAmmoEntries,
  listCollectionBasket,
  listCorpusBoxes,
  listCorpusEntries,
  listModels,
  listSkills,
  publishSkillDraft,
  rateSkillTryout,
  removeCollectionCandidate,
  runSkillTryout,
  saveModel,
  saveSettings,
  startCollectionSession,
} from "./idbStore";

export async function handleExtensionMessage<T extends ExtensionMessageType>(
  message: ExtensionMessage<T>,
  sender?: chrome.runtime.MessageSender,
): Promise<ExtensionRequestMap[T]["response"]> {
  assertSenderCanCall(message.type, sender);
  const payload = message.payload as ExtensionRequestMap[T]["payload"];

  switch (message.type) {
    case "extension:health":
      return { ok: true, service: "clapback-extension", version: "0.1.0" } as ExtensionRequestMap[T]["response"];
    case "settings:get":
      return getSettings() as Promise<ExtensionRequestMap[T]["response"]>;
    case "settings:save":
      return saveSettings((payload ?? {}) as never) as Promise<ExtensionRequestMap[T]["response"]>;
    case "models:list":
      return listModels() as Promise<ExtensionRequestMap[T]["response"]>;
    case "models:save":
      return saveModel((payload ?? {}) as never) as Promise<ExtensionRequestMap[T]["response"]>;
    case "models:detect":
      return detectModels((payload ?? {}) as never) as Promise<ExtensionRequestMap[T]["response"]>;
    case "models:test":
      return testModelConnection((payload ?? {}) as never) as Promise<ExtensionRequestMap[T]["response"]>;
    case "models:delete":
      return deleteModel(requireNumber(payload, "id")) as Promise<ExtensionRequestMap[T]["response"]>;
    case "corpus:listBoxes":
      return listCorpusBoxes() as Promise<ExtensionRequestMap[T]["response"]>;
    case "corpus:createBox": {
      const data = payload as { name: string; description: string; platform?: string };
      requireNonEmptyString(data, "name");
      return createCorpusBox(data.name, data.description, data.platform) as Promise<ExtensionRequestMap[T]["response"]>;
    }
    case "corpus:listEntries":
      return listCorpusEntries(requireNumber(payload, "boxId")) as Promise<ExtensionRequestMap[T]["response"]>;
    case "corpus:addEntries": {
      const data = payload as Parameters<typeof addCorpusEntries>[1] extends infer Entries
        ? { boxId: number; entries: Entries }
        : never;
      return addCorpusEntries(data.boxId, data.entries as Parameters<typeof addCorpusEntries>[1]) as Promise<ExtensionRequestMap[T]["response"]>;
    }
    case "corpus:deleteBox":
      return deleteCorpusBox(requireNumber(payload, "boxId")) as Promise<ExtensionRequestMap[T]["response"]>;
    case "collection:startSession": {
      const data = payload as Parameters<typeof startCollectionSession>[0];
      const platform = requireCollectionPlatform(data);
      requireNumber(data, "box_id");
      const creatorUrl = normalizeCollectionCreatorUrl(platform, requireNonEmptyString(data, "creator_url"));
      const requestedCount = requireNumber(data, "requested_count");
      if (requestedCount <= 0) throw new Error("invalid_requested_count");
      const tabId = isOwnExtensionPage(sender)
        ? await openCollectionTab(creatorUrl)
        : sender?.tab?.id ?? await openCollectionTab(creatorUrl);
      return startCollectionSession({
        ...data,
        platform,
        creator_url: creatorUrl,
        requested_count: requestedCount,
        tab_id: tabId,
      }) as Promise<ExtensionRequestMap[T]["response"]>;
    }
    case "collection:getSessionForTab": {
      const data = payload as { tabId?: number } | undefined;
      const tabId = sender?.tab ? sender.tab.id : data?.tabId;
      return getCollectionSessionForTab(tabId) as Promise<ExtensionRequestMap[T]["response"]>;
    }
    case "collection:getSession":
      return getCollectionSession(requireNonEmptyString(payload, "sessionId")) as Promise<ExtensionRequestMap[T]["response"]>;
    case "collection:addCandidates": {
      const data = payload as Parameters<typeof addCollectionCandidates> extends [infer A, infer B] ? { sessionId: A; candidates: B } : never;
      requireNonEmptyString(data, "sessionId");
      if (!Array.isArray(data.candidates)) throw new Error("invalid_candidates");
      return addCollectionCandidates(data.sessionId as string, data.candidates as Parameters<typeof addCollectionCandidates>[1]) as Promise<ExtensionRequestMap[T]["response"]>;
    }
    case "collection:listBasket":
      return listCollectionBasket(requireNonEmptyString(payload, "sessionId")) as Promise<ExtensionRequestMap[T]["response"]>;
    case "collection:removeCandidate": {
      const data = payload as { sessionId: string; candidateId: string };
      return removeCollectionCandidate(data.sessionId, data.candidateId) as Promise<ExtensionRequestMap[T]["response"]>;
    }
    case "collection:importBasket":
      return importCollectionBasket(requireNonEmptyString(payload, "sessionId")) as Promise<ExtensionRequestMap[T]["response"]>;
    case "collection:endSession":
      return endCollectionSession(requireNonEmptyString(payload, "sessionId")) as Promise<ExtensionRequestMap[T]["response"]>;
    case "skills:list":
      return listSkills() as Promise<ExtensionRequestMap[T]["response"]>;
    case "skills:getDetail":
      return getSkillDetail(requireNonEmptyString(payload, "skillId")) as Promise<ExtensionRequestMap[T]["response"]>;
    case "skills:compile": {
      const skillId = optionalString(payload, "skillId");
      const requireSamples = typeof (payload as { require_samples?: boolean }).require_samples === "boolean"
        ? (payload as { require_samples: boolean }).require_samples
        : false;
      return compileSkill(requireFiles(payload), skillId, requireSamples) as Promise<ExtensionRequestMap[T]["response"]>;
    }
    case "skills:createDraft":
      return createSkillDraft(payload as Parameters<typeof createSkillDraft>[0]) as Promise<ExtensionRequestMap[T]["response"]>;
    case "skills:runTryout": {
      const data = payload as { draftId: number; user_utterance: string; round_index: number; lengthMode?: string; customLengthTarget?: number };
      return runSkillTryout(
        requireNumber(data, "draftId"),
        data.user_utterance ?? "",
        requireNumber(data, "round_index"),
        {
          lengthMode: typeof data.lengthMode === "string" ? data.lengthMode : "短",
          customLengthTarget: typeof data.customLengthTarget === "number" ? data.customLengthTarget : undefined,
        },
      ) as Promise<ExtensionRequestMap[T]["response"]>;
    }
    case "skills:applyFeedback": {
      const data = payload as { draftId: number; feedback: string; tags: string[] };
      return applySkillFeedback(requireNumber(data, "draftId"), data.feedback ?? "", Array.isArray(data.tags) ? data.tags : []) as Promise<ExtensionRequestMap[T]["response"]>;
    }
    case "skills:publish":
      return publishSkillDraft(
        requireNumber(payload, "draftId"),
        Array.isArray((payload as { accepted_tryout_ids?: unknown[] } | undefined)?.accepted_tryout_ids)
          ? (payload as { accepted_tryout_ids: unknown[] }).accepted_tryout_ids.filter((id): id is number => typeof id === "number" && Number.isFinite(id))
          : [],
      ) as Promise<ExtensionRequestMap[T]["response"]>;
    case "skills:rateTryout": {
      const data = payload as { tryoutId: number; rating: "accepted" | "rejected" | null; rejectionReason?: string; annotation?: string };
      return rateSkillTryout(
        requireNumber(data, "tryoutId"),
        data.rating ?? null,
        data.rejectionReason,
        data.annotation,
      ) as Promise<ExtensionRequestMap[T]["response"]>;
    }
    case "ammo:listBoxes":
      return listAmmoBoxes() as Promise<ExtensionRequestMap[T]["response"]>;
    case "ammo:createBox":
      return createAmmoBox(payload as Parameters<typeof createAmmoBox>[0]) as Promise<ExtensionRequestMap[T]["response"]>;
    case "ammo:listEntries":
      return listAmmoEntries(requireNumber(payload, "boxId")) as Promise<ExtensionRequestMap[T]["response"]>;
    case "ammo:addEntry": {
      const data = payload as { boxId: number; term: string; description: string };
      return addAmmoEntry(requireNumber(data, "boxId"), requireNonEmptyString(data, "term"), data.description ?? "") as Promise<ExtensionRequestMap[T]["response"]>;
    }
    case "ammo:deleteEntry": {
      const data = payload as { boxId: number; entryId: number };
      return deleteAmmoEntry(requireNumber(data, "boxId"), requireNumber(data, "entryId")) as Promise<ExtensionRequestMap[T]["response"]>;
    }
    case "ammo:deleteBox":
      return deleteAmmoBox(requireNumber(payload, "id")) as Promise<ExtensionRequestMap[T]["response"]>;
    case "generation:generateCandidates":
    case "generation:generate":
      return generateCandidates(payload as Parameters<typeof generateCandidates>[0]) as Promise<ExtensionRequestMap[T]["response"]>;
    default:
      throw new Error(`Unknown extension message: ${String(message.type)}`);
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("invalid_payload");
  return value as Record<string, unknown>;
}

function requireNumber(value: unknown, key: string): number {
  const record = requireRecord(value);
  const raw = record[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error(`invalid_${key}`);
  return raw;
}

function requireNonEmptyString(value: unknown, key: string): string {
  const record = requireRecord(value);
  const raw = record[key];
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`invalid_${key}`);
  return raw.trim();
}

function requireCollectionPlatform(value: unknown): "zhihu" | "weibo" | "xiaohongshu" {
  const platform = requireNonEmptyString(value, "platform");
  if (platform === "zhihu" || platform === "weibo" || platform === "xiaohongshu") return platform;
  throw new Error("invalid_platform");
}

function requireFiles(value: unknown): Record<string, string> {
  const record = requireRecord(value);
  const files = record.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new Error("invalid_files");
  const result: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    if (typeof content !== "string") throw new Error("invalid_file_content");
    result[name] = content;
  }
  return result;
}

function optionalString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

async function openCollectionTab(url: string): Promise<number | undefined> {
  if (typeof chrome === "undefined" || !chrome.tabs?.create) return undefined;
  const tab = await chrome.tabs.create({ url });
  return tab?.id;
}

function normalizeCollectionCreatorUrl(platform: "zhihu" | "weibo" | "xiaohongshu", rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("invalid_creator_url");
  }
  if (parsed.protocol !== "https:") throw new Error("invalid_creator_url");
  const host = parsed.hostname.toLowerCase();
  const supported = platform === "zhihu"
    ? host === "www.zhihu.com" || host === "zhuanlan.zhihu.com"
    : platform === "weibo"
      ? host === "weibo.com" || host === "www.weibo.com" || host === "m.weibo.cn"
      : host === "www.xiaohongshu.com";
  if (!supported) throw new Error("unsupported_collection_url");
  return parsed.toString();
}

const CONTENT_SAFE_MESSAGES = new Set<ExtensionMessageType>([
  "extension:health",
  "skills:list",
  "ammo:listBoxes",
  "generation:generateCandidates",
  "generation:generate",
  "collection:getSessionForTab",
  "collection:addCandidates",
  "collection:listBasket",
  "collection:removeCandidate",
  "collection:importBasket",
  "collection:endSession",
]);

function assertSenderCanCall(type: ExtensionMessageType, sender?: chrome.runtime.MessageSender): void {
  const isContentSender = Boolean(sender?.tab) && !isOwnExtensionPage(sender);
  if (!isContentSender) return;
  if (CONTENT_SAFE_MESSAGES.has(type)) return;
  throw new Error(`message_not_allowed_from_content:${type}`);
}

function isOwnExtensionPage(sender?: chrome.runtime.MessageSender): boolean {
  const extensionId = getRuntimeId();
  if (!extensionId) return false;
  const senderUrl = sender?.url ?? sender?.tab?.url ?? "";
  return senderUrl.startsWith(`chrome-extension://${extensionId}/`);
}

function getRuntimeId(): string {
  try {
    return typeof chrome !== "undefined" ? chrome.runtime?.id ?? "" : "";
  } catch {
    return "";
  }
}
