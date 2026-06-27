import { buildPanel } from "./buildPanel";
import { injectContentFonts } from "./contentFonts";
import { injectContentStyles } from "./contentStyles";
import { flashSealStage, revealCandidates, showInkLoading } from "./generationOverlay";
import { loadPanelOptions } from "./panelOptions";
import { placeFloatingPanel } from "./floatingPanel";
import { fillEditor, waitForReplyEditor } from "./domAdapterUtils";
import type { AmmoBoxOption, ClapbackContext, ClapbackPlatform, ClapbackSettings, ClapbackTarget, GenerateRequest, RuntimeClient, SkillOption } from "./types";

export type AdapterTarget = {
  node: HTMLElement;
  actionRow: HTMLElement;
  target: ClapbackTarget;
  platform: ClapbackPlatform;
  buildContext(): ClapbackContext;
  activateReply?(): void | Promise<void>;
  findReplyEditor?(): HTMLElement | null;
  placePanel?(panel: HTMLElement): void;
};

export type AdapterSession<T extends AdapterTarget = AdapterTarget> = {
  targets: T[];
  refresh(): void;
  disconnect(): void;
};

export function prepareAdapterSurface(): void {
  injectContentFonts();
  injectContentStyles();
}

export async function openAdapterPanel(target: AdapterTarget, settings: ClapbackSettings, runtime: RuntimeClient): Promise<void> {
  document.querySelector(".clapback-panel")?.remove();

  const { skills, ammoBoxes } = await loadPanelOptions(runtime).catch(() => ({ skills: [] as SkillOption[], ammoBoxes: [] as AmmoBoxOption[] }));
  const panel = buildPanel({
    targetText: target.target.text,
    settings,
    skills,
    ammoBoxes,
  });

  if (target.placePanel) {
    target.placePanel(panel.root);
  } else {
    placeFloatingPanel(panel.root);
  }
  document.body.append(panel.root);

  panel.generate.addEventListener("click", async () => {
    panel.generate.disabled = true;
    showInkLoading(panel.candidates, "ink");
    try {
      const request: GenerateRequest = {
        platform: target.platform,
        target: target.target,
        context: target.buildContext(),
        intent: panel.intent.value.trim(),
        settings: panel.getSettings(),
      };
      const response = await runtime.generate(request);
      await flashSealStage(panel.candidates);
      renderCandidates(panel.candidates, response.candidates, target);
      revealCandidates(panel.candidates);
    } catch (error) {
      panel.candidates.textContent = error instanceof Error ? error.message : "生成失败，请检查扩展后台。";
    } finally {
      panel.generate.disabled = false;
    }
  });

  panel.intent.focus();
}

function renderCandidates(container: HTMLElement, candidates: string[], target: AdapterTarget): void {
  container.replaceChildren();
  if (candidates.length === 0) {
    container.textContent = "未返回候选";
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
      void autofillReply(target, candidate, container);
    });
    container.append(row);
  });
}

async function autofillReply(target: AdapterTarget, value: string, statusContainer: HTMLElement): Promise<void> {
  await target.activateReply?.();
  const editor = await waitForReplyEditor(
    () => target.findReplyEditor?.() ?? null,
    () => target.node.isConnected,
  );

  if (!editor) {
    await copyCandidate(value);
    statusContainer.setAttribute("data-clapback-status", "copied");
    const hint = document.createElement("p");
    hint.className = "clapback-panel__hint";
    hint.textContent = "已复制，未找到可填入的回复框。";
    statusContainer.append(hint);
    return;
  }

  fillEditor(editor, value);
}

async function copyCandidate(candidate: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(candidate);
  } catch {
    // Some content-script contexts do not expose clipboard permissions.
  }
}
