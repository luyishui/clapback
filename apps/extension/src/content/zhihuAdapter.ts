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
  ".CommentItem",
  ".CommentItemV2",
  "[data-za-detail-view-id]",
  "[data-testid='comment-item']",
  "[class*='CommentItem']",
].join(",");

const POST_SELECTORS = [
  ".ContentItem",
  ".ArticleItem",
  ".AnswerItem",
  ".TopstoryItem",
  "article",
].join(",");

const ACTION_ROW_SELECTORS = [
  ".CommentItem-footer",
  ".CommentItemV2-footer",
  ".ContentItem-actions",
  ".RichContent-actions",
  "[class*='footer']",
  "[class*='actions']",
].join(",");

const POST_ACTION_ROW_SELECTORS = [
  ".ContentItem-actions",
  ".RichContent-actions",
].join(",");

const NON_SOURCE_SELECTORS = [
  ".ContentItem-actions",
  ".RichContent-actions",
  ".Comments-container",
  ".clapback-panel",
  ".clapback-trigger",
  "button",
  "svg",
  "img",
].join(",");

const TEXT_SELECTORS = [
  ".CommentItem-content",
  ".CommentContent",
  ".comment-text",
  ".RichContent-inner",
  ".RichText",
  "[class*='content']",
].join(",");

const SOURCE_TEXT_SELECTORS = [
  ".QuestionHeader-title",
  ".Post-Title",
  ".ContentItem-title",
  ".RichContent-inner",
  ".Post-RichText",
  ".ArticleItem-content",
  "[class*='RichContent']",
  "[class*='content']",
].join(",");

const REPLY_EDITOR_SELECTORS = [
  "textarea",
  "input[type='text']",
  "[contenteditable='true']",
  "[role='textbox']",
].join(",");

export function attachZhihuClapback(options: AttachOptions = {}): AdapterSession {
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
      session.targets.forEach((target) => ensureTrigger(target, settings, runtime, sessionId));
    },
    disconnect() {
      observer?.disconnect();
      if (activeObservers.get(root) === observer) {
        activeObservers.delete(root);
      }
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
      const text = extractCommentText(node);
      const actionRow = findActionRow(node);

      if (!text || !actionRow) {
        return null;
      }

      return {
        node,
        actionRow,
        target: {
          id: node.dataset.zaDetailViewId || node.id || `zhihu-comment-${index + 1}`,
          text,
        },
      };
    })
    .filter((target): target is CommentTarget => target !== null);

  const postTargets = discoverPostTargets(root);
  const semanticTargets = discoverSemanticReplyTargets(root);
  return dedupeTargets([...postTargets, ...explicitTargets, ...semanticTargets]);
}

function extractCommentText(node: HTMLElement): string {
  const textNode = node.querySelector<HTMLElement>(TEXT_SELECTORS);
  return compactText(textNode?.textContent || node.textContent || "");
}

function findActionRow(node: HTMLElement): HTMLElement | null {
  return node.querySelector<HTMLElement>(ACTION_ROW_SELECTORS);
}

function discoverPostTargets(root: ParentNode): CommentTarget[] {
  return [...root.querySelectorAll<HTMLElement>(POST_SELECTORS)]
    .map((node, index) => {
      if (node.closest(COMMENT_SELECTORS) || node.closest(".Comments-container")) return null;
      const actionRow = findPostActionRow(node);
      if (!actionRow) return null;
      const text = extractPostText(node);
      if (!text) return null;
      return {
        node,
        actionRow,
        target: {
          id: node.id || node.dataset.zop || node.dataset.zaExtraModule || `zhihu-post-${index + 1}`,
          text,
        },
      };
    })
    .filter((target): target is CommentTarget => target !== null);
}

function findPostActionRow(node: HTMLElement): HTMLElement | null {
  return [...node.querySelectorAll<HTMLElement>(POST_ACTION_ROW_SELECTORS)]
    .find((row) => !row.closest(".Comments-container") && countButtons(row) >= 3) ?? null;
}

function extractPostText(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(NON_SOURCE_SELECTORS).forEach((candidate) => candidate.remove());
  const candidates = [...clone.querySelectorAll<HTMLElement>(SOURCE_TEXT_SELECTORS)]
    .filter((candidate) => !candidate.closest(COMMENT_SELECTORS) && !candidate.closest(".Comments-container"))
    .filter((candidate, _index, all) => !all.some((other) => other !== candidate && candidate.contains(other) && compactText(other.textContent || "")));
  const pieces = (candidates.length > 0 ? candidates : [clone])
    .map((candidate) => compactText(candidate.textContent || ""))
    .filter(Boolean);
  return compactText([...new Set(pieces)].join(" ")).slice(0, 1800);
}

function countButtons(row: HTMLElement): number {
  return row.querySelectorAll("button").length;
}

function discoverSemanticReplyTargets(root: ParentNode): CommentTarget[] {
  return [...root.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => compactText(button.textContent || "") === "回复")
    .map((button, index) => {
      const actionRow = button.parentElement;
      const node = findSemanticCommentNode(button);
      if (!actionRow || !node) return null;
      const text = extractSemanticCommentText(node, actionRow);
      if (!text) return null;
      return {
        node,
        actionRow,
        target: {
          id: node.id || node.dataset.id || `zhihu-comment-semantic-${index + 1}`,
          text,
        },
      };
    })
    .filter((target): target is CommentTarget => target !== null);
}

function findSemanticCommentNode(button: HTMLElement): HTMLElement | null {
  let node = button.parentElement;
  for (let depth = 0; depth < 4 && node; depth += 1) {
    if ([...node.querySelectorAll("button")].some((candidate) => compactText(candidate.textContent || "") === "回复")) {
      const linkText = compactText(node.querySelector("a")?.textContent || "");
      const allText = compactText(node.textContent || "");
      if (linkText && allText.length > linkText.length + 2) {
        return node;
      }
    }
    node = node.parentElement;
  }
  return null;
}

function extractSemanticCommentText(node: HTMLElement, actionRow: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, img, svg").forEach((item) => item.remove());
  const author = compactText(clone.querySelector("a")?.textContent || "");
  const actionText = compactText(actionRow.textContent || "");
  let text = compactText(clone.textContent || "");
  if (author && text.startsWith(author)) text = text.slice(author.length).trim();
  if (actionText && text.endsWith(actionText)) text = text.slice(0, -actionText.length).trim();
  text = text.replace(/\d{1,2}:\d{2}|\d+\s*(小时前|分钟前)|昨天\s*\d{1,2}:\d{2}|前天\s*\d{1,2}:\d{2}|\d{2}-\d{2}/g, " ");
  text = text.replace(/·\s*[\u4e00-\u9fa5]{2,8}$/g, " ");
  return compactText(text);
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
  if (existing.length === 1 && existing[0].dataset.clapbackSessionId === sessionId) {
    return;
  }

  existing.forEach((button) => button.remove());

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "clapback-trigger clapback-trigger--zhihu";
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
    onClose: () => {},
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
        platform: "zhihu",
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
    .filter((candidate) => candidate.target.id !== comment.target.id)
    .map((candidate) => candidate.target.text)
    .slice(0, 4);

  const pageTitle = compactText(document.querySelector("h1")?.textContent || document.title || "");
  const sourceText = extractSourceText(comment.node, pageTitle);
  return {
    pageTitle,
    sourceTitle: pageTitle || undefined,
    sourceText: sourceText || undefined,
    nearbyComments: comments,
  };
}

function extractSourceText(commentNode: HTMLElement, pageTitle: string): string {
  const article = findSourceContainer(commentNode) ?? document;
  if (commentNode.matches(POST_SELECTORS)) {
    return compactText([pageTitle, extractPostText(commentNode)].filter(Boolean).join(" ")).slice(0, 1800);
  }
  const pieces = [...article.querySelectorAll<HTMLElement>(SOURCE_TEXT_SELECTORS)]
    .filter((node) => !node.contains(commentNode) && !commentNode.contains(node) && !node.closest(".clapback-panel"))
    .filter((node) => !node.closest(COMMENT_SELECTORS))
    .filter((node) => !node.querySelector("button") && !compactText(node.textContent || "").includes("回复"))
    .map((node) => compactText(node.textContent || ""))
    .filter(Boolean);
  const unique = [...new Set([pageTitle, ...pieces])].filter(Boolean);
  return compactText(unique.join(" ")).slice(0, 1800);
}

function findSourceContainer(commentNode: HTMLElement): ParentNode | null {
  return commentNode.closest<HTMLElement>("article, .ContentItem, .ArticleItem, .TopstoryItem, [class*='ContentItem']");
}

function renderCandidates(container: HTMLElement, candidates: string[], commentNode: HTMLElement): void {
  container.replaceChildren();

  if (candidates.length !== 3) {
    container.textContent = `需要 3 条候选，生成服务返回了 ${candidates.length} 条。`;
    return;
  }

  candidates.forEach((candidate, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "clapback-candidate";
    row.textContent = candidate;
    row.setAttribute("aria-label", `候选 ${index + 1}，单击复制，双击填入`);
    row.addEventListener("click", () => {
      void copyCandidate(candidate);
    });
    row.addEventListener("dblclick", () => {
      void autofillNearestReply(commentNode, candidate, container);
    });
    container.append(row);
  });
}

async function copyCandidate(candidate: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(candidate);
    }
  } catch {
    // Clipboard permissions can be unavailable in content scripts; autofill should still work.
  }
}

async function autofillNearestReply(commentNode: HTMLElement, value: string, statusContainer: HTMLElement): Promise<void> {
  let editor = findNearestReplyEditor(commentNode);
  if (!editor) {
    clickReplyButton(commentNode);
    editor = await waitForReplyEditor(commentNode);
  }

  if (!editor) {
    if (!commentNode.isConnected) return;
    await copyCandidate(value);
    statusContainer.setAttribute("data-clapback-status", "copied");
    statusContainer.append(statusText("已复制，未找到可填入的回复框。"));
    return;
  }

  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    editor.value = value;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.focus();
    return;
  }

  editor.textContent = value;
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
  editor.focus();
}

function findNearestReplyEditor(commentNode: HTMLElement): HTMLElement | null {
  const inComment = findEditorWithin(commentNode);
  if (inComment) {
    return inComment;
  }

  const sibling = commentNode.nextElementSibling as HTMLElement | null;
  if (sibling && !isCommentItem(sibling)) {
    const inSibling = findEditorWithin(sibling) ?? (isReplyEditor(sibling) ? sibling : null);
    if (inSibling) {
      return inSibling;
    }
  }

  const active = commentNode.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement) || !isReplyEditor(active) || active.closest(".clapback-panel")) {
    return null;
  }

  const activeComment = active.closest<HTMLElement>(COMMENT_SELECTORS);
  return activeComment && activeComment !== commentNode ? null : active;
}

function findEditorWithin(scope: ParentNode): HTMLElement | null {
  return [...scope.querySelectorAll<HTMLElement>(REPLY_EDITOR_SELECTORS)].find(
    (candidate) => !candidate.closest(".clapback-panel"),
  ) ?? null;
}

function clickReplyButton(commentNode: HTMLElement): void {
  const buttons = [
    ...commentNode.querySelectorAll<HTMLButtonElement>("button"),
    ...((commentNode.querySelector<HTMLElement>(ACTION_ROW_SELECTORS) ?? commentNode.parentElement)
      ?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ];
  const reply = buttons.find((button) => compactText(button.textContent || "").includes("回复"));
  reply?.click();
}

async function waitForReplyEditor(commentNode: HTMLElement): Promise<HTMLElement | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!commentNode.isConnected) return null;
    const editor = findNearestReplyEditor(commentNode);
    if (editor) return editor;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

function statusText(text: string): HTMLElement {
  const node = document.createElement("p");
  node.className = "clapback-panel__hint";
  node.textContent = text;
  return node;
}

function isReplyEditor(node: HTMLElement): boolean {
  return node.matches(REPLY_EDITOR_SELECTORS);
}

function isCommentItem(node: HTMLElement): boolean {
  return node.matches(COMMENT_SELECTORS) || node.matches(".comment-item");
}

function compactText(value: string): string {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}
