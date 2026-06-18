import type { ClapbackPlatform, ClapbackSettings, RuntimeClient } from "./types";
import { createRuntimeClient, defaultSettings } from "./runtimeClient";
import { injectContentStyles } from "./contentStyles";
import { injectContentFonts } from "./contentFonts";
import { buildPanel } from "./buildPanel";
import { hydratePanelOptions, loadPanelOptions } from "./panelOptions";
import { showInkLoading, flashSealStage, revealCandidates } from "./generationOverlay";

export function injectGlobalTrigger(options?: { settings?: Partial<ClapbackSettings> }): void {
  if (document.getElementById("clapback-global-trigger")) return;

  const settings = { ...defaultSettings, ...options?.settings };
  const runtime = createRuntimeClient(settings);

  injectContentFonts();
  injectContentStyles();
  injectGlobalStyles();

  const trigger = document.createElement("button");
  trigger.id = "clapback-global-trigger";
  trigger.type = "button";
  trigger.className = "clapback-trigger clapback-trigger--global";
  trigger.textContent = "嘴替";
  trigger.title = "Clapback / 嘴替";
  trigger.setAttribute("aria-label", "打开嘴替生成面板");
  trigger.addEventListener("click", () => openGlobalPanel(settings, runtime));
  document.body.append(trigger);
}

function openGlobalPanel(settings: ClapbackSettings, runtime: RuntimeClient): void {
  const existing = document.querySelector(".clapback-global-panel");
  if (existing) {
    existing.remove();
    return;
  }

  const selection = window.getSelection()?.toString().trim();
  const panel = buildPanel({
    targetText: selection || "选中文字或粘贴目标评论",
    settings,
  });
  panel.root.classList.add("clapback-global-panel", "clapback-panel--compact");
  panel.intent.rows = 2;

  const targetInput = document.createElement("textarea");
  targetInput.className = "clapback-global-target";
  targetInput.rows = 1;
  targetInput.placeholder = "粘贴目标评论...";
  targetInput.setAttribute("aria-label", "目标评论");
  if (selection) {
    targetInput.value = selection;
  }

  panel.root.querySelector(".clapback-panel__target")?.after(targetInput);
  document.body.append(panel.root);
  void loadPanelOptions(runtime).then(({ skills, ammoBoxes }) => {
    if (!panel.root.isConnected) return;
    hydratePanelOptions(panel, settings, skills, ammoBoxes);
  });

  panel.generate.addEventListener("click", async () => {
    const targetText = targetInput.value.trim();
    if (!targetText) {
      panel.candidates.textContent = "请先粘贴或选中目标评论";
      return;
    }

    panel.generate.disabled = true;
    showInkLoading(panel.candidates, "ink");

    try {
      const response = await runtime.generate({
        platform: detectPlatform(),
        target: { id: "global-target", text: targetText },
        context: { pageTitle: document.title, nearbyComments: [] },
        intent: panel.intent.value.trim(),
        settings: panel.getSettings(),
      });
      // 封笔中:印章过渡(150ms),再渲染候选
      await flashSealStage(panel.candidates);
      renderGlobalCandidates(panel.candidates, response.candidates);
      revealCandidates(panel.candidates);
    } catch (error) {
      panel.candidates.textContent = error instanceof Error ? error.message : "生成失败，请检查扩展后台。";
    } finally {
      panel.generate.disabled = false;
    }
  });

  targetInput.focus();
}

function renderGlobalCandidates(container: HTMLElement, items: string[]): void {
  container.replaceChildren();
  if (items.length === 0) {
    container.textContent = "未返回候选结果";
    return;
  }
  items.forEach((text, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "clapback-candidate";
    row.textContent = text;
    row.setAttribute("aria-label", `候选 ${i + 1}，单击复制`);
    row.addEventListener("click", () => {
      navigator.clipboard?.writeText(text).catch(() => {});
    });
    container.append(row);
  });
}

function detectPlatform(): ClapbackPlatform {
  const host = location.hostname;
  if (host.includes("zhihu")) return "zhihu";
  if (host.includes("weibo")) return "weibo";
  if (host.includes("xiaohongshu")) return "xiaohongshu";
  return "unknown";
}

function injectGlobalStyles(): void {
  if (document.getElementById("clapback-global-style")) return;

  const style = document.createElement("style");
  style.id = "clapback-global-style";
  style.textContent = `
    .clapback-trigger--global {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483646;
      width: 52px;
      height: 52px;
      font-size: 20px;
      border-radius: 50%;
      padding: 0;
      letter-spacing: 0;
      background: var(--clapback-seal-red);
      color: #ffffff;
      border: 1px solid rgba(143, 19, 40, 0.24);
      box-shadow: 0 4px 16px rgba(196, 30, 58, 0.28);
      transition: transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1),
                  box-shadow 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
    }

    .clapback-trigger--global:hover {
      color: #ffffff;
      transform: scale(1.08);
      box-shadow: 0 0 0 4px rgba(196, 30, 58, 0.12), 0 4px 16px rgba(196, 30, 58, 0.28);
    }

    .clapback-global-panel {
      position: fixed;
      bottom: 88px;
      right: 24px;
      z-index: 2147483646;
      animation: clapback-slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .clapback-global-target {
      box-sizing: border-box;
      width: 100%;
      min-height: 48px;
      padding: 12px;
      border: 1px solid var(--clapback-ink-clear, #999);
      border-radius: 4px;
      background: var(--clapback-paper-ivory, #FFFFF0);
      color: var(--clapback-ink-focus, #1a1a1a);
      font-family: inherit;
      font-size: 13px;
      resize: vertical;
    }

    .clapback-global-target:focus {
      border-color: var(--clapback-seal-red, #C41E3A);
      box-shadow: 0 0 0 3px rgba(196, 30, 58, 0.10);
      outline: none;
    }

    @keyframes clapback-slide-up {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.append(style);
}
