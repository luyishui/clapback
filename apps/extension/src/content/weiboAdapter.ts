import { createRuntimeClient, defaultSettings } from "./runtimeClient";
import type { ClapbackContext, ClapbackSettings, ClapbackTarget, GenerateRequest, RuntimeClient } from "./types";
import { injectContentStyles } from "./contentStyles";
import { injectContentFonts } from "./contentFonts";
import { buildPanel } from "./buildPanel";
import { hydratePanelOptions, loadPanelOptions } from "./panelOptions";
import { placeFloatingPanel } from "./floatingPanel";

type AttachOptions = {
  runtime?: RuntimeClient;
  settings?: Partial<ClapbackSettings>;
  root?: ParentNode;
};

type CommentTarget = {
  node: HTMLElement;
  actionRow: HTMLElement;
  target: ClapbackTarget;
};

type AdapterSession = {
  targets: CommentTarget[];
  refresh(): void;
  disconnect(): void;
};

let nextSessionId = 0;
const activeObservers = new WeakMap<ParentNode, MutationObserver>();

const COMMENT_SELECTORS = [
  ".card.m-panel.card9.f-weibo",
  ".card9.f-weibo",
  "article.weibo-main",
  ".card-wrap[mid]",
  "article[mid]",
  "article[class*='woo-panel']",
  "[node-type='replywrap'] .list_li",
  "[class*='CommentItem']",
  ".wbpro-list .item1",
  ".wbpro-list .item2",
  ".WB_feed_detail .WB_text",
].join(",");

const ACTION_ROW_SELECTORS = [
  "footer.f-footer-ctrl",
  ".f-footer-ctrl",
  ".info .opt",
  ".woo-box-flex.info .opt",
  ".card-act",
  "[class*='toolbar']",
  "[node-type='feed_list_operate']",
  ".WB_handle",
  ".woo-box-flex.woo-box-alignCenter[class*='_main_']",
  "[class*='_main_'][class*='_left_']",
  "[class*='action']",
].join(",");

const TEXT_SELECTORS = [
  ".weibo-text",
  ".text",
  ".wbpro-feed-content",
  "[class*='_wbtext_']",
  ".WB_text",
  "[class*='text']",
  "[class*='content']",
];

const SOURCE_TEXT_SELECTORS = [
  ".wbpro-feed-content",
  "[class*='_wbtext_']",
  ".WB_text",
  "[class*='text']",
  "[class*='content']",
];

const REPLY_EDITOR_SELECTORS = [
  "textarea",
  "input[type='text']",
  "[contenteditable='true']",
  "[role='textbox']",
].join(",");

export function attachWeiboClapback(options: AttachOptions = {}): AdapterSession {
  const root = options.root ?? document;
  const settings = { ...defaultSettings, ...options.settings };
  const runtime = options.runtime ?? createRuntimeClient(settings);
  const sessionId = String(++nextSessionId);
  let observer: MutationObserver | null = null;

  activeObservers.get(root)?.disconnect();

  const session: AdapterSession = {
    targets: [],
    refresh() {
      session.targets = discoverTargets(root);
      session.targets.forEach((t) => ensureTrigger(t, settings, runtime, sessionId));
    },
    disconnect() {
      observer?.disconnect();
      if (activeObservers.get(root) === observer) activeObservers.delete(root);
      observer = null;
    },
  };

  injectContentFonts();
  injectContentStyles();
  session.refresh();
  observer = new MutationObserver(() => session.refresh());
  observer.observe(root as Node, { childList: true, subtree: true });
  activeObservers.set(root, observer);
  return session;
}

function discoverTargets(root: ParentNode): CommentTarget[] {
  const explicitTargets = [...root.querySelectorAll<HTMLElement>(COMMENT_SELECTORS)]
    .map((node, index) => {
      const text = extractText(node);
      const actionRow = findActionRow(node);
      if (!text || !actionRow) return null;
      return {
        node,
        actionRow,
        target: { id: node.getAttribute("mid") || node.id || `weibo-comment-${index + 1}`, text },
      };
    })
    .filter((t): t is CommentTarget => t !== null);

  return dedupeTargets([...explicitTargets, ...discoverWooFeedTargets(root), ...discoverSinglePostCommentTargets(root)]);
}

function extractText(node: HTMLElement): string {
  const el = queryBySelectorPriority(node, TEXT_SELECTORS);
  return compactText(el?.textContent || node.textContent || "");
}

function findActionRow(node: HTMLElement): HTMLElement | null {
  const rows = [...node.querySelectorAll<HTMLElement>(ACTION_ROW_SELECTORS)];
  return rows.find((row) => countActionItems(row) >= 2) ?? rows[0] ?? null;
}

function discoverWooFeedTargets(root: ParentNode): CommentTarget[] {
  return [...root.querySelectorAll<HTMLElement>("article")].map((node, index) => {
    const text = extractText(node);
    const actionRow = findActionRow(node);
    if (!text || !actionRow) return null;
    return {
      node,
      actionRow,
      target: { id: node.getAttribute("mid") || node.id || `weibo-feed-${index + 1}`, text },
    };
  }).filter((target): target is CommentTarget => target !== null);
}

function discoverSinglePostCommentTargets(root: ParentNode): CommentTarget[] {
  return [...root.querySelectorAll<HTMLElement>(".wbpro-list .item1, .wbpro-list .item2")]
    .map((node, index) => {
      const text = extractWeiboCommentText(node);
      const actionRow = node.querySelector<HTMLElement>(".info .opt, .woo-box-flex.info .opt, .opt");
      if (!text || !actionRow) return null;
      return {
        node,
        actionRow,
        target: { id: node.id || node.dataset.id || `weibo-thread-comment-${index + 1}`, text },
      };
    })
    .filter((target): target is CommentTarget => target !== null);
}

function extractWeiboCommentText(node: HTMLElement): string {
  const textNode = node.querySelector<HTMLElement>(".text") ?? queryBySelectorPriority(node, TEXT_SELECTORS);
  const clone = (textNode ?? node).cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".clapback-trigger, button, svg, img").forEach((item) => item.remove());
  return compactText(clone.textContent || "");
}

function countActionItems(row: HTMLElement): number {
  return [...row.children].filter((child) => compactText(child.textContent || "") || child.querySelector("button")).length;
}

function dedupeTargets(targets: CommentTarget[]): CommentTarget[] {
  const seenRows = new Set<HTMLElement>();
  const result: CommentTarget[] = [];
  targets.forEach((target) => {
    if (seenRows.has(target.actionRow)) return;
    seenRows.add(target.actionRow);
    result.push(target);
  });
  return result;
}

function ensureTrigger(
  comment: CommentTarget,
  settings: ClapbackSettings,
  runtime: RuntimeClient,
  sessionId: string,
): void {
  const existing = comment.actionRow.querySelectorAll<HTMLButtonElement>(".clapback-trigger");
  if (existing.length === 1 && existing[0].dataset.clapbackSessionId === sessionId) return;
  existing.forEach((b) => b.remove());

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "clapback-trigger";
  trigger.dataset.clapbackSessionId = sessionId;
  trigger.textContent = "嘴替";
  trigger.title = "Clapback / 嘴替";
  trigger.setAttribute("aria-label", "用嘴替回复这条评论");
  trigger.addEventListener("click", () => openPanel(comment, settings, runtime));
  comment.actionRow.append(trigger);
}

function openPanel(comment: CommentTarget, settings: ClapbackSettings, runtime: RuntimeClient): void {
  document.querySelector(".clapback-panel")?.remove();

  const panelSettings = loadPanelOptions(runtime);
  const panel = buildPanel({
    targetText: comment.target.text,
    settings,
  });

  placeFloatingPanel(panel.root);
  document.body.append(panel.root);
  void panelSettings.then(({ skills, ammoBoxes }) => {
    if (!panel.root.isConnected) return;
    hydratePanelOptions(panel, settings, skills, ammoBoxes);
  });

  panel.generate.addEventListener("click", async () => {
    panel.generate.disabled = true;
    panel.candidates.textContent = "起墨中...";
    try {
      const request: GenerateRequest = {
        platform: "weibo",
        target: comment.target,
        context: buildContext(comment),
        intent: panel.intent.value.trim(),
        settings: panel.getSettings(),
      };
      const response = await runtime.generate(request);
      renderCandidates(panel.candidates, response.candidates, comment.node);
    } catch (error) {
      panel.candidates.textContent = error instanceof Error ? error.message : "生成失败，请检查扩展后台。";
    } finally {
      panel.generate.disabled = false;
    }
  });

  panel.intent.focus();
}

function buildContext(comment: CommentTarget): ClapbackContext {
  const comments = discoverTargets(document)
    .filter((c) => c.target.id !== comment.target.id)
    .map((c) => c.target.text)
    .slice(0, 4);
  const pageTitle = compactText(document.title || "");
  const sourceText = extractSourceText(comment.node, pageTitle);
  return {
    pageTitle,
    sourceTitle: pageTitle || undefined,
    sourceText: sourceText || undefined,
    nearbyComments: comments,
  };
}

function extractSourceText(commentNode: HTMLElement, pageTitle: string): string {
  const article = commentNode.closest("article")
    ?? document.querySelector<HTMLElement>("main article")
    ?? commentNode;
  const pieces = SOURCE_TEXT_SELECTORS.flatMap((selector) => [...article.querySelectorAll<HTMLElement>(selector)])
    .filter((node) => !node.closest(".wbpro-list, .item1, .item2, .clapback-panel"))
    .map((node) => compactText(node.textContent || ""))
    .filter(Boolean);
  return compactText([...new Set([pageTitle, ...pieces])].filter(Boolean).join(" ")).slice(0, 1800);
}

function renderCandidates(container: HTMLElement, items: string[], commentNode: HTMLElement): void {
  container.replaceChildren();
  if (items.length === 0) { container.textContent = "未返回候选"; return; }
  items.forEach((text, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "clapback-candidate";
    row.textContent = text;
    row.setAttribute("aria-label", `候选 ${i + 1}，单击复制，双击填入`);
    row.addEventListener("click", () => { navigator.clipboard?.writeText(text).catch(() => {}); });
    row.addEventListener("dblclick", () => autofillReply(commentNode, text));
    container.append(row);
  });
}

function autofillReply(commentNode: HTMLElement, value: string): void {
  const editor = commentNode.querySelector<HTMLElement>(REPLY_EDITOR_SELECTORS)
    ?? commentNode.nextElementSibling?.querySelector<HTMLElement>(REPLY_EDITOR_SELECTORS);
  if (!editor) return;
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    editor.value = value;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    editor.textContent = value;
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
  }
}

function queryBySelectorPriority(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const node = root.querySelector<HTMLElement>(selector);
    if (node && compactText(node.textContent || "")) {
      return node;
    }
  }
  return null;
}

function compactText(v: string): string { return v.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim(); }
