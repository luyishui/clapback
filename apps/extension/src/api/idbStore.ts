import type {
  AmmoBoxSummary,
  AmmoEntry,
  CorpusBox,
  CorpusEntry,
  ModelApiProtocol,
  ModelConfig,
  RuntimeSettings,
  SkillDetail,
  SkillDraft,
  SkillInfo,
  SkillTryoutResult,
} from "../workbench/runtimeApi";
import { getBuiltinSkillDetails } from "./builtinSkills";
import type {
  CollectionBasketItem,
  CollectionCandidate,
  CollectionImportResult,
  CollectionPlatform,
  CollectionSession,
} from "./types";
import { DEFAULT_AMMO_BOXES } from "./defaultAmmo";
import type { LengthSettings } from "./lengthConstraints";
import { resolveLengthConstraint, trimToMaxChars } from "./lengthConstraints";
import { findExecutableSkillFiles } from "./skillPackages";
import { generateSkillDraftFiles, runModelSkillTryout, skillGenerationToFiles } from "./skillGeneration";

type StoreName =
  | "meta"
  | "corpusBoxes"
  | "corpusEntries"
  | "skills"
  | "skillDrafts"
  | "skillTryouts"
  | "ammoBoxes"
  | "ammoEntries"
  | "collectionSessions"
  | "collectionCandidates";

const DB_NAME = "clapback-extension";
const DB_VERSION = 1;
const SETTINGS_KEY = "clapback:settings";
const MODELS_KEY = "clapback:models";
const MODEL_KEY_PREFIX = "clapback:modelApiKey:";
const MIN_SKILL_CREATOR_ENTRIES = 3;
const MIN_SKILL_CREATOR_TEXT_LENGTH = 1200;
const MAX_SKILL_CREATOR_FEEDBACK_CYCLES = 3;
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
type MetaRecord = { key: string; value: unknown };
type CorpusBoxRecord = CorpusBox & { id: number };
type CorpusEntryRecord = CorpusEntry & { id: number };
type SkillRecord = SkillDetail & { created_at: string; updated_at: string };
type SkillDraftRecord = SkillDraft & { created_at: string; updated_at: string };
type SkillTryoutRecord = SkillTryoutResult & { draft_id: number; created_at: string; degraded?: boolean; degraded_reason?: string };
type AmmoBoxRecord = AmmoBoxSummary & { id: number };
type AmmoEntryRecord = AmmoEntry & { id: number };
type CollectionSessionRecord = CollectionSession;
type CollectionCandidateRecord = CollectionBasketItem;

type StoreRecordMap = {
  meta: MetaRecord;
  corpusBoxes: CorpusBoxRecord;
  corpusEntries: CorpusEntryRecord;
  skills: SkillRecord;
  skillDrafts: SkillDraftRecord;
  skillTryouts: SkillTryoutRecord;
  ammoBoxes: AmmoBoxRecord;
  ammoEntries: AmmoEntryRecord;
  collectionSessions: CollectionSessionRecord;
  collectionCandidates: CollectionCandidateRecord;
};

type AutoIdStoreName =
  | "corpusBoxes"
  | "corpusEntries"
  | "skillDrafts"
  | "skillTryouts"
  | "ammoBoxes"
  | "ammoEntries";

type AutoIdStoreInputMap = {
  [K in AutoIdStoreName]: Omit<StoreRecordMap[K], "id"> & { id?: number };
};

type StoreKeyMap = {
  meta: string;
  corpusBoxes: number;
  corpusEntries: number;
  skills: string;
  skillDrafts: number;
  skillTryouts: number;
  ammoBoxes: number;
  ammoEntries: number;
  collectionSessions: string;
  collectionCandidates: string;
};

export type ExtensionStorageArea = Pick<chrome.storage.StorageArea, "get" | "set" | "remove">;

const memoryStorage = new Map<string, unknown>();
let memoryDb: MemoryDatabase | null = null;

const DEFAULT_SETTINGS: RuntimeSettings = {
  base_url: "extension://background",
  api_key_set: false,
  model: "gpt-4o-mini",
  theme: "light",
  language: "zh",
  skill_tryout_rounds: 3,
};

function nowIso() {
  return new Date().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getStorage(): ExtensionStorageArea | null {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) return chrome.storage.local;
  } catch {
    return null;
  }
  return null;
}

async function storageGet<T>(key: string): Promise<T | undefined> {
  const storage = getStorage();
  if (storage) {
    const result = await storage.get(key);
    return result[key] as T | undefined;
  }
  return memoryStorage.get(key) as T | undefined;
}

async function storageSet(key: string, value: unknown): Promise<void> {
  const storage = getStorage();
  if (storage) {
    await storage.set({ [key]: value });
    return;
  }
  memoryStorage.set(key, value);
}

async function openDatabase(): Promise<IDBDatabase | MemoryDatabase> {
  if (typeof indexedDB === "undefined") {
    memoryDb ??= new MemoryDatabase();
    await memoryDb.seed();
    return memoryDb;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      createObjectStore(db, "meta", { keyPath: "key" });
      createObjectStore(db, "corpusBoxes", { keyPath: "id", autoIncrement: true });
      createObjectStore(db, "corpusEntries", { keyPath: "id", autoIncrement: true }, [
        ["box_id", "box_id"],
        ["content", "content"],
      ]);
      createObjectStore(db, "skills", { keyPath: "id" });
      createObjectStore(db, "skillDrafts", { keyPath: "id", autoIncrement: true });
      createObjectStore(db, "skillTryouts", { keyPath: "id", autoIncrement: true }, [["draft_id", "draft_id"]]);
      createObjectStore(db, "ammoBoxes", { keyPath: "id", autoIncrement: true });
      createObjectStore(db, "ammoEntries", { keyPath: "id", autoIncrement: true }, [["box_id", "box_id"]]);
      createObjectStore(db, "collectionSessions", { keyPath: "id" }, [["tab_id", "tab_id"]]);
      createObjectStore(db, "collectionCandidates", { keyPath: "id" }, [
        ["session_id", "session_id"],
        ["dedupe_key", "dedupe_key"],
      ]);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      const db = request.result;
      try {
        await seedBuiltinSkills(db);
        await seedDefaultAmmoBoxes(db);
        resolve(db);
      } catch (error) {
        reject(error);
      }
    };
  });
}

function createObjectStore(
  db: IDBDatabase,
  name: StoreName,
  options: IDBObjectStoreParameters,
  indexes: Array<[string, string]> = [],
) {
  if (db.objectStoreNames.contains(name)) return;
  const store = db.createObjectStore(name, options);
  for (const [indexName, keyPath] of indexes) {
    store.createIndex(indexName, keyPath);
  }
}

function tx(db: IDBDatabase, stores: StoreName | StoreName[], mode: IDBTransactionMode = "readonly") {
  return db.transaction(stores, mode);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function allRecords<T extends StoreName>(storeName: T): Promise<StoreRecordMap[T][]> {
  const db = await openDatabase();
  if (db instanceof MemoryDatabase) return db.all(storeName);
  const transaction = tx(db, storeName);
  return requestToPromise(transaction.objectStore(storeName).getAll()) as Promise<StoreRecordMap[T][]>;
}

async function getRecord<T extends StoreName>(storeName: T, key: StoreKeyMap[T]): Promise<StoreRecordMap[T] | undefined> {
  const db = await openDatabase();
  if (db instanceof MemoryDatabase) return db.get(storeName, key);
  const transaction = tx(db, storeName);
  return requestToPromise(transaction.objectStore(storeName).get(key)) as Promise<StoreRecordMap[T] | undefined>;
}

async function putRecord<T extends StoreName>(storeName: T, record: StoreRecordMap[T]): Promise<StoreKeyMap[T]> {
  const db = await openDatabase();
  if (db instanceof MemoryDatabase) return db.put(storeName, record);
  const transaction = tx(db, storeName, "readwrite");
  const key = await requestToPromise(transaction.objectStore(storeName).put(record));
  await txDone(transaction);
  return key as StoreKeyMap[T];
}

async function addRecord<T extends AutoIdStoreName>(storeName: T, record: AutoIdStoreInputMap[T]): Promise<StoreKeyMap[T]> {
  const db = await openDatabase();
  if (db instanceof MemoryDatabase) return db.add(storeName, record as StoreRecordMap[T]);
  const transaction = tx(db, storeName, "readwrite");
  const key = await requestToPromise(transaction.objectStore(storeName).add(record));
  await txDone(transaction);
  return key as StoreKeyMap[T];
}

async function deleteRecord<T extends StoreName>(storeName: T, key: StoreKeyMap[T]): Promise<void> {
  const db = await openDatabase();
  if (db instanceof MemoryDatabase) {
    db.delete(storeName, key);
    return;
  }
  const transaction = tx(db, storeName, "readwrite");
  transaction.objectStore(storeName).delete(key);
  await txDone(transaction);
}

async function queryByIndex<T extends StoreName>(
  storeName: T,
  indexName: string,
  value: IDBValidKey,
): Promise<StoreRecordMap[T][]> {
  const db = await openDatabase();
  if (db instanceof MemoryDatabase) return db.query(storeName, indexName, value);
  const transaction = tx(db, storeName);
  const store = transaction.objectStore(storeName);
  return requestToPromise(store.index(indexName).getAll(value)) as Promise<StoreRecordMap[T][]>;
}

async function seedBuiltinSkills(db: IDBDatabase): Promise<void> {
  const seeded = await getMetaValue<boolean>("builtinSkillsSeeded", db);
  const transaction = db.transaction(["meta", "skills"], "readwrite");
  const meta = transaction.objectStore("meta");
  const skills = transaction.objectStore("skills");
  for (const detail of getBuiltinSkillDetails()) {
    const existing = await requestToPromise(skills.get(detail.id));
    const timestamp = nowIso();
    skills.put({
      ...detail,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp,
    });
  }
  if (!seeded) meta.put({ key: "builtinSkillsSeeded", value: true });
  await txDone(transaction);
}

async function seedDefaultAmmoBoxes(db: IDBDatabase): Promise<void> {
  const seeded = await getMetaValue<boolean>("defaultAmmoSeeded", db);
  if (seeded) return;

  const timestamp = nowIso();
  const transaction = db.transaction(["meta", "ammoBoxes", "ammoEntries"], "readwrite");
  const meta = transaction.objectStore("meta");
  const ammoBoxes = transaction.objectStore("ammoBoxes");
  const ammoEntries = transaction.objectStore("ammoEntries");
  const existingBoxes = await requestToPromise(ammoBoxes.getAll()) as AmmoBoxRecord[];

  for (const defaultBox of DEFAULT_AMMO_BOXES) {
    const existingBox = existingBoxes.find((box) => box.name === defaultBox.name);
    const boxId = existingBox?.id ?? Number(await requestToPromise(ammoBoxes.add({
      name: defaultBox.name,
      category: defaultBox.category,
      description: defaultBox.description,
      entry_count: 0,
      updated_at: timestamp,
      status: "ready",
    })));

    const existingEntries = await requestToPromise(ammoEntries.index("box_id").getAll(boxId)) as AmmoEntryRecord[];
    const existingTerms = new Set(existingEntries.map((entry) => entry.term));
    let added = 0;
    for (const entry of defaultBox.entries) {
      if (existingTerms.has(entry.term)) continue;
      await requestToPromise(ammoEntries.add({
        box_id: boxId,
        term: entry.term,
        description: entry.description,
      }));
      added += 1;
    }

    const entryCount = existingEntries.length + added;
    ammoBoxes.put({
      ...(existingBox ?? {
        id: boxId,
        name: defaultBox.name,
        category: defaultBox.category,
        description: defaultBox.description,
      }),
      entry_count: entryCount,
      updated_at: added > 0 ? timestamp : existingBox?.updated_at ?? timestamp,
      status: existingBox?.status ?? "ready",
    });
  }

  meta.put({ key: "defaultAmmoSeeded", value: true });
  await txDone(transaction);
}

async function getMetaValue<T>(key: string, existingDb?: IDBDatabase): Promise<T | undefined> {
  const db = existingDb ?? await openDatabase();
  if (db instanceof MemoryDatabase) return db.get("meta", key).then((r) => r?.value as T | undefined);
  const transaction = tx(db, "meta");
  const record = await requestToPromise(transaction.objectStore("meta").get(key)) as MetaRecord | undefined;
  return record?.value as T | undefined;
}

export async function getSettings(): Promise<RuntimeSettings> {
  const saved = await storageGet<Partial<RuntimeSettings>>(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...sanitizeSettings(saved),
    base_url: "extension://background",
    api_key_set: await hasAnyModelApiKey(),
  };
}

export async function saveSettings(payload: Partial<Omit<RuntimeSettings, "api_key_set" | "base_url">>): Promise<RuntimeSettings> {
  const currentRaw = await storageGet<Record<string, unknown>>(SETTINGS_KEY) ?? {};
  const next: Record<string, unknown> = sanitizeSettings(currentRaw);
  for (const [key, value] of Object.entries(payload)) {
    if (key === "api_key" || key === "api_key_set" || key === "base_url") {
      throw new Error(`settings_field_not_allowed:${key}`);
    }
    if (value !== undefined) {
      next[key] = value;
    }
  }
  next.base_url = "extension://background";
  await storageSet(SETTINGS_KEY, next);
  return getSettings();
}

function sanitizeSettings(settings: Record<string, unknown> | undefined): Partial<RuntimeSettings> {
  if (!settings) return {};
  const { api_key: _apiKey, api_key_set: _apiKeySet, base_url: _baseUrl, ...safe } = settings;
  return safe as Partial<RuntimeSettings>;
}

export async function getRawApiKey(): Promise<string> {
  const models = await listModels();
  const model = models.find((item) => item.is_default) ?? models[0];
  if (!model) return "";
  return getModelApiKey(model.id);
}

export async function getModelApiKey(id: number): Promise<string> {
  const key = await storageGet<string>(`${MODEL_KEY_PREFIX}${id}`);
  return typeof key === "string" ? key : "";
}

export async function getDefaultModelConfig(): Promise<ModelConfig | undefined> {
  const models = await listModels();
  return models.find((model) => model.is_default) ?? models[0];
}

export async function listModels(): Promise<ModelConfig[]> {
  const models = await storageGet<ModelConfig[]>(MODELS_KEY);
  return Array.isArray(models) ? models.map(normalizeModelConfigForRead) : [];
}

export async function saveModel(payload: Partial<ModelConfig> & {
  provider?: string;
  model_name?: string;
  base_url?: string;
  api_key?: string;
  api_protocol?: ModelApiProtocol;
  is_default?: boolean;
}): Promise<ModelConfig> {
  const models = await listModels();
  const now = nowIso();
  const existing = typeof payload.id === "number" ? models.find((model) => model.id === payload.id) : undefined;
  const id = existing?.id ?? (models.reduce((max, model) => Math.max(max, model.id), 0) + 1);
  const apiKeyMasked = payload.api_key ? maskApiKey(payload.api_key) : existing?.api_key_masked ?? "";
  const baseUrl = assertHttpsModelBaseUrl(payload.base_url || existing?.base_url || "https://api.openai.com/v1");
  const saved: ModelConfig = {
    id,
    provider: payload.provider || existing?.provider || "OpenAI",
    model_name: payload.model_name || existing?.model_name || "gpt-4o-mini",
    base_url: baseUrl,
    api_key_masked: apiKeyMasked,
    api_protocol: normalizeModelApiProtocol(payload.api_protocol ?? existing?.api_protocol),
    is_default: payload.is_default ?? existing?.is_default ?? models.length === 0,
    created_at: existing?.created_at ?? now,
  };
  let next = models.filter((model) => model.id !== id);
  if (saved.is_default) {
    next = next.map((model) => ({ ...model, is_default: false }));
  }
  next.push(saved);
  await storageSet(MODELS_KEY, next);
  if (payload.api_key) {
    await storageSet(`${MODEL_KEY_PREFIX}${id}`, payload.api_key);
    await saveSettings({ model: saved.model_name });
  }
  return saved;
}

function normalizeModelConfigForRead(model: ModelConfig): ModelConfig {
  return {
    ...model,
    api_protocol: normalizeModelApiProtocol(model.api_protocol),
  };
}

export function normalizeModelApiProtocol(value: unknown): ModelApiProtocol {
  return value === "anthropic_messages" ? "anthropic_messages" : "openai_chat";
}

function assertHttpsModelBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      throw new Error("model_base_url_not_allowed");
    }
    return trimmed;
  } catch (error) {
    if (error instanceof Error && error.message === "model_base_url_not_allowed") throw error;
    throw new Error("model_base_url_not_allowed");
  }
}

export async function deleteModel(id: number): Promise<void> {
  await storageSet(MODELS_KEY, (await listModels()).filter((model) => model.id !== id));
  const storage = getStorage();
  if (storage) {
    await storage.remove(`${MODEL_KEY_PREFIX}${id}`);
  } else {
    memoryStorage.delete(`${MODEL_KEY_PREFIX}${id}`);
  }
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}

async function hasAnyModelApiKey(): Promise<boolean> {
  for (const model of await listModels()) {
    if (await storageGet<string>(`${MODEL_KEY_PREFIX}${model.id}`)) return true;
  }
  return false;
}

export async function listCorpusBoxes(): Promise<CorpusBox[]> {
  const boxes = await allRecords("corpusBoxes");
  const entries = await allRecords("corpusEntries");
  return boxes
    .map((box) => ({ ...box, entry_count: entries.filter((entry) => entry.box_id === box.id).length }))
    .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
}

export async function createCorpusBox(name: string, description = "", platform = "zhihu"): Promise<CorpusBox> {
  const timestamp = nowIso();
  const id = await addRecord("corpusBoxes", {
    name,
    description,
    platform,
    entry_count: 0,
    updated_at: timestamp,
    status: "ready",
  });
  return (await getRecord("corpusBoxes", id as number)) as CorpusBox;
}

export async function deleteCorpusBox(boxId: number): Promise<void> {
  for (const entry of await queryByIndex("corpusEntries", "box_id", boxId)) {
    await deleteRecord("corpusEntries", entry.id);
  }
  await deleteRecord("corpusBoxes", boxId);
}

export async function listCorpusEntries(boxId: number): Promise<CorpusEntry[]> {
  return (await queryByIndex("corpusEntries", "box_id", boxId)).sort((a, b) => a.id - b.id);
}

export async function addCorpusEntries(
  boxId: number,
  entries: Array<{ source: string; content: string; metadata?: Record<string, unknown> }>,
): Promise<CorpusEntry[]> {
  const existing = await listCorpusEntries(boxId);
  const seen = new Set(existing.map((entry) => normalizeText(entry.content)));
  const added: CorpusEntry[] = [];
  for (const entry of entries) {
    const content = entry.content.trim();
    if (!content) continue;
    const key = normalizeText(content);
    if (seen.has(key)) continue;
    seen.add(key);
    const id = await addRecord("corpusEntries", {
      box_id: boxId,
      source: entry.source,
      content,
      metadata: entry.metadata ?? {},
    });
    const created = await getRecord("corpusEntries", id as number);
    if (created) added.push(created);
  }
  const box = await getRecord("corpusBoxes", boxId);
  if (box) {
    await putRecord("corpusBoxes", {
      ...box,
      updated_at: nowIso(),
      entry_count: (await listCorpusEntries(boxId)).length,
      status: "ready",
    });
  }
  return added;
}

export async function startCollectionSession(payload: {
  platform: CollectionPlatform;
  box_id: number;
  creator_url: string;
  requested_count: number;
  tab_id?: number;
}): Promise<CollectionSession> {
  const timestamp = nowIso();
  const box = await getRecord("corpusBoxes", payload.box_id);
  const session: CollectionSession = {
    id: `collection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tab_id: payload.tab_id,
    platform: payload.platform,
    box_id: payload.box_id,
    box_name: box?.name,
    creator_url: payload.creator_url,
    requested_count: payload.requested_count,
    status: "active",
    current_count: 0,
    imported_count: 0,
    skipped_count: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
  await putRecord("collectionSessions", session);
  return session;
}

export async function getCollectionSessionForTab(tabId?: number): Promise<CollectionSession | null> {
  const sessions = await allRecords("collectionSessions");
  const active = sessions
    .filter((session) => session.status === "active")
    .filter((session) => tabId === undefined || session.tab_id === tabId || session.tab_id === undefined)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return active[0] ?? null;
}

export async function getCollectionSession(sessionId: string): Promise<CollectionSession | null> {
  return await getRecord("collectionSessions", sessionId) ?? null;
}

export async function addCollectionCandidates(sessionId: string, candidates: CollectionCandidate[]) {
  const session = await getRecord("collectionSessions", sessionId);
  if (!session) throw new Error("collection_session_not_found");
  if (session.status !== "active") throw new Error("collection_session_not_active");
  const existing = await queryByIndex("collectionCandidates", "session_id", sessionId);
  const seen = new Set(existing.map((item) => item.dedupe_key));
  const limit = Number.isFinite(session.requested_count) ? Math.max(0, Math.floor(session.requested_count)) : Number.POSITIVE_INFINITY;
  let remaining = Math.max(0, limit - existing.length);
  let added = 0;
  let skipped = 0;
  let limitSkipped = 0;
  for (const candidate of candidates) {
    const text = candidate.text.trim();
    if (!text) {
      skipped += 1;
      continue;
    }
    const dedupeKey = candidate.sourceId || normalizeText(`${candidate.platform}:${candidate.kind}:${candidate.url ?? ""}:${text}`);
    if (seen.has(dedupeKey)) {
      skipped += 1;
      continue;
    }
    if (remaining <= 0) {
      skipped += 1;
      limitSkipped += 1;
      continue;
    }
    seen.add(dedupeKey);
    await putRecord("collectionCandidates", {
      ...candidate,
      text,
      id: `candidate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      session_id: sessionId,
      dedupe_key: dedupeKey,
      created_at: nowIso(),
    });
    added += 1;
    remaining -= 1;
  }
  const basketCount = (await queryByIndex("collectionCandidates", "session_id", sessionId)).length;
  const limitReached = basketCount >= limit || limitSkipped > 0;
  await putRecord("collectionSessions", {
    ...session,
    current_count: basketCount,
    skipped_count: session.skipped_count + skipped,
    updated_at: nowIso(),
  });
  return { added, skipped, basket_count: basketCount, limit_reached: limitReached };
}

export async function listCollectionBasket(sessionId: string): Promise<CollectionBasketItem[]> {
  return (await queryByIndex("collectionCandidates", "session_id", sessionId)).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function removeCollectionCandidate(sessionId: string, candidateId: string): Promise<void> {
  const item = await getRecord("collectionCandidates", candidateId);
  if (item?.session_id === sessionId) await deleteRecord("collectionCandidates", candidateId);
  const session = await getRecord("collectionSessions", sessionId);
  if (session) {
    await putRecord("collectionSessions", {
      ...session,
      current_count: (await listCollectionBasket(sessionId)).length,
      updated_at: nowIso(),
    });
  }
}

export async function importCollectionBasket(sessionId: string): Promise<CollectionImportResult> {
  const session = await getRecord("collectionSessions", sessionId);
  if (!session) throw new Error("collection_session_not_found");
  if (session.status !== "active") throw new Error("collection_session_not_active");
  const basket = await listCollectionBasket(sessionId);
  const added = await addCorpusEntries(session.box_id, basket.map((item) => ({
    source: item.platform,
    content: item.text,
    metadata: {
      kind: item.kind,
      title: item.title,
      url: item.url,
      sourceId: item.sourceId,
      publishedAt: item.publishedAt,
      collectionSessionId: sessionId,
    },
  })));
  const skipped = Math.max(0, basket.length - added.length);
  await putRecord("collectionSessions", {
    ...session,
    status: "imported",
    current_count: 0,
    imported_count: session.imported_count + added.length,
    skipped_count: session.skipped_count + skipped,
    updated_at: nowIso(),
  });
  for (const item of basket) {
    await deleteRecord("collectionCandidates", item.id);
  }
  return { imported: added.length, skipped, box_id: session.box_id };
}

export async function endCollectionSession(sessionId: string): Promise<void> {
  const session = await getRecord("collectionSessions", sessionId);
  if (session) await putRecord("collectionSessions", { ...session, status: "ended", updated_at: nowIso() });
}

export async function listSkills(): Promise<SkillInfo[]> {
  const skills = await allRecords("skills");
  return skills.map((record) => {
    const { skill_md: _skillMd, sample_outputs: _samples, files: _files, manifest: _manifest, ...info } = normalizeSkillDetailForRead(record);
    return info;
  });
}

export async function getSkillDetail(skillId: string): Promise<SkillDetail> {
  const detail = await getRecord("skills", skillId);
  if (!detail) throw new Error("skill_not_found");
  return normalizeSkillDetailForRead(detail);
}

export function normalizeSkillDetailForRead(record: Partial<SkillRecord> & { id: string }): SkillDetail {
  const builtin = getBuiltinSkillDetails().find((detail) => detail.id === record.id);
  const source = builtin ? { ...record, ...builtin } : record;
  const { created_at: _created, updated_at: _updated, ...detail } = source;
  return {
    id: detail.id,
    name: stringOrFallback(detail.name, builtin?.name ?? "Untitled Skill"),
    goal: stringOrFallback(detail.goal, builtin?.goal ?? ""),
    summary: stringOrFallback(detail.summary, builtin?.summary ?? ""),
    version: typeof detail.version === "string" ? detail.version : builtin?.version,
    score: typeof detail.score === "number" ? detail.score : builtin?.score,
    confidence: detail.confidence ?? builtin?.confidence,
    recommended_default: detail.recommended_default ?? builtin?.recommended_default,
    risk_tips: Array.isArray(detail.risk_tips) ? detail.risk_tips : builtin?.risk_tips,
    quality: isPlainObject(detail.quality) ? detail.quality : builtin?.quality,
    source: typeof detail.source === "string" ? detail.source : builtin?.source,
    lineage: typeof detail.lineage === "string" ? detail.lineage : builtin?.lineage,
    compile_status: detail.compile_status ?? builtin?.compile_status ?? "compiled",
    skill_md: typeof detail.skill_md === "string" ? detail.skill_md : builtin?.skill_md ?? "",
    sample_outputs: Array.isArray(detail.sample_outputs) ? detail.sample_outputs : builtin?.sample_outputs ?? [],
    files: isStringRecord(detail.files) ? detail.files : builtin?.files ?? {},
    manifest: isPlainObject(detail.manifest) ? detail.manifest : builtin?.manifest ?? {},
  };
}

export async function compileSkill(files: Record<string, string>, skillId?: string, requireSamples = false) {
  const rejected = findExecutableSkillFiles(files);
  if (rejected.length > 0) {
    return { ok: false, errors: rejected.map((name) => `Executable files are not allowed in Skill packages: ${name}`) };
  }
  const skillMd = files["SKILL.md"] || Object.values(files)[0] || "";
  if (!skillMd.trim()) {
    return { ok: false, errors: ["SKILL.md is required"] };
  }
  const provisionalName = parseSkillName(skillMd) || "Imported Skill";
  const provisionalId = skillId || toId(provisionalName);
  const provisionalExisting = await getRecord("skills", provisionalId);
  if (isBuiltinSkillReference(provisionalId, provisionalName) || provisionalExisting?.compile_status === "builtin") {
    return { ok: false, errors: [`Cannot overwrite built-in Skill: ${provisionalId}`] };
  }
  if (skillId && !provisionalExisting) {
    return { ok: false, errors: [`Skill not found: ${skillId}`] };
  }
  const packageErrors = validateSkillPackageFiles(files, { requireSamples });
  if (packageErrors.length > 0) return { ok: false, errors: packageErrors };
  const manifest = parseJsonRecord(files["manifest.json"]) ?? {};
  const manifestId = String(manifest.id).trim();
  const manifestName = String(manifest.name).trim();
  const id = skillId || manifestId;
  const name = manifestName;
  const existing = skillId ? provisionalExisting : await getRecord("skills", id);
  if (isBuiltinSkillReference(id, name) || existing?.compile_status === "builtin") {
    return { ok: false, errors: [`Cannot overwrite built-in Skill: ${id}`] };
  }
  const timestamp = nowIso();
  const detail: SkillRecord = {
    id,
    name,
    goal: stringOrFallback(manifest.goal, "Imported Skill"),
    summary: stringOrFallback(manifest.summary, "Imported from local file."),
    version: stringOrFallback(manifest.version, "0.1.0"),
    compile_status: "compiled",
    confidence: "low",
    score: 50,
    skill_md: skillMd,
    sample_outputs: parseSampleOutputs(files["sample_outputs.json"]),
    files,
    manifest: { imported: true, ...manifest },
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  };
  await putRecord("skills", detail);
  const { skill_md: _skillMd, sample_outputs: _samples, files: _files, manifest: _manifest, created_at: _created, updated_at: _updated, ...info } = detail;
  return { ok: true, skill: info };
}

export async function createSkillDraft(payload: { source_box_ids: number[]; skill_name: string; skill_goal: string }): Promise<SkillDraft> {
  const timestamp = nowIso();
  const sourceBoxIds = Array.isArray(payload.source_box_ids) ? payload.source_box_ids.filter(Number.isFinite) : [];
  const generatedFiles = await createDraftFilesFromModel(payload.skill_name, payload.skill_goal, sourceBoxIds);
  const draftId = await addRecord("skillDrafts", {
    name: payload.skill_name,
    goal: payload.skill_goal,
    status: "draft",
    files: generatedFiles,
    draft_version: 1,
    feedback_cycles: 0,
    source_box_ids: sourceBoxIds,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return (await getRecord("skillDrafts", draftId as number)) as SkillDraft;
}

export async function runSkillTryout(
  draftId: number,
  userUtterance: string,
  roundIndex: number,
  lengthSettings: LengthSettings = { lengthMode: "短" },
): Promise<SkillTryoutResult> {
  const draft = await getRecord("skillDrafts", draftId);
  if (!draft) throw new Error("draft_not_found");
  const { reply, degraded, degraded_reason } = await createTryoutReply(draft, userUtterance, roundIndex, lengthSettings);
  const id = await addRecord("skillTryouts", {
    draft_id: draftId,
    draft_version: draft.draft_version,
    round_index: roundIndex,
    user_utterance: userUtterance,
    reply,
    degraded,
    degraded_reason,
    created_at: nowIso(),
  });
  const record = await getRecord("skillTryouts", id as number);
  if (!record) throw new Error("tryout_not_found");
  const { draft_id: _draftId, created_at: _created, ...result } = record;
  return result;
}

export async function rateSkillTryout(
  tryoutId: number,
  rating: "accepted" | "rejected" | null,
  rejectionReason?: string,
  annotation?: string,
): Promise<SkillTryoutResult> {
  const record = await getRecord("skillTryouts", tryoutId);
  if (!record) throw new Error("tryout_not_found");
  const updated: SkillTryoutRecord = {
    ...record,
    user_rating: rating,
    rejection_reason: rejectionReason,
    user_annotation: annotation,
  };
  await putRecord("skillTryouts", updated);
  const { draft_id: _draftId, created_at: _created, ...result } = updated;
  return result;
}

export async function applySkillFeedback(draftId: number, feedback: string, tags: string[]): Promise<SkillDraft> {
  const draft = await getRecord("skillDrafts", draftId);
  if (!draft) throw new Error("draft_not_found");
  if (draft.feedback_cycles >= MAX_SKILL_CREATOR_FEEDBACK_CYCLES) {
    throw new Error("skill_creator_feedback_limit_reached");
  }
  const rebuiltFiles = await createDraftFilesFromModel(draft.name, draft.goal, draft.source_box_ids ?? [], {
    previousFiles: draft.files,
    tryouts: (await queryByIndex("skillTryouts", "draft_id", draftId))
      .filter((tryout) => tryout.draft_version === draft.draft_version),
    feedback,
    tags,
  });
  const next: SkillDraftRecord = {
    ...draft,
    files: {
      ...rebuiltFiles,
      "feedback.json": JSON.stringify({ feedback, tags }, null, 2),
    },
    draft_version: draft.draft_version + 1,
    feedback_cycles: draft.feedback_cycles + 1,
    updated_at: nowIso(),
  };
  await putRecord("skillDrafts", next);
  return next;
}

export async function publishSkillDraft(draftId: number, acceptedTryoutIds: number[] = []): Promise<SkillInfo & { stability_warning?: string }> {
  const draft = await getRecord("skillDrafts", draftId);
  if (!draft) throw new Error("draft_not_found");
  const sampleOutputs = mergeSampleOutputs(
    parseSampleOutputs(draft.files["sample_outputs.json"]),
    await listAcceptedTryoutSamples(draftId, acceptedTryoutIds, draft.draft_version),
  );
  if (sampleOutputs.length < 2) {
    throw new Error("skill_creator_publish_blocked:sample_outputs.json must contain at least 2 usable samples after merging accepted tryouts");
  }
  const packageErrors = validateSkillPackageFiles(draft.files, { requireSamples: false });
  if (packageErrors.length > 0) {
    throw new Error(`skill_creator_publish_blocked:${packageErrors.join(",")}`);
  }
  const manifest = parseJsonRecord(draft.files["manifest.json"]) ?? {};
  const id = `draft-${draft.id}`;
  const timestamp = nowIso();
  const files: Record<string, string> = {
    ...draft.files,
    "sample_outputs.json": JSON.stringify(sampleOutputs, null, 2),
  };
  const publishedManifest = {
    ...manifest,
    quality: { combined_score: 64, reviewer: "extension-rule" },
    source_box_ids: draft.source_box_ids ?? [],
  };
  files["manifest.json"] = JSON.stringify(publishedManifest, null, 2);
  const detail: SkillRecord = {
    id,
    name: draft.name,
    goal: draft.goal,
    summary: stringOrFallback(manifest.summary, "Published from Skill Workshop."),
    version: stringOrFallback(manifest.version, "0.1.0"),
    score: 64,
    confidence: "low",
    compile_status: "compiled",
    risk_tips: ["No LLM quality review; Big-V Skills cannot publish as high confidence."],
    skill_md: files["SKILL.md"] ?? `# ${draft.name}`,
    sample_outputs: sampleOutputs,
    files,
    manifest: publishedManifest,
    created_at: timestamp,
    updated_at: timestamp,
  };
  await putRecord("skills", detail);
  const { skill_md: _skillMd, sample_outputs: _samples, files: _files, manifest: _manifest, created_at: _created, updated_at: _updated, ...info } = detail;
  return info;
}

async function createDraftFilesFromModel(
  skillName: string,
  skillGoal: string,
  sourceBoxIds: number[],
  rebuild?: { previousFiles: Record<string, string>; tryouts: SkillTryoutResult[]; feedback: string; tags: string[] },
): Promise<Record<string, string>> {
  const [model, apiKey, skillCreatorSkill] = await Promise.all([
    getDefaultModelConfig(),
    getRawApiKey(),
    getSkillDetail("skill_creator").catch(() => undefined),
  ]);
  if (!model || !apiKey) throw new Error("skill_creator_model_required");

  const entries = (await Promise.all(sourceBoxIds.map((boxId) => listCorpusEntries(boxId).catch(() => [])))).flat();
  assertSufficientSkillCreatorMaterial(entries);
  const generated = await generateSkillDraftFiles({
    model,
    apiKey,
    skillName,
    skillGoal,
    sourceBoxIds,
    entries,
    previousFiles: rebuild?.previousFiles,
    tryouts: rebuild?.tryouts,
    feedback: rebuild?.feedback,
    tags: rebuild?.tags,
    skillCreatorSkill,
  }).catch((error) => {
    throw new Error(skillCreatorModelErrorCode(error));
  });
  const files = skillGenerationToFiles(generated, sourceBoxIds, { skillName, skillGoal });
  const packageErrors = validateSkillPackageFiles(files, { requireSamples: false });
  if (packageErrors.length > 0) throw new Error(`skill_creator_invalid_output:${packageErrors.join(",")}`);
  return files;
}

async function createTryoutReply(
  draft: SkillDraft,
  userUtterance: string,
  roundIndex: number,
  lengthSettings: LengthSettings,
): Promise<{ reply: string; degraded?: boolean; degraded_reason?: string }> {
  const [model, apiKey] = await Promise.all([getDefaultModelConfig(), getRawApiKey()]);
  const lengthConstraint = resolveLengthConstraint(lengthSettings);
  let degradedReason: string | undefined;
  if (model && apiKey) {
    try {
      const reply = trimToMaxChars(
        await runModelSkillTryout({ model, apiKey, draft, userUtterance, roundIndex, lengthConstraint }),
        lengthConstraint.maxChars,
      );
      if (reply) return { reply };
    } catch (error) {
      degradedReason = skillCreatorModelErrorCode(error);
      // Fall through to deterministic fallback.
    }
  }
  return {
    reply: trimToMaxChars(deterministicReply(userUtterance, draft.goal), lengthConstraint.maxChars),
    degraded: true,
    degraded_reason: degradedReason,
  };
}

function skillCreatorModelErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (raw.startsWith("skill_creator_")) return raw;
  if (raw === "model_api_key_missing") return "skill_creator_model_required";
  if (raw === "model_name_missing") return "skill_creator_model_name_missing";
  if (raw === "model_base_url_not_allowed") return "skill_creator_model_base_url_invalid";
  if (raw === "model_request_timeout") return "skill_creator_model_timeout";
  if (raw === "model_output_truncated") return "skill_creator_model_output_truncated";

  const status = typeof (error as { status?: unknown } | null)?.status === "number"
    ? (error as { status: number }).status
    : undefined;
  const detail = redactSecret(raw.trim() || "model_request_failed");
  return status
    ? `skill_creator_model_request_failed_${status}:${detail}`
    : `skill_creator_model_request_failed:${detail}`;
}

function parseSampleOutputs(value: string | undefined): SkillDetail["sample_outputs"] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isPlainObject)
      .map((item) => ({
        prompt: typeof item.prompt === "string" ? item.prompt : typeof item.input === "string" ? item.input : undefined,
        reply: typeof item.reply === "string" ? item.reply : typeof item.output === "string" ? item.output : undefined,
        input: typeof item.input === "string" ? item.input : undefined,
        output: typeof item.output === "string" ? item.output : undefined,
      }))
      .filter((sample) => {
        const prompt = sample.prompt ?? sample.input ?? "";
        const reply = sample.reply ?? sample.output ?? "";
        return prompt.trim() !== "" && reply.trim() !== "";
      });
  } catch {
    return [];
  }
}

async function listAcceptedTryoutSamples(
  draftId: number,
  acceptedTryoutIds: number[],
  draftVersion: number,
): Promise<SkillDetail["sample_outputs"]> {
  if (acceptedTryoutIds.length === 0) return [];
  const accepted = new Set(acceptedTryoutIds);
  return (await queryByIndex("skillTryouts", "draft_id", draftId))
    .filter((tryout) => accepted.has(tryout.id))
    .filter((tryout) => tryout.draft_version === draftVersion)
    .filter((tryout) => tryout.user_utterance.trim() !== "" && tryout.reply.trim() !== "")
    .map((tryout) => ({
      prompt: tryout.user_utterance,
      reply: tryout.reply,
      input: tryout.user_utterance,
      output: tryout.reply,
    }));
}

function mergeSampleOutputs(
  existing: SkillDetail["sample_outputs"],
  accepted: SkillDetail["sample_outputs"],
): SkillDetail["sample_outputs"] {
  const seen = new Set<string>();
  const merged: SkillDetail["sample_outputs"] = [];
  for (const sample of [...existing, ...accepted]) {
    const prompt = sample.prompt ?? sample.input ?? "";
    const reply = sample.reply ?? sample.output ?? "";
    if (!prompt.trim() || !reply.trim()) continue;
    const key = normalizeText(`${prompt}\n${reply}`);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(sample);
  }
  return merged;
}

function assertSufficientSkillCreatorMaterial(entries: CorpusEntry[]): void {
  const effective = entries.map((entry) => entry.content.trim()).filter(Boolean);
  const totalLength = effective.reduce((sum, text) => sum + [...text].length, 0);
  if (effective.length < MIN_SKILL_CREATOR_ENTRIES && totalLength < MIN_SKILL_CREATOR_TEXT_LENGTH) {
    throw new Error("skill_creator_material_insufficient");
  }
}

function validateSkillPackageFiles(files: Record<string, string>, options: { requireSamples?: boolean } = {}): string[] {
  const errors: string[] = [];
  for (const name of ["manifest.json", "SKILL.md", "style_profile.json", "attack_playbook.json"]) {
    if (!files[name]?.trim()) errors.push(`${name} is required`);
  }
  if (errors.length > 0) return errors;

  const manifest = parseJsonRecord(files["manifest.json"]);
  if (!manifest) errors.push("manifest.json must be valid JSON");
  if (manifest) {
    const missingManifestFields = ["id", "name", "goal", "version"]
      .filter((field) => !String(manifest[field] ?? "").trim());
    if (missingManifestFields.length > 0) {
      errors.push(`manifest.json missing required fields: ${missingManifestFields.join(", ")}`);
    }
  }
  const skillMd = files["SKILL.md"].trim();
  const frontmatter = parseSkillFrontmatter(skillMd);
  if (!frontmatter) {
    errors.push("SKILL.md must start with YAML frontmatter containing name and description");
  }
  const styleProfile = parseJsonRecord(files["style_profile.json"]);
  if (!styleProfile || Object.keys(styleProfile).length === 0) errors.push("style_profile.json must be a non-empty JSON object");
  const attackPlaybook = parseJsonRecord(files["attack_playbook.json"]);
  if (!attackPlaybook || Object.keys(attackPlaybook).length === 0) errors.push("attack_playbook.json must be a non-empty JSON object");
  const taxonomy = attackPlaybook?.taxonomy;
  if (!isPlainObject(taxonomy) || Object.keys(taxonomy).sort().join("|") !== ATTACK_TAXONOMY.slice().sort().join("|")) {
    errors.push("attack_playbook.json must define the fixed 8-class taxonomy");
  } else if (!ATTACK_TAXONOMY.every((key) => {
    const value = taxonomy[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  })) {
    errors.push("attack_playbook.json taxonomy values must be numbers between 0 and 1");
  }
  if (options.requireSamples) {
    const samples = parseSampleOutputs(files["sample_outputs.json"]);
    if (samples.length < 2) errors.push("sample_outputs.json must contain at least 2 usable samples");
  }
  return errors;
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseSkillFrontmatter(skillMd: string): Record<string, string> | null {
  if (!skillMd.startsWith("---\n")) return null;
  const end = skillMd.indexOf("\n---", 4);
  if (end === -1) return null;
  const raw = skillMd.slice(4, end).trim();
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  }
  const name = values.name ?? "";
  const description = values.description ?? "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return null;
  if (!description.startsWith("Use when")) return null;
  return values;
}

export async function listAmmoBoxes(): Promise<AmmoBoxSummary[]> {
  const boxes = await allRecords("ammoBoxes");
  const entries = await allRecords("ammoEntries");
  return boxes.map((box) => ({ ...box, entry_count: entries.filter((entry) => entry.box_id === box.id).length }));
}

export async function createAmmoBox(payload: { name: string; category: "meme" | "knowledge"; description: string }): Promise<AmmoBoxSummary> {
  const id = await addRecord("ammoBoxes", {
    name: payload.name,
    category: payload.category,
    description: payload.description,
    entry_count: 0,
    updated_at: nowIso(),
    status: "ready",
  });
  return (await getRecord("ammoBoxes", id as number)) as AmmoBoxSummary;
}

export async function deleteAmmoBox(id: number): Promise<void> {
  for (const entry of await queryByIndex("ammoEntries", "box_id", id)) {
    await deleteRecord("ammoEntries", entry.id);
  }
  await deleteRecord("ammoBoxes", id);
}

export async function listAmmoEntries(boxId: number): Promise<AmmoEntry[]> {
  return (await queryByIndex("ammoEntries", "box_id", boxId)).sort((a, b) => a.id - b.id);
}

export async function addAmmoEntry(boxId: number, term: string, description: string): Promise<AmmoEntry> {
  const id = await addRecord("ammoEntries", { box_id: boxId, term, description });
  const box = await getRecord("ammoBoxes", boxId);
  if (box) {
    await putRecord("ammoBoxes", { ...box, updated_at: nowIso(), entry_count: (await listAmmoEntries(boxId)).length });
  }
  return (await getRecord("ammoEntries", id as number)) as AmmoEntry;
}

export async function deleteAmmoEntry(_boxId: number, entryId: number): Promise<void> {
  await deleteRecord("ammoEntries", entryId);
}

function deterministicReply(text: string, goal: string): string {
  const input = text.trim() || "这句话";
  if (goal.includes("克制")) return `先别急着下结论，${input} 这里跳过了最关键的前提。`;
  if (goal.includes("讽刺")) return `如果这也算论证，那省略事实可能就是你的核心方法了。`;
  return `${input} 这个说法最大的问题，是把结论当成了证据。`;
}

function parseSkillName(skillMd: string): string | null {
  const yamlName = skillMd.match(/name:\s*["']?([^"'\n]+)["']?/i)?.[1]?.trim();
  if (yamlName) return yamlName;
  const heading = skillMd.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || null;
}

function toId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-").replace(/^-+|-+$/g, "") || `skill-${Date.now()}`;
}

function isBuiltinSkillReference(skillId: string, skillName: string): boolean {
  const normalizedId = normalizeSkillKey(skillId);
  const normalizedName = normalizeSkillKey(skillName);
  return getBuiltinSkillDetails().some((detail) =>
    normalizeSkillKey(detail.id) === normalizedId ||
    normalizeSkillKey(detail.name) === normalizedName
  );
}

function normalizeSkillKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function redactSecret(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-••••");
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}

export function resetExtensionDataForTests(): void {
  memoryStorage.clear();
  memoryDb = null;
}

function memoryKeyFor<T extends StoreName>(storeName: T, record: StoreRecordMap[T]): StoreKeyMap[T] {
  if (storeName === "meta") return (record as MetaRecord).key as StoreKeyMap[T];
  return (record as unknown as { id: StoreKeyMap[T] }).id;
}

class MemoryDatabase {
  private stores: { [K in StoreName]: Map<StoreKeyMap[K], StoreRecordMap[K]> } = {
    meta: new Map(),
    corpusBoxes: new Map(),
    corpusEntries: new Map(),
    skills: new Map(),
    skillDrafts: new Map(),
    skillTryouts: new Map(),
    ammoBoxes: new Map(),
    ammoEntries: new Map(),
    collectionSessions: new Map(),
    collectionCandidates: new Map(),
  };

  private counters: Record<string, number> = {};

  async seed() {
    const timestamp = nowIso();
    for (const detail of getBuiltinSkillDetails()) {
      const existing = this.stores.skills.get(detail.id as never) as SkillRecord | undefined;
      this.stores.skills.set(detail.id, {
        ...detail,
        created_at: existing?.created_at ?? timestamp,
        updated_at: timestamp,
      });
    }
    this.stores.meta.set("builtinSkillsSeeded", { key: "builtinSkillsSeeded", value: true });
    await this.seedDefaultAmmoBoxes(timestamp);
  }

  private async seedDefaultAmmoBoxes(timestamp: string): Promise<void> {
    if (this.stores.meta.has("defaultAmmoSeeded")) return;

    for (const defaultBox of DEFAULT_AMMO_BOXES) {
      const existingBox = [...this.stores.ammoBoxes.values()].find((box) => box.name === defaultBox.name);
      const boxId = existingBox?.id ?? await this.add("ammoBoxes", {
        name: defaultBox.name,
        category: defaultBox.category,
        description: defaultBox.description,
        entry_count: 0,
        updated_at: timestamp,
        status: "ready",
      } as AmmoBoxRecord);

      const existingEntries = [...this.stores.ammoEntries.values()].filter((entry) => entry.box_id === boxId);
      const existingTerms = new Set(existingEntries.map((entry) => entry.term));
      let added = 0;
      for (const entry of defaultBox.entries) {
        if (existingTerms.has(entry.term)) continue;
        await this.add("ammoEntries", {
          box_id: boxId,
          term: entry.term,
          description: entry.description,
        } as AmmoEntryRecord);
        added += 1;
      }

      await this.put("ammoBoxes", {
        ...(existingBox ?? {
          id: boxId,
          name: defaultBox.name,
          category: defaultBox.category,
          description: defaultBox.description,
        }),
        entry_count: existingEntries.length + added,
        updated_at: added > 0 ? timestamp : existingBox?.updated_at ?? timestamp,
        status: existingBox?.status ?? "ready",
      });
    }

    this.stores.meta.set("defaultAmmoSeeded", { key: "defaultAmmoSeeded", value: true });
  }

  async all<T extends StoreName>(storeName: T): Promise<StoreRecordMap[T][]> {
    return [...this.stores[storeName].values()].map(clone) as StoreRecordMap[T][];
  }

  async get<T extends StoreName>(storeName: T, key: StoreKeyMap[T]): Promise<StoreRecordMap[T] | undefined> {
    const value = this.stores[storeName].get(key as never);
    return value ? clone(value) : undefined;
  }

  async put<T extends StoreName>(storeName: T, record: StoreRecordMap[T]): Promise<StoreKeyMap[T]> {
    const key = memoryKeyFor(storeName, record);
    this.stores[storeName].set(key as never, clone(record) as never);
    return key;
  }

  async add<T extends StoreName>(storeName: T, record: StoreRecordMap[T]): Promise<StoreKeyMap[T]> {
    const next = clone(record) as StoreRecordMap[T] & { id?: number };
    if (typeof next.id !== "number") {
      this.counters[storeName] = (this.counters[storeName] ?? 0) + 1;
      next.id = this.counters[storeName];
    }
    await this.put(storeName, next as StoreRecordMap[T]);
    return next.id as StoreKeyMap[T];
  }

  delete<T extends StoreName>(storeName: T, key: StoreKeyMap[T]): void {
    this.stores[storeName].delete(key as never);
  }

  async query<T extends StoreName>(storeName: T, indexName: string, value: IDBValidKey): Promise<StoreRecordMap[T][]> {
    const items = await this.all(storeName);
    return items.filter((item) => (item as Record<string, unknown>)[indexName] === value);
  }
}
