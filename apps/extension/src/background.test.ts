import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CONTENT_SCRIPT_URL_PATTERNS, injectContentScriptIntoOpenTabs, registerBackgroundHandlers } from "./background";

const MODEL_API_URL_PATTERNS = [
  "https://api.openai.com/*",
  "https://api.anthropic.com/*",
  "https://api.deepseek.com/*",
  "https://api.moonshot.cn/*",
  "https://opencode.ai/*",
];
const OPTIONAL_MODEL_API_URL_PATTERNS = ["https://*/*"];

describe("background content script recovery", () => {
  it("declares host access and scripting permission for supported content pages", () => {
    const manifests = ["public/manifest.json", "dist/manifest.json"].map((path) => (
      JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")) as {
        permissions?: string[];
        host_permissions?: string[];
        options_ui?: { page?: string; open_in_tab?: boolean };
        content_scripts?: Array<{ matches?: string[]; js?: string[] }>;
        web_accessible_resources?: Array<{ resources?: string[]; matches?: string[] }>;
        [key: string]: unknown;
      }
    ));
    const optionalHostKey = ["optional", "host_permissions"].join("_");
    const legacyPagePermission = ["active", "Tab"].join("");
    const allUrlsPattern = ["<all", "urls>"].join("_");

    for (const manifest of manifests) {
      const matches = manifest.content_scripts?.[0]?.matches ?? [];
      expect(manifest.permissions).toContain("scripting");
      expect(manifest.permissions).not.toContain(legacyPagePermission);
      expect(manifest.options_ui).toEqual({ page: "index.html", open_in_tab: true });
      expect(manifest.host_permissions).toEqual([
        ...CONTENT_SCRIPT_URL_PATTERNS,
        ...MODEL_API_URL_PATTERNS,
      ]);
      expect(matches).toEqual(CONTENT_SCRIPT_URL_PATTERNS);
      expect(manifest.web_accessible_resources).toContainEqual({
        resources: ["fonts/*"],
        matches: CONTENT_SCRIPT_URL_PATTERNS,
      });
      expect(manifest.web_accessible_resources).not.toContainEqual({
        resources: ["index.html", "assets/index.js", "assets/index.css"],
        matches: [allUrlsPattern],
      });
      expect(manifest.web_accessible_resources?.some((entry) => entry.matches?.includes(allUrlsPattern))).toBe(false);
      expect(manifest.content_scripts?.[0]?.js).toEqual(["assets/content.js"]);
      expect(manifest[optionalHostKey]).toEqual(OPTIONAL_MODEL_API_URL_PATTERNS);
    }
  });

  it("injects the content script into already-open supported tabs", async () => {
    const query = vi.fn(async () => [{ id: 11 }, { id: undefined }, { id: 12 }]);
    const executeScript = vi.fn(async () => []);

    await injectContentScriptIntoOpenTabs({
      tabs: { query },
      scripting: { executeScript },
    });

    expect(query).toHaveBeenCalledWith({ url: CONTENT_SCRIPT_URL_PATTERNS });
    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(executeScript).toHaveBeenNthCalledWith(1, {
      target: { tabId: 11 },
      files: ["assets/content.js"],
    });
    expect(executeScript).toHaveBeenNthCalledWith(2, {
      target: { tabId: 12 },
      files: ["assets/content.js"],
    });
  });

  it("keeps injecting other tabs when one tab rejects script injection", async () => {
    const query = vi.fn(async () => [{ id: 21 }, { id: 22 }]);
    const executeScript = vi.fn(async ({ target }: { target: { tabId: number } }) => {
      if (target.tabId === 21) throw new Error("cannot access tab");
      return [];
    });

    await expect(injectContentScriptIntoOpenTabs({
      tabs: { query },
      scripting: { executeScript },
    })).resolves.toBeUndefined();

    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it("wires install and startup events to content script recovery injection", () => {
    const installedCallbacks: Array<() => void> = [];
    const startupCallbacks: Array<() => void> = [];
    const query = vi.fn(async () => []);
    const executeScript = vi.fn(async () => []);

    registerBackgroundHandlers({
      action: { onClicked: { addListener: vi.fn() } },
      runtime: {
        getURL: (path: string) => path,
        onInstalled: { addListener: (callback: () => void) => installedCallbacks.push(callback) },
        onStartup: { addListener: (callback: () => void) => startupCallbacks.push(callback) },
        onMessage: { addListener: vi.fn() },
      },
      tabs: { create: vi.fn(), query },
      scripting: { executeScript },
    });

    expect(query).toHaveBeenCalledWith({ url: CONTENT_SCRIPT_URL_PATTERNS });
    expect(installedCallbacks).toHaveLength(1);
    expect(startupCallbacks).toHaveLength(1);

    query.mockClear();
    installedCallbacks[0]();
    expect(query).toHaveBeenCalledWith({ url: CONTENT_SCRIPT_URL_PATTERNS });

    query.mockClear();
    startupCallbacks[0]();
    expect(query).toHaveBeenCalledWith({ url: CONTENT_SCRIPT_URL_PATTERNS });
  });

  it("opens the Workbench tab through the extension action", () => {
    let clicked: (() => void) | undefined;
    const create = vi.fn();

    registerBackgroundHandlers({
      action: { onClicked: { addListener: (callback: () => void) => { clicked = callback; } } },
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
      },
      tabs: { create, query: vi.fn(async () => []) },
      scripting: { executeScript: vi.fn(async () => []) },
    });

    clicked?.();

    expect(create).toHaveBeenCalledWith({ url: "chrome-extension://test/index.html" });
  });

  it("does not keep removed short-link host text in content runtime surfaces", () => {
    const files = [
      "src/content/main.ts",
      "src/content/globalTrigger.ts",
      "src/content/collectionAdapters.ts",
      "public/manifest.json",
      "src/background.ts",
      "dist/assets/content.js",
    ];
    const forbiddenShortLink = ["xhs", "link"].join("");

    for (const file of files) {
      expect(readFileSync(resolve(process.cwd(), file), "utf8"), file).not.toContain(forbiddenShortLink);
    }
  });

  it("builds the content script as a classic script without module imports", () => {
    const contentBundle = readFileSync(resolve(process.cwd(), "dist/assets/content.js"), "utf8");

    expect(contentBundle).not.toMatch(/^\s*import\s/m);
    expect(contentBundle).not.toContain("import(");
    expect(contentBundle).not.toContain("from\"./client");
    expect(contentBundle).not.toContain("from \"./client");
    expect(contentBundle).not.toContain("assets/index.js");
    expect(contentBundle).not.toContain("assets/index.css");
    expect(contentBundle).not.toContain("workbench/runtimeApi");
  });
});
