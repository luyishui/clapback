import { createRuntimeClient, defaultSettings } from "./runtimeClient";
import type { ClapbackContext, ClapbackSettings, ClapbackTarget, GenerateRequest, RuntimeClient } from "./types";
import { injectContentStyles } from "./contentStyles";
import { injectContentFonts } from "./contentFonts";
import { buildPanel } from "./buildPanel";
import { hydratePanelOptions, loadPanelOptions } from "./panelOptions";
import { showInkLoading, flashSealStage, revealCandidates } from "./generationOverlay";

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
  ".comment-item",
  "[class*='commentItem']",
  "[class*='CommentItem']",
  ".parent-comment",
  ".sub-comment",
].join(",");

const ACTION_ROW_SELECTORS = [
  ".comment-op",
  "[class*='commentAction']",
  "[class*='comment-action']",
  "[class*='operation']",
  ".interactions",
].join(",");

const POST_ACTION_ROW_SELECTORS = [
  ".buttons.engage-bar-style",
  ".engage-bar-style",
  ".interact-container .buttons",
  ".interact-container",
  ".interactions.engage-bar",
].join(",");

const TEXT_SELECTORS = [
  ".comment-text",
  "[class*='commentContent']",
  "[class*='comment-content']",
  ".note-text",
  "[class*='content']",
];

const POST_TEXT_SELECTORS = [
  "#detail-title",
  "#detail-desc",
  ".note-content .title",
  ".note-content .desc",
  ".note-content .note-text",
  ".note-text",
  "[class*='title']",
  "[class*='desc']",
];

const REPLY_EDITOR_SELECTORS = [
  "#content-textarea[contenteditable]",
  "textarea",
  "input[type='text']",
  "[contenteditable='true']",
  "[role='textbox']",
].join(",");

export function attachXiaohongshuClapback(options: AttachOptions = {}): AdapterSession {
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
  const commentTargets = [...root.querySelectorAll<HTMLElement>(COMMENT_SELECTORS)]
    .map((node, index) => {
      const text = extractText(node);
      const actionRow = findActionRow(node);
      if (!text || !actionRow) return null;
      return {
        node,
        actionRow,
        target: { id: node.id || node.dataset.id || `xhs-comment-${index + 1}`, text },
      };
    })
    .filter((t): t is CommentTarget => t !== null);

  return dedupeTargets([...discoverPostTargets(root), ...commentTargets]);
}

function extractText(node: HTMLElement): string {
  const el = queryBySelectorPriority(node, TEXT_SELECTORS);
  return compactText(el?.textContent || node.textContent || "");
}

function findActionRow(node: HTMLElement): HTMLElement | null {
  return node.querySelector<HTMLElement>(ACTION_ROW_SELECTORS);
}

function discoverPostTargets(root: ParentNode): CommentTarget[] {
  const rows = [...root.querySelectorAll<HTMLElement>(POST_ACTION_ROW_SELECTORS)];
  const actionRow = rows.find((row) => row.matches(".buttons.engage-bar-style, .engage-bar-style, .interact-container .buttons"))
    ?? rows[0];
  const node = queryBySelectorPriority(root, ["#noteContainer", ".note-container", "[class*='note-detail']", "main", "body"]);
  if (!actionRow || actionRow.closest(".comment-item, .parent-comment, .sub-comment")) {
    return [];
  }
  if (!node) return [];
  const text = extractPostText(root);
  if (!text) return [];
  return [{
    node,
    actionRow,
    target: {
      id: node.id || node.getAttribute("data-note-id") || "xhs-note",
      text,
    },
  }];
}

function extractPostText(root: ParentNode): string {
  const scope = root.querySelector<HTMLElement>("#noteContainer, .note-container, [class*='note-detail']") ?? root;
  const pieces = POST_TEXT_SELECTORS.flatMap((selector) => [...scope.querySelectorAll<HTMLElement>(selector)])
    .filter((node) => !node.closest(".comment-item, .parent-comment, .sub-comment, .comments-container, .clapback-panel"))
    .map((node) => compactText(node.textContent || ""))
    .filter(Boolean);
  return compactText([...new Set(pieces)].join(" ")).slice(0, 1800);
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

let activeResizeHandler: (() => void) | null = null;

function openPanel(comment: CommentTarget, settings: ClapbackSettings, runtime: RuntimeClient): void {
  document.querySelector(".clapback-panel")?.remove();
  if (activeResizeHandler) {
    window.removeEventListener("resize", activeResizeHandler);
    activeResizeHandler = null;
  }

  const panel = buildPanel({
    targetText: comment.target.text,
    settings,
    onClose: () => {
      if (activeResizeHandler) {
        window.removeEventListener("resize", activeResizeHandler);
        activeResizeHandler = null;
      }
    },
  });

  placeXhsPanel(panel.root);
  document.body.append(panel.root);
  const panelSettings = loadPanelOptions(runtime);
  void panelSettings.then(({ skills, ammoBoxes }) => {
    if (!panel.root.isConnected) return;
    hydratePanelOptions(panel, settings, skills, ammoBoxes);
  });

  activeResizeHandler = () => placeXhsPanel(panel.root);
  window.addEventListener("resize", activeResizeHandler);

  panel.generate.addEventListener("click", async () => {
    panel.generate.disabled = true;
    showInkLoading(panel.candidates, "ink");
    try {
      const request: GenerateRequest = {
        platform: "xiaohongshu",
        target: comment.target,
        context: buildContext(comment),
        intent: panel.intent.value.trim(),
        settings: panel.getSettings(),
      };
      const response = await runtime.generate(request);
      // 封笔中:印章过渡(150ms),再渲染候选
      await flashSealStage(panel.candidates);
      renderCandidates(panel.candidates, response.candidates, comment.node);
      revealCandidates(panel.candidates);
    } catch (error) {
      panel.candidates.textContent = error instanceof Error ? error.message : "生成失败，请检查扩展后台。";
    } finally {
      panel.generate.disabled = false;
    }
  });

  panel.intent.focus();
}

function placeXhsPanel(panelEl: HTMLElement): void {
  const note = document.querySelector<HTMLElement>("#noteContainer, .note-container");
  panelEl.style.position = "fixed";
  panelEl.style.zIndex = "2147483646";
  panelEl.style.maxHeight = "calc(100vh - 120px)";
  panelEl.style.overflow = "auto";

  if (note) {
    const rect = note.getBoundingClientRect();
    const rightSpace = window.innerWidth - rect.right;
    const leftSpace = rect.left;

    if (rightSpace >= 480) {
      panelEl.style.left = `${rect.right + 24}px`;
      panelEl.style.top = `${Math.max(24, rect.top)}px`;
      panelEl.style.right = "";
      panelEl.style.bottom = "";
    } else if (leftSpace >= 480) {
      panelEl.style.right = `${window.innerWidth - rect.left + 24}px`;
      panelEl.style.top = `${Math.max(24, rect.top)}px`;
      panelEl.style.left = "";
      panelEl.style.bottom = "";
    } else {
      panelEl.style.right = "24px";
      panelEl.style.bottom = "96px";
      panelEl.style.left = "";
      panelEl.style.top = "";
    }
  } else {
    panelEl.style.right = "24px";
    panelEl.style.bottom = "96px";
    panelEl.style.left = "";
    panelEl.style.top = "";
  }
}

function buildContext(comment: CommentTarget): ClapbackContext {
  const comments = discoverTargets(document)
    .filter((c) => c.target.id !== comment.target.id)
    .map((c) => c.target.text)
    .slice(0, 4);
  const pageTitle = compactText(document.title || "");
  const sourceText = extractPostText(document);
  return {
    pageTitle,
    sourceTitle: pageTitle || undefined,
    sourceText: sourceText || undefined,
    nearbyComments: comments,
  };
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
    ?? commentNode.closest(".comments-container")?.querySelector<HTMLElement>(REPLY_EDITOR_SELECTORS)
    ?? document.querySelector<HTMLElement>("#content-textarea[contenteditable]");
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
    if (node) {
      return node;
    }
  }
  return null;
}

function compactText(v: string): string { return v.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim(); }
