import { openAdapterPanel, prepareAdapterSurface } from "./adapterRuntime";
import { compactText, firstEditor, queryBySelectorPriority } from "./domAdapterUtils";
import { createRuntimeClient, defaultSettings } from "./runtimeClient";
import type { AdapterSession, AdapterTarget } from "./adapterRuntime";
import type { ClapbackContext, ClapbackSettings, ClapbackTarget, RuntimeClient } from "./types";

type AttachOptions = {
  runtime?: RuntimeClient;
  settings?: Partial<ClapbackSettings>;
  root?: ParentNode;
};

type XiaoheiheTarget = AdapterTarget & {
  isChildReply: boolean;
};

let nextSessionId = 0;
const activeObservers = new WeakMap<ParentNode, MutationObserver>();

const PARENT_COMMENT_SELECTORS = [
  ".link-comment__comment-item",
  ".comment-item",
].join(",");

const CHILD_REPLY_SELECTORS = [
  ".comment-children-item",
].join(",");

const PARENT_TEXT_SELECTORS = [
  ".comment-item-content",
  ".comment-item__content",
  ".comment-item__content-container",
  "[class*='comment-item__content']",
  "[class*='comment-item-content']",
];

const CHILD_TEXT_SELECTORS = [
  ".comment-children-item__content",
  ".children-item__comment-content",
  "[class*='children-item__comment-content']",
  "[class*='comment-children-item__content']",
];

const ACTION_ROW_SELECTORS = [
  ".comment-item-header__operation-box",
  ".operation-box",
  ".like-box",
  "[class*='operation-box']",
].join(",");

const SOURCE_TEXT_SELECTORS = [
  ".section-title__content",
  ".image-text__content",
  ".link-section-title",
  ".link-section-desc",
  ".content-text",
  "h1",
  "[class*='title']",
  "[class*='content']",
];

const REPLY_EDITOR_SELECTORS = [
  ".link-reply__editor [contenteditable='true']",
  ".link-reply__editor",
  ".link-reply__input",
  ".ProseMirror.hb-editor",
  "[data-reply_wrapper] [contenteditable='true']",
  "[data-reply_wrapper] textarea",
  ".link-reply textarea",
  "textarea",
  "input[type='text']",
  "[contenteditable='true']",
  "[role='textbox']",
].join(",");

export function attachXiaoheiheClapback(options: AttachOptions = {}): AdapterSession<XiaoheiheTarget> {
  const root = options.root ?? document;
  const settings = { ...defaultSettings, ...options.settings };
  const runtime = options.runtime ?? createRuntimeClient(settings);
  const sessionId = String(++nextSessionId);
  let observer: MutationObserver | null = null;

  activeObservers.get(root)?.disconnect();

  const session: AdapterSession<XiaoheiheTarget> = {
    targets: [],
    refresh() {
      session.targets = discoverTargets(root);
      session.targets.forEach((target) => ensureTrigger(target, settings, runtime, sessionId));
    },
    disconnect() {
      observer?.disconnect();
      if (activeObservers.get(root) === observer) activeObservers.delete(root);
      observer = null;
    },
  };

  prepareAdapterSurface();
  session.refresh();
  observer = new MutationObserver(() => session.refresh());
  observer.observe(root as Node, { childList: true, subtree: true });
  activeObservers.set(root, observer);
  return session;
}

function discoverTargets(root: ParentNode): XiaoheiheTarget[] {
  const parents = [...root.querySelectorAll<HTMLElement>(PARENT_COMMENT_SELECTORS)]
    .filter((node) => !node.closest(CHILD_REPLY_SELECTORS))
    .map((node, index) => createParentTarget(node, index))
    .filter((target): target is XiaoheiheTarget => target !== null);

  const children = [...root.querySelectorAll<HTMLElement>(CHILD_REPLY_SELECTORS)]
    .map((node, index) => createChildTarget(node, index))
    .filter((target): target is XiaoheiheTarget => target !== null);

  return dedupeTargets([...parents, ...children]);
}

function createParentTarget(node: HTMLElement, index: number): XiaoheiheTarget | null {
  const text = extractText(node, PARENT_TEXT_SELECTORS);
  const actionRow = findParentActionRow(node);
  if (!text || !actionRow) return null;
  return createTarget(node, actionRow, index, text, false);
}

function createChildTarget(node: HTMLElement, index: number): XiaoheiheTarget | null {
  const text = extractText(node, CHILD_TEXT_SELECTORS);
  if (!text) return null;
  return createTarget(node, node, index, text, true);
}

function createTarget(node: HTMLElement, actionRow: HTMLElement, index: number, text: string, isChildReply: boolean): XiaoheiheTarget {
  const target: ClapbackTarget = {
    id: node.dataset.commentId || node.dataset.id || node.id || `xiaoheihe-${isChildReply ? "reply" : "comment"}-${index + 1}`,
    text,
  };
  return {
    node,
    actionRow,
    target,
    platform: "xiaoheihe",
    isChildReply,
    buildContext: () => buildContext(node, target),
    activateReply: () => node.click(),
    findReplyEditor: () => findReplyEditor(node),
  };
}

function extractText(node: HTMLElement, selectors: string[]): string {
  const textNode = queryBySelectorPriority(node, selectors);
  const clone = (textNode ?? node).cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".clapback-trigger, button, svg, img").forEach((item) => item.remove());
  return compactText(clone.textContent || "");
}

function findParentActionRow(node: HTMLElement): HTMLElement | null {
  const action = node.querySelector<HTMLElement>(ACTION_ROW_SELECTORS);
  if (!action) return null;
  return action.matches(".like-box") ? action.parentElement : action;
}

function ensureTrigger(
  comment: XiaoheiheTarget,
  settings: ClapbackSettings,
  runtime: RuntimeClient,
  sessionId: string,
): void {
  const existing = comment.actionRow.querySelectorAll<HTMLButtonElement>(":scope > .clapback-trigger");
  if (existing.length === 1 && existing[0].dataset.clapbackSessionId === sessionId) return;
  existing.forEach((button) => button.remove());

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = comment.isChildReply
    ? "clapback-trigger clapback-trigger--xiaoheihe clapback-trigger--stamp"
    : "clapback-trigger clapback-trigger--xiaoheihe";
  trigger.dataset.clapbackSessionId = sessionId;
  trigger.textContent = "嘴替";
  trigger.title = "Clapback / 嘴替";
  trigger.setAttribute("aria-label", "用嘴替回复这条小黑盒评论");
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    void openAdapterPanel(comment, settings, runtime);
  });
  comment.actionRow.append(trigger);
}

function buildContext(commentNode: HTMLElement, target: ClapbackTarget): ClapbackContext {
  const comments = discoverTargets(document)
    .filter((candidate) => candidate.target.id !== target.id)
    .map((candidate) => candidate.target.text)
    .slice(0, 4);
  const pageTitle = compactText(document.querySelector(".section-title__content, h1")?.textContent || document.title || "");
  const sourceText = extractSourceText(commentNode, pageTitle);
  return {
    pageTitle,
    sourceTitle: pageTitle || undefined,
    sourceText: sourceText || undefined,
    nearbyComments: comments,
  };
}

function extractSourceText(commentNode: HTMLElement, pageTitle: string): string {
  const sourceRoot = commentNode.closest<HTMLElement>(".hb-bbs-link, .hb-bbs-image-text, main") ?? document.body;
  const pieces = SOURCE_TEXT_SELECTORS
    .flatMap((selector) => [...sourceRoot.querySelectorAll<HTMLElement>(selector)])
    .filter((node) => !node.closest(".link-comment, .clapback-panel"))
    .map((node) => compactText(node.textContent || ""))
    .filter(Boolean);
  return compactText([...new Set([pageTitle, ...pieces])].filter(Boolean).join(" ")).slice(0, 1800);
}

function findReplyEditor(commentNode: HTMLElement): HTMLElement | null {
  const container = commentNode.closest<HTMLElement>(".link-comment, .hb-bbs-link, body") ?? document.body;
  return normalizeXhhEditor(firstEditor(container, REPLY_EDITOR_SELECTORS))
    ?? normalizeXhhEditor(firstEditor(document, REPLY_EDITOR_SELECTORS));
}

function normalizeXhhEditor(editor: HTMLElement | null): HTMLElement | null {
  if (!editor) return null;
  return editor.querySelector<HTMLElement>("[contenteditable='true'], textarea, input[type='text']") ?? editor;
}

function dedupeTargets(targets: XiaoheiheTarget[]): XiaoheiheTarget[] {
  const seen = new Set<HTMLElement>();
  const result: XiaoheiheTarget[] = [];
  targets.forEach((target) => {
    if (seen.has(target.node)) return;
    seen.add(target.node);
    result.push(target);
  });
  return result;
}
