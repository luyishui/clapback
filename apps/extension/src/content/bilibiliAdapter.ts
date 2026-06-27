import { openAdapterPanel, prepareAdapterSurface } from "./adapterRuntime";
import { compactText, firstEditor, queryAllDeep, queryBySelectorPriority } from "./domAdapterUtils";
import { createRuntimeClient, defaultSettings } from "./runtimeClient";
import type { AdapterSession, AdapterTarget } from "./adapterRuntime";
import type { ClapbackContext, ClapbackSettings, ClapbackTarget, RuntimeClient } from "./types";

type AttachOptions = {
  runtime?: RuntimeClient;
  settings?: Partial<ClapbackSettings>;
  root?: ParentNode;
};

type TriggerRoot = HTMLElement | ShadowRoot;
type BilibiliTarget = AdapterTarget & {
  actionRoot: TriggerRoot;
};

let nextSessionId = 0;
const activeObservers = new WeakMap<ParentNode, MutationObserver>();
const activeShadowObservers = new WeakMap<ParentNode, MutationObserver[]>();

const COMMENT_SELECTORS = [
  "bili-comment-renderer",
  "bili-comment-reply-renderer",
  ".reply-item",
  ".sub-reply-item",
  ".bili-comment",
  ".comment-item",
  "[data-rpid]",
  "[data-reply-id]",
  "[class*='reply-item']",
  "[class*='ReplyItem']",
].join(",");

const ACTION_ROW_SELECTORS = [
  "bili-comment-action-buttons-renderer",
  ".reply-info",
  ".sub-reply-info",
  ".reply-operation",
  ".operation",
  ".comment-action",
  "[class*='reply-info']",
  "[class*='operation']",
  "[class*='action']",
].join(",");

const TEXT_SELECTORS = [
  "bili-rich-text",
  ".reply-content",
  ".sub-reply-content",
  ".reply-content-container",
  ".content-warp",
  ".comment-content",
  "[class*='reply-content']",
  "[class*='comment-content']",
  "[class*='content']",
];

const SOURCE_TEXT_SELECTORS = [
  "h1",
  ".video-title",
  ".title",
  ".opus-module-title",
  ".opus-module-content",
  ".article-title",
  ".article-content",
  ".desc-info-text",
  "[class*='title']",
  "[class*='desc']",
];

const REPLY_EDITOR_SELECTORS = [
  ".reply-editor",
  ".bili-rich-textarea__inner",
  ".comment-send textarea",
  ".comment-input textarea",
  "textarea",
  "input[type='text']",
  "[contenteditable='true']",
  "[role='textbox']",
].join(",");

export function attachBilibiliClapback(options: AttachOptions = {}): AdapterSession<BilibiliTarget> {
  const root = options.root ?? document;
  const settings = { ...defaultSettings, ...options.settings };
  const runtime = options.runtime ?? createRuntimeClient(settings);
  const sessionId = String(++nextSessionId);
  let observer: MutationObserver | null = null;

  activeObservers.get(root)?.disconnect();
  activeShadowObservers.get(root)?.forEach((shadowObserver) => shadowObserver.disconnect());
  activeShadowObservers.delete(root);

  const shadowObservers: MutationObserver[] = [];
  const observedShadowRoots = new WeakSet<ShadowRoot>();

  const session: AdapterSession<BilibiliTarget> = {
    targets: [],
    refresh() {
      session.targets = discoverTargets(root);
      session.targets.forEach((target) => ensureTrigger(target, settings, runtime, sessionId));
      observeOpenShadowRoots(root, observedShadowRoots, shadowObservers, () => session.refresh());
    },
    disconnect() {
      observer?.disconnect();
      shadowObservers.forEach((shadowObserver) => shadowObserver.disconnect());
      if (activeObservers.get(root) === observer) activeObservers.delete(root);
      if (activeShadowObservers.get(root) === shadowObservers) activeShadowObservers.delete(root);
      observer = null;
    },
  };

  prepareAdapterSurface();
  session.refresh();
  observer = new MutationObserver(() => session.refresh());
  observer.observe(root as Node, { childList: true, subtree: true });
  activeObservers.set(root, observer);
  activeShadowObservers.set(root, shadowObservers);
  return session;
}

function discoverTargets(root: ParentNode): BilibiliTarget[] {
  return dedupeTargets(queryAllDeep(root, COMMENT_SELECTORS)
    .map((node, index) => {
      const text = extractCommentText(node);
      const actionSurface = findActionSurface(node);
      if (!text || !actionSurface) return null;
      return createTarget(node, actionSurface.actionRow, actionSurface.actionRoot, index, text);
    })
    .filter((target): target is BilibiliTarget => target !== null));
}

function createTarget(
  node: HTMLElement,
  actionRow: HTMLElement,
  actionRoot: TriggerRoot,
  index: number,
  text: string,
): BilibiliTarget {
  const target: ClapbackTarget = {
    id: node.dataset.rpid || node.dataset.replyId || node.id || `bilibili-comment-${index + 1}`,
    text,
  };

  return {
    node,
    actionRow,
    actionRoot,
    target,
    platform: "bilibili",
    buildContext: () => buildContext(node, target),
    activateReply: () => clickReplyAction(node, actionRoot),
    findReplyEditor: () => findReplyEditor(node),
  };
}

function extractCommentText(node: HTMLElement): string {
  const richText = extractRichTextContent(node);
  if (richText) return richText;

  const textNode = queryBySelectorPriority(node, TEXT_SELECTORS);
  const clone = (textNode ?? node).cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".clapback-trigger, .reply-info, .sub-reply-info, button, svg, img").forEach((item) => item.remove());
  return compactText(clone.textContent || "");
}

function extractRichTextContent(node: HTMLElement): string {
  const richTextNodes = queryAllDeep(node, "bili-rich-text");
  for (const richText of richTextNodes) {
    const contents = richText.shadowRoot?.querySelector<HTMLElement>("#contents");
    const text = compactText(contents?.textContent || richText.textContent || "");
    if (text) return text;
  }
  return "";
}

function findActionSurface(node: HTMLElement): { actionRow: HTMLElement; actionRoot: TriggerRoot } | null {
  const rows = queryAllDeep(node, ACTION_ROW_SELECTORS);
  const actionRow = rows.find((row) => {
    const actionText = compactText(row.shadowRoot?.textContent || row.textContent || "");
    return actionText.includes("回复");
  }) ?? rows[0] ?? null;
  if (!actionRow) return null;
  return {
    actionRow,
    actionRoot: actionRow.localName === "bili-comment-action-buttons-renderer" && actionRow.shadowRoot
      ? actionRow.shadowRoot
      : actionRow,
  };
}

function ensureTrigger(
  comment: BilibiliTarget,
  settings: ClapbackSettings,
  runtime: RuntimeClient,
  sessionId: string,
): void {
  const existing = comment.actionRoot.querySelectorAll<HTMLButtonElement>(".clapback-trigger");
  if (existing.length === 1 && existing[0].dataset.clapbackSessionId === sessionId) return;
  existing.forEach((button) => button.remove());
  ensureBilibiliShadowStyle(comment.actionRoot);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "clapback-trigger clapback-trigger--bilibili";
  trigger.dataset.clapbackSessionId = sessionId;
  trigger.textContent = "嘴替";
  trigger.title = "Clapback / 嘴替";
  trigger.setAttribute("aria-label", "用嘴替回复这条 Bilibili 评论");
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    void openAdapterPanel(comment, settings, runtime);
  });
  const replyAction = comment.actionRoot instanceof ShadowRoot
    ? comment.actionRoot.querySelector<HTMLElement>("#reply")
    : null;
  replyAction?.after(trigger);
  if (!trigger.isConnected) comment.actionRoot.append(trigger);
}

function buildContext(commentNode: HTMLElement, target: ClapbackTarget): ClapbackContext {
  const comments = discoverTargets(document)
    .filter((candidate) => candidate.target.id !== target.id)
    .map((candidate) => candidate.target.text)
    .slice(0, 4);
  const pageTitle = compactText(document.querySelector("h1")?.textContent || document.title || "");
  const sourceText = extractSourceText(commentNode, pageTitle);
  return {
    pageTitle,
    sourceTitle: pageTitle || undefined,
    sourceText: sourceText || undefined,
    nearbyComments: comments,
  };
}

function extractSourceText(commentNode: HTMLElement, pageTitle: string): string {
  const sourceRoot = commentNode.closest<HTMLElement>("main, #app, .video-container, .opus-detail, article") ?? document.body;
  const pieces = SOURCE_TEXT_SELECTORS
    .flatMap((selector) => [...sourceRoot.querySelectorAll<HTMLElement>(selector)])
    .filter((node) => !node.contains(commentNode) && !node.closest(".clapback-panel"))
    .map((node) => compactText(node.textContent || ""))
    .filter(Boolean);
  return compactText([...new Set([pageTitle, ...pieces])].filter(Boolean).join(" ")).slice(0, 1800);
}

function clickReplyAction(node: HTMLElement, actionRoot: TriggerRoot): void {
  const candidates = [
    ...actionRoot.querySelectorAll<HTMLElement>("#reply button, .reply-btn, .sub-reply-btn, button"),
    ...queryAllDeep(node, "#reply button, .reply-btn, .sub-reply-btn, button"),
    ...actionRoot.querySelectorAll<HTMLElement>("#reply, span, div"),
    ...queryAllDeep(node, "#reply, span, div"),
  ];
  candidates.find((candidate) => compactText(candidate.textContent || "") === "回复")?.click();
}

function findReplyEditor(commentNode: HTMLElement): HTMLElement | null {
  const inComment = firstDeepEditor(commentNode, REPLY_EDITOR_SELECTORS);
  if (inComment) return normalizeBilibiliEditor(inComment);

  const sibling = commentNode.nextElementSibling as HTMLElement | null;
  const inSibling = sibling ? firstDeepEditor(sibling, REPLY_EDITOR_SELECTORS) : null;
  if (inSibling) return normalizeBilibiliEditor(inSibling);

  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches(REPLY_EDITOR_SELECTORS) && !active.closest(".clapback-panel")) {
    return normalizeBilibiliEditor(active);
  }

  return normalizeBilibiliEditor(firstDeepEditor(document, REPLY_EDITOR_SELECTORS));
}

function firstDeepEditor(root: ParentNode, selector: string): HTMLElement | null {
  return queryAllDeep(root, selector)
    .find((node) => !node.closest(".clapback-panel"))
    ?? firstEditor(root, selector);
}

function normalizeBilibiliEditor(editor: HTMLElement | null): HTMLElement | null {
  if (!editor) return null;
  return editor.querySelector<HTMLElement>("[contenteditable='true'], textarea, input[type='text']") ?? editor;
}

function dedupeTargets(targets: BilibiliTarget[]): BilibiliTarget[] {
  const seenNodes = new Set<HTMLElement>();
  const seenRows = new Set<TriggerRoot>();
  const result: BilibiliTarget[] = [];
  targets.forEach((target) => {
    if (seenNodes.has(target.node) || seenRows.has(target.actionRoot)) return;
    seenNodes.add(target.node);
    seenRows.add(target.actionRoot);
    result.push(target);
  });
  return result;
}

function ensureBilibiliShadowStyle(root: TriggerRoot): void {
  if (!(root instanceof ShadowRoot) || root.getElementById("clapback-bilibili-shadow-style")) return;
  const style = document.createElement("style");
  style.id = "clapback-bilibili-shadow-style";
  style.textContent = `
    .clapback-trigger {
      display: inline-flex;
      align-items: center;
      min-height: 0;
      margin-left: 10px;
      padding: 0 2px;
      border: 0;
      background: transparent;
      color: #C41E3A;
      font-family: "Liu Jian Mao Cao", cursive;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      white-space: nowrap;
    }

    .clapback-trigger:hover,
    .clapback-trigger:focus-visible {
      color: #8F1328;
      outline: none;
    }
  `;
  root.append(style);
}

function observeOpenShadowRoots(
  root: ParentNode,
  observed: WeakSet<ShadowRoot>,
  observers: MutationObserver[],
  refresh: () => void,
): void {
  const visit = (scope: ParentNode) => {
    scope.querySelectorAll<HTMLElement>("*").forEach((node) => {
      if (!node.shadowRoot) return;
      if (!observed.has(node.shadowRoot)) {
        observed.add(node.shadowRoot);
        const observer = new MutationObserver(refresh);
        observer.observe(node.shadowRoot, { childList: true, subtree: true });
        observers.push(observer);
      }
      visit(node.shadowRoot);
    });
  };
  visit(root);
}
