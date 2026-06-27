import { handleExtensionMessage } from "./api/handlers";
import type { ExtensionMessage, ExtensionMessageResponse } from "./api/types";

export const CONTENT_SCRIPT_URL_PATTERNS = [
  "https://www.zhihu.com/*",
  "https://zhuanlan.zhihu.com/*",
  "https://weibo.com/*",
  "https://www.weibo.com/*",
  "https://m.weibo.cn/*",
  "https://www.xiaohongshu.com/*",
  "https://www.bilibili.com/*",
  "https://www.xiaoheihe.cn/*",
  "https://tieba.baidu.com/*",
];

type ContentScriptInjectionApi = {
  tabs: {
    query(queryInfo: { url: string[] }): Promise<Array<{ id?: number }>>;
  };
  scripting: {
    executeScript(details: { target: { tabId: number }; files: string[] }): Promise<unknown>;
  };
};

type BackgroundApi = ContentScriptInjectionApi & {
  action: {
    onClicked: { addListener(callback: () => void): void };
  };
  runtime: {
    getURL(path: string): string;
    onInstalled: { addListener(callback: () => void): void };
    onStartup?: { addListener(callback: () => void): void };
    onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response: ExtensionMessageResponse) => void,
        ) => boolean,
      ): void;
    };
  };
  tabs: ContentScriptInjectionApi["tabs"] & {
    create(details: { url: string }): void;
  };
};

export async function injectContentScriptIntoOpenTabs(api: ContentScriptInjectionApi): Promise<void> {
  let tabs: Array<{ id?: number }>;
  try {
    tabs = await api.tabs.query({ url: CONTENT_SCRIPT_URL_PATTERNS });
  } catch {
    return;
  }

  await Promise.all(tabs.map(async (tab) => {
    if (typeof tab.id !== "number") return;
    try {
      await api.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["assets/content.js"],
      });
    } catch {
      // Some tabs may deny injection after navigation or site permission changes.
    }
  }));
}

export function registerBackgroundHandlers(api: BackgroundApi = chrome): void {
  api.action.onClicked.addListener(() => {
    api.tabs.create({ url: api.runtime.getURL("index.html") });
  });

  api.runtime.onInstalled.addListener(() => {
    void injectContentScriptIntoOpenTabs(api);
  });

  api.runtime.onStartup?.addListener(() => {
    void injectContentScriptIntoOpenTabs(api);
  });

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isExtensionMessage(message)) {
      handleExtensionMessage(message, sender)
        .then((data) => sendResponse({ ok: true, data } satisfies ExtensionMessageResponse))
        .catch((error: unknown) => {
          const messageText = error instanceof Error ? error.message : "unknown_extension_error";
          sendResponse({ ok: false, error: messageText } satisfies ExtensionMessageResponse);
        });
      return true;
    }

    return false;
  });

  void injectContentScriptIntoOpenTabs(api);
}

function isExtensionMessage(message: unknown): message is ExtensionMessage {
  return typeof message === "object"
    && message !== null
    && typeof (message as { type?: unknown }).type === "string";
}

if (typeof chrome !== "undefined" && chrome.action && chrome.runtime) {
  registerBackgroundHandlers(chrome);
}
