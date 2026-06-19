/**
 * 应用内检查更新（后台逻辑）。
 *
 * 设计：多源顺序探测，命中第一个成功源即返回。中国大陆直连 GitHub 不稳，
 * 用 GitHub API + jsDelivr CDN（testingcf/gcore）多个源回退。
 *
 * UI 层不直接 fetch（见 App.test.tsx 断言），所有网络请求都在这里完成，
 * UI 通过 `extension:checkUpdate` 消息调用。
 */
import { DOWNLOAD_MIRRORS, UPDATE_CHECK_SOURCES } from "./updateSources";

/** 单源请求超时（毫秒）。检查更新数据量极小，给短超时快速回退。 */
const UPDATE_SOURCE_TIMEOUT_MS = 6_000;

export type UpdateCheckResult =
  | {
      ok: true;
      /** 是否有新版本。 */
      hasUpdate: boolean;
      /** 当前版本（来自 manifest）。 */
      currentVersion: string;
      /** 最新版本号（不带 v 前缀）。 */
      latestVersion: string;
      /** 最新版本的 tag（带 v 前缀），用于拼下载链接。 */
      tagName: string;
      /** Release 页面 URL（GitHub）。 */
      releaseUrl: string;
      /** Release notes（仅 github-api 源有）。 */
      releaseNotes?: string;
      /** 实际命中的源 id。 */
      source: string;
      /** 下载镜像列表（透传给 UI）。 */
      mirrors: Array<{ id: string; labelKey: string; url: string }>;
    }
  | { ok: false; error: string };

/**
 * 检查更新入口。读取当前 manifest 版本，遍历 UPDATE_CHECK_SOURCES 顺序探测。
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = readCurrentVersion();

  for (const source of UPDATE_CHECK_SOURCES) {
    try {
      const fetched = await fetchLatestFromSource(source);
      if (!fetched) continue;

      const latestVersion = stripVersionPrefix(fetched.version);
      if (!isValidSemver(latestVersion)) continue;

      const tagName = ensureTagPrefix(latestVersion);
      const hasUpdate = isVersionGreater(latestVersion, currentVersion);
      const mirrors = DOWNLOAD_MIRRORS.map((m) => ({
        id: m.id,
        labelKey: m.labelKey,
        url: m.url(tagName),
      }));

      return {
        ok: true,
        hasUpdate,
        currentVersion,
        latestVersion,
        tagName,
        releaseUrl: fetched.releaseUrl ?? defaultReleaseUrl(tagName),
        releaseNotes: fetched.releaseNotes,
        source: source.id,
        mirrors,
      };
    } catch {
      // 当前源失败，静默继续下一个源。
    }
  }

  return { ok: false, error: "update_check_all_sources_failed" };
}

type FetchedVersion = {
  version: string;
  releaseUrl?: string;
  releaseNotes?: string;
};

type UpdateCheckSourceLike = {
  id: string;
  url: string;
  kind: "github-api" | "manifest-json";
};

/** 按源 kind 解析返回内容。 */
async function fetchLatestFromSource(source: UpdateCheckSourceLike): Promise<FetchedVersion | null> {
  const response = await fetchWithTimeout(source.url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;

  const body = await readJson(response);
  if (source.kind === "github-api") return parseGithubRelease(body);
  if (source.kind === "manifest-json") return parseManifest(body);
  return null;
}

/** 解析 GitHub releases/latest 的 JSON。 */
function parseGithubRelease(body: unknown): FetchedVersion | null {
  if (!isPlainObject(body)) return null;
  const tagName = typeof body.tag_name === "string" ? body.tag_name : "";
  if (!tagName) return null;
  return {
    version: tagName,
    releaseUrl: typeof body.html_url === "string" ? body.html_url : undefined,
    releaseNotes: typeof body.body === "string" ? body.body : undefined,
  };
}

/** 解析 manifest.json，取 version 字段。 */
function parseManifest(body: unknown): FetchedVersion | null {
  if (!isPlainObject(body)) return null;
  const version = typeof body.version === "string" ? body.version : "";
  if (!version) return null;
  return { version };
}

function readCurrentVersion(): string {
  try {
    const manifest = chrome.runtime.getManifest();
    if (manifest?.version) return manifest.version;
  } catch {
    /* getManifest 在测试环境可能不可用 */
  }
  return "0.0.0";
}

function defaultReleaseUrl(tagName: string): string {
  return `https://github.com/luyishui/clapback/releases/tag/${tagName}`;
}

/**
 * 比较两个语义化版本号。返回 latestVersion > currentVersion 时为 true。
 * 支持 "1.2.3"、"1.2"、"1.2.3-beta" 等常见形式；预发布标签按字符串比较。
 */
export function isVersionGreater(latestVersion: string, currentVersion: string): boolean {
  const latest = parseSemver(latestVersion);
  const current = parseSemver(currentVersion);
  if (!latest || !current) return false;
  for (let i = 0; i < 3; i++) {
    if (latest.nums[i] > current.nums[i]) return true;
    if (latest.nums[i] < current.nums[i]) return false;
  }
  if (!latest.prerelease && current.prerelease) return true;
  if (latest.prerelease && !current.prerelease) return false;
  if (latest.prerelease && current.prerelease) {
    return comparePrerelease(latest.prerelease, current.prerelease) > 0;
  }
  return false;
}

export function isValidSemver(version: string): boolean {
  return parseSemver(version) !== null;
}

type ParsedSemver = { nums: [number, number, number]; prerelease?: string };

export function parseSemver(version: string): ParsedSemver | null {
  const cleaned = version.trim().replace(/^v/i, "");
  // 拆出预发布部分。
  const [mainPart, prerelease] = cleaned.split(/[-+]/, 2);
  const parts = mainPart.split(".");
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = [0, 0, 0];
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n) || n < 0 || !/^\d+$/.test(parts[i])) return null;
    nums[i] = Math.floor(n);
  }
  return { nums: nums as [number, number, number], prerelease: prerelease || undefined };
}

function comparePrerelease(latest: string, current: string): number {
  const latestParts = latest.split(".");
  const currentParts = current.split(".");
  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i++) {
    const left = latestParts[i];
    const right = currentParts[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
    const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return left > right ? 1 : -1;
  }
  return 0;
}

/** 去掉版本号前的 v 前缀（兼容 "v0.2.0" 和 "0.2.0"）。 */
export function stripVersionPrefix(version: string): string {
  return version.trim().replace(/^v+/i, "");
}

/** 确保版本号带 v 前缀（作为 tag）。 */
export function ensureTagPrefix(version: string): string {
  const cleaned = stripVersionPrefix(version);
  return cleaned.startsWith("v") ? cleaned : `v${cleaned}`;
}

// --- 工具函数（风格对齐 modelConnection.ts，但本模块自用、不导出） ---

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = UPDATE_SOURCE_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Response>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("update_source_timeout"));
    }, Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) throw new Error("update_source_timeout");
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
