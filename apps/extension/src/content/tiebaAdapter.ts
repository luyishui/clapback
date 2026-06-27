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

type TiebaTarget = AdapterTarget;

let nextSessionId = 0;
const activeObservers = new WeakMap<ParentNode, MutationObserver>();

const COMMENT_SELECTORS = [
  ".pb-comment-item",
  ".l_post",
  ".j_lzl_c_b_a",
  ".lzl_single_post",
  "[data-field]",
  "[data-comment-id]",
].join(",");

const MAIN_POST_SELECTORS = [
  ".image-text",
].join(",");

const ACTION_ROW_SELECTORS = [
  ".comment-desc-right",
  ".pc-pb-comments-desc .comment-desc-right",
  ".core_reply",
  ".post-tail-wrap",
  ".lzl_link_fold",
  ".lzl_content_reply",
  "[class*='desc-right']",
  "[class*='reply']",
].join(",");

const MAIN_ACTION_ROW_SELECTORS = [
  ".pc-pb-first-floor-interactive .action-bar-warp",
  ".pc-pb-first-floor-interactive .action-bar-container",
  ".pc-pb-first-floor-interactive",
];

const TEXT_SELECTORS = [
  ".comment-content",
  ".d_post_content",
  ".j_d_post_content",
  ".lzl_content_main",
  ".lzl_content_main_p",
  "[class*='comment-content']",
  "[class*='post_content']",
  "[class*='content']",
];

const MAIN_TEXT_SELECTORS = [
  ".pb-title",
  ".image-text__content",
  ".content-text",
  ".d_post_content",
  ".j_d_post_content",
  "[class*='post-content']",
];

const SOURCE_TEXT_SELECTORS = [
  ".core_title_txt",
  "h1",
  ".d_post_content",
  ".j_d_post_content",
  "[class*='title']",
];

const REPLY_EDITOR_SELECTORS = [
  ".pc-pb-reply-box .box",
  ".pc-pb-reply-box textarea",
  "#ueditor_replace",
  ".edui-body-container",
  ".poster_body textarea",
  "textarea",
  "input[type='text']",
  "[contenteditable='true']",
  "[role='textbox']",
].join(",");

export function attachTiebaClapback(options: AttachOptions = {}): AdapterSession<TiebaTarget> {
  const root = options.root ?? document;
  const settings = { ...defaultSettings, ...options.settings };
  const runtime = options.runtime ?? createRuntimeClient(settings);
  const sessionId = String(++nextSessionId);
  let observer: MutationObserver | null = null;

  activeObservers.get(root)?.disconnect();

  const session: AdapterSession<TiebaTarget> = {
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

function discoverTargets(root: ParentNode): TiebaTarget[] {
  const postTargets = [...root.querySelectorAll<HTMLElement>(MAIN_POST_SELECTORS)]
    .filter((node) => !node.closest(".pb-comment-item, .j_lzl_c_b_a, .lzl_single_post"))
    .map((node, index) => createMainPostTarget(node, index))
    .filter((target): target is TiebaTarget => target !== null);

  const commentTargets = [...root.querySelectorAll<HTMLElement>(COMMENT_SELECTORS)]
    .map((node, index) => {
      const text = extractCommentText(node);
      const actionRow = findActionRow(node);
      if (!text || !actionRow) return null;
      return createTarget(node, actionRow, index, text);
    })
    .filter((target): target is TiebaTarget => target !== null);

  return dedupeTargets([...postTargets, ...commentTargets]);
}

function createMainPostTarget(node: HTMLElement, index: number): TiebaTarget | null {
  const text = extractMainPostText(node);
  const actionRow = queryBySelectorPriority(node, MAIN_ACTION_ROW_SELECTORS);
  if (!text || !actionRow) return null;
  return createTarget(node, actionRow, index, text, "post");
}

function createTarget(node: HTMLElement, actionRow: HTMLElement, index: number, text: string, kind: "comment" | "post" = "comment"): TiebaTarget {
  const target: ClapbackTarget = {
    id: kind === "post"
      ? `tieba-post-${location.pathname || index + 1}`
      : node.dataset.commentId || node.dataset.pid || node.id || `tieba-comment-${index + 1}`,
    text,
  };
  return {
    node,
    actionRow,
    target,
    platform: "tieba",
    buildContext: () => buildContext(node, target),
    activateReply: () => clickReplyAction(node, actionRow),
    findReplyEditor: () => findReplyEditor(node),
  };
}

function extractCommentText(node: HTMLElement): string {
  const textNode = queryBySelectorPriority(node, TEXT_SELECTORS);
  const clone = (textNode ?? node).cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".clapback-trigger, .comment-desc-right, button, svg, img").forEach((item) => item.remove());
  return compactText(clone.textContent || "");
}

function extractMainPostText(node: HTMLElement): string {
  const pieces = MAIN_TEXT_SELECTORS
    .map((selector) => node.querySelector<HTMLElement>(selector))
    .filter((item): item is HTMLElement => item !== null)
    .map((item) => {
      const clone = item.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(".clapback-trigger, button, svg, img").forEach((child) => child.remove());
      return compactText(clone.textContent || "");
    })
    .filter(Boolean);
  return compactText([...new Set(pieces)].join(" "));
}

function findActionRow(node: HTMLElement): HTMLElement | null {
  const rows = [...node.querySelectorAll<HTMLElement>(ACTION_ROW_SELECTORS)];
  return rows.find((row) => compactText(row.textContent || "").includes("回复")) ?? rows[0] ?? null;
}

function ensureTrigger(
  comment: TiebaTarget,
  settings: ClapbackSettings,
  runtime: RuntimeClient,
  sessionId: string,
): void {
  const existing = comment.actionRow.querySelectorAll<HTMLButtonElement>(".clapback-trigger");
  if (existing.length === 1 && existing[0].dataset.clapbackSessionId === sessionId) return;
  existing.forEach((button) => button.remove());

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "clapback-trigger clapback-trigger--tieba";
  trigger.dataset.clapbackSessionId = sessionId;
  trigger.textContent = "嘴替";
  trigger.title = "Clapback / 嘴替";
  trigger.setAttribute("aria-label", "用嘴替回复这条贴吧评论");
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
  const pageTitle = compactText(document.querySelector(".core_title_txt, h1")?.textContent || document.title || "");
  const sourceText = extractSourceText(commentNode, pageTitle);
  return {
    pageTitle,
    sourceTitle: pageTitle || undefined,
    sourceText: sourceText || undefined,
    nearbyComments: comments,
  };
}

function extractSourceText(commentNode: HTMLElement, pageTitle: string): string {
  const sourceRoot = commentNode.closest<HTMLElement>("#j_p_postlist, .p_postlist, main, body") ?? document.body;
  const pieces = SOURCE_TEXT_SELECTORS
    .flatMap((selector) => [...sourceRoot.querySelectorAll<HTMLElement>(selector)])
    .filter((node) => !node.closest(".pb-comment-item, .j_lzl_c_b_a, .clapback-panel"))
    .map((node) => compactText(node.textContent || ""))
    .filter(Boolean);
  return compactText([...new Set([pageTitle, ...pieces])].filter(Boolean).join(" ")).slice(0, 1800);
}

function clickReplyAction(node: HTMLElement, actionRow: HTMLElement): void {
  const candidates = [
    ...actionRow.querySelectorAll<HTMLElement>(".reply, a, span, button"),
    ...node.querySelectorAll<HTMLElement>(".reply, a, span, button"),
  ];
  candidates.find((candidate) => compactText(candidate.textContent || "").includes("回复"))?.click();
}

function findReplyEditor(commentNode: HTMLElement): HTMLElement | null {
  const inComment = firstEditor(commentNode, REPLY_EDITOR_SELECTORS);
  if (inComment) return inComment;
  return firstEditor(document, REPLY_EDITOR_SELECTORS);
}

function dedupeTargets(targets: TiebaTarget[]): TiebaTarget[] {
  const seenRows = new Set<HTMLElement>();
  const result: TiebaTarget[] = [];
  targets.forEach((target) => {
    if (seenRows.has(target.actionRow)) return;
    seenRows.add(target.actionRow);
    result.push(target);
  });
  return result;
}
