import type { CollectionBasketItem, CollectionSession } from "../api/types";
import { injectContentFonts } from "./contentFonts";
import { sendContentMessage } from "./contentMessage";
import { collectCandidates } from "./collectionAdapters";

let activeToolbar: CollectionToolbar | null = null;

export async function attachCollectionToolbar(): Promise<CollectionToolbar | null> {
  const session = await sendContentMessage("collection:getSessionForTab", {});
  if (!session || session.status !== "active") {
    activeToolbar?.destroy();
    activeToolbar = null;
    return null;
  }

  activeToolbar?.destroy();
  activeToolbar = new CollectionToolbar(session);
  await activeToolbar.mount();
  return activeToolbar;
}

class CollectionToolbar {
  private basket: CollectionBasketItem[] = [];
  private root = document.createElement("section");
  private statusEl = document.createElement("div");
  private stateEl = document.createElement("span");
  private stateLabelEl = document.createElement("span");
  private countEl = document.createElement("span");
  private feedbackEl = document.createElement("span");
  private popoverEl = document.createElement("div");
  private basketButton: HTMLButtonElement | null = null;
  private popoverMode: "basket" | "empty" | null = null;

  constructor(private readonly session: CollectionSession) {}

  async mount(): Promise<void> {
    injectContentFonts();
    injectCollectionStyles();
    this.root.className = "clapback-collection-toolbar";
    this.root.setAttribute("aria-label", "创作者采风工具条");

    this.statusEl.className = "clapback-collection-toolbar__status";
    this.statusEl.append(
      this.renderPlatformChip(),
      this.renderText("创作者主页", "clapback-collection-toolbar__source"),
      this.renderDivider(),
      this.renderState(),
      this.countEl,
      this.renderDivider(),
      this.feedbackEl,
    );
    this.countEl.className = "clapback-collection-toolbar__count";
    this.feedbackEl.className = "clapback-collection-toolbar__feedback";
    this.popoverEl.className = "clapback-collection-popover";
    this.popoverEl.id = "clapback-collection-popover";
    this.popoverEl.setAttribute("role", "dialog");
    this.popoverEl.setAttribute("aria-label", "采风状态面板");
    this.popoverEl.hidden = true;

    const spacer = document.createElement("div");
    spacer.className = "clapback-collection-toolbar__spacer";

    const actions = document.createElement("div");
    actions.className = "clapback-collection-toolbar__actions";
    const scanButton = this.makeButton("scan", "扫描", "扫描当前页", () => void this.scan());
    this.basketButton = this.makeButton("basket", "采风", "打开采风篮", () => void this.toggleBasket());
    this.basketButton.setAttribute("aria-expanded", "false");
    this.basketButton.setAttribute("aria-controls", this.popoverEl.id);
    const importButton = this.makeButton("import", "导入", "导入素材箱", () => void this.importBasket());
    const exitButton = this.makeButton("exit", "退出", "退出采风", () => void this.exit());
    actions.append(scanButton, this.basketButton, importButton, exitButton);

    this.root.append(this.statusEl, spacer, actions);
    document.body.append(this.root, this.popoverEl);
    await this.refreshBasket();
  }

  destroy(): void {
    this.root.remove();
    this.popoverEl.remove();
  }

  private renderPlatformChip(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "clapback-collection-toolbar__platform";
    chip.append(createCollectionIcon("globe"), this.renderText(platformLabel(this.session.platform), "clapback-collection-toolbar__platform-label"));
    return chip;
  }

  private renderState(): HTMLElement {
    this.stateEl.className = "clapback-collection-toolbar__state";
    this.stateLabelEl.textContent = "采风中";
    this.stateEl.append(this.stateLabelEl);
    return this.stateEl;
  }

  private renderDivider(): HTMLElement {
    const divider = document.createElement("span");
    divider.className = "clapback-collection-toolbar__divider";
    divider.setAttribute("aria-hidden", "true");
    return divider;
  }

  private renderText(text: string, className: string): HTMLElement {
    const el = document.createElement("span");
    el.className = className;
    el.textContent = text;
    return el;
  }

  private makeButton(action: string, label: string, ariaLabel: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clapback-collection-toolbar__button";
    button.dataset.collectionAction = action;
    button.setAttribute("aria-label", ariaLabel);
    button.append(createCollectionIcon(iconNameForAction(action)), this.renderText(label, "clapback-collection-toolbar__button-label"));
    button.addEventListener("click", onClick);
    return button;
  }

  private async scan(): Promise<void> {
    if (this.session.platform === "zhihu") {
      await expandZhihuCollapsedContent(document);
    }
    const candidates = collectCandidates(document, this.session.platform);
    if (candidates.length === 0) {
      this.setScanState("已扫描", "muted");
      this.feedbackEl.textContent = "新增 0 · 跳过重复 0";
      this.feedbackEl.classList.add("clapback-collection-toolbar__feedback--muted");
      this.updateStatus(this.basket.length);
      this.popoverMode = "empty";
      this.renderPopover();
      return;
    }

    this.setScanState("采风中", "active");
    const result = await sendContentMessage("collection:addCandidates", {
      sessionId: this.session.id,
      candidates,
    });
    this.feedbackEl.textContent = [
      `新增 ${result.added} · 跳过重复 ${result.skipped}`,
      result.limit_reached ? "已达爬取数量上限" : "",
    ].filter(Boolean).join(" · ");
    this.feedbackEl.classList.remove("clapback-collection-toolbar__feedback--muted");
    if (this.popoverMode === "empty") this.popoverMode = "basket";
    await this.refreshBasket(result.basket_count);
  }

  private async refreshBasket(knownCount?: number): Promise<void> {
    this.basket = await sendContentMessage("collection:listBasket", { sessionId: this.session.id });
    this.updateStatus(knownCount ?? this.basket.length);
    this.renderPopover();
  }

  private updateStatus(count: number): void {
    this.countEl.textContent = `已收 ${count} 条`;
  }

  private setScanState(label: string, tone: "active" | "muted"): void {
    this.stateLabelEl.textContent = label;
    this.stateEl.classList.toggle("clapback-collection-toolbar__state--muted", tone === "muted");
  }

  private async toggleBasket(): Promise<void> {
    if (this.popoverMode === "basket") {
      this.closePopover();
      return;
    }
    this.popoverMode = "basket";
    this.renderPopover();
    await this.refreshBasket();
  }

  private renderPopover(): void {
    this.popoverEl.replaceChildren();
    if (!this.popoverMode) {
      this.closePopover();
      return;
    }

    if (this.popoverMode === "empty") {
      this.renderEmptyPopover();
    } else {
      this.renderBasketPopover();
    }

    this.syncPopoverState();
  }

  private renderBasketPopover(): void {
    this.popoverEl.append(this.renderPopoverHeader("采风篮", `已收 ${this.basket.length} 条`, "关闭采风篮"));
    const list = document.createElement("div");
    list.className = "clapback-collection-popover__list";

    if (this.basket.length === 0) {
      const empty = document.createElement("p");
      empty.className = "clapback-collection-popover__empty";
      empty.textContent = "采风篮为空";
      list.append(empty);
    } else {
      this.basket.forEach((item) => list.append(this.renderBasketItem(item)));
    }

    const footer = document.createElement("p");
    footer.className = "clapback-collection-popover__target";
    footer.textContent = `导入目标素材箱：${this.session.box_name || `#${this.session.box_id}`}`;
    this.popoverEl.append(list, footer);
  }

  private renderEmptyPopover(): void {
    this.popoverEl.append(
      this.renderPopoverHeader("当前页暂未识别到可采风内容", "新增 0 · 跳过重复 0", "关闭空状态提示"),
    );

    const body = document.createElement("div");
    body.className = "clapback-collection-popover__empty-panel";

    const message = document.createElement("p");
    message.className = "clapback-collection-popover__empty-message";
    message.textContent = "请继续滚动、切换到作品列表页，或回素材箱手动导入。";

    const rescan = document.createElement("button");
    rescan.type = "button";
    rescan.className = "clapback-collection-popover__rescan";
    rescan.dataset.collectionEmptyRescan = "true";
    rescan.setAttribute("aria-label", "再次扫描当前页");
    rescan.append(createCollectionIcon("scan-search"), this.renderText("再次扫描", "clapback-collection-toolbar__button-label"));
    rescan.addEventListener("click", () => void this.scan());

    body.append(message, rescan);
    this.popoverEl.append(body);
  }

  private renderPopoverHeader(titleText: string, summaryText: string, closeLabel: string): HTMLElement {
    const header = document.createElement("div");
    header.className = "clapback-collection-popover__header";

    const heading = document.createElement("div");
    heading.className = "clapback-collection-popover__heading";

    const title = document.createElement("h2");
    title.className = "clapback-collection-popover__title";
    title.textContent = titleText;

    const summary = document.createElement("span");
    summary.className = "clapback-collection-popover__summary";
    summary.textContent = summaryText;

    heading.append(title, summary);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "clapback-collection-popover__close";
    close.dataset.collectionPopoverClose = "true";
    close.setAttribute("aria-label", closeLabel);
    close.append(createCollectionIcon("x"));
    close.addEventListener("click", () => this.closePopover());

    header.append(heading, close);
    return header;
  }

  private closePopover(): void {
    this.popoverMode = null;
    this.popoverEl.hidden = true;
    this.basketButton?.classList.remove("clapback-collection-toolbar__button--active");
    this.basketButton?.setAttribute("aria-expanded", "false");
  }

  private syncPopoverState(): void {
    this.popoverEl.hidden = false;
    const basketOpen = this.popoverMode === "basket";
    this.basketButton?.classList.toggle("clapback-collection-toolbar__button--active", basketOpen);
    this.basketButton?.setAttribute("aria-expanded", basketOpen ? "true" : "false");
  }

  private renderBasketItem(item: CollectionBasketItem): HTMLElement {
    const article = document.createElement("article");
    article.className = "clapback-collection-card";

    const excerpt = document.createElement("span");
    excerpt.className = "clapback-collection-card__excerpt";
    excerpt.textContent = shortExcerpt(item.text);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "clapback-collection-card__remove";
    remove.dataset.candidateId = item.id;
    remove.setAttribute("aria-label", `删除 ${shortExcerpt(item.text)}`);
    remove.append(createCollectionIcon("trash-2"));
    remove.addEventListener("click", () => void this.removeCandidate(item.id));

    article.append(excerpt, remove);
    return article;
  }

  private async removeCandidate(candidateId: string): Promise<void> {
    await sendContentMessage("collection:removeCandidate", { sessionId: this.session.id, candidateId });
    await this.refreshBasket();
  }

  private async importBasket(): Promise<void> {
    await sendContentMessage("collection:importBasket", { sessionId: this.session.id });
    this.destroy();
    if (activeToolbar === this) activeToolbar = null;
  }

  private async exit(): Promise<void> {
    await sendContentMessage("collection:endSession", { sessionId: this.session.id });
    this.destroy();
    if (activeToolbar === this) activeToolbar = null;
  }
}

function shortExcerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 72);
}

function platformLabel(platform: CollectionSession["platform"]): string {
  if (platform === "weibo") return "微博";
  if (platform === "xiaohongshu") return "小红书";
  return "知乎";
}

type CollectionIconName = "archive" | "download" | "globe" | "scan-search" | "trash-2" | "x";

function iconNameForAction(action: string): CollectionIconName {
  if (action === "basket") return "archive";
  if (action === "import") return "download";
  if (action === "exit") return "x";
  return "scan-search";
}

function createCollectionIcon(name: CollectionIconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.dataset.collectionIcon = name;
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const append = (tag: "path" | "circle" | "line" | "rect", attrs: Record<string, string>) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    svg.append(node);
  };

  if (name === "archive") {
    append("rect", { x: "3", y: "4", width: "18", height: "5", rx: "2" });
    append("path", { d: "M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" });
    append("path", { d: "M10 13h4" });
  } else if (name === "download") {
    append("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" });
    append("path", { d: "M7 10l5 5 5-5" });
    append("path", { d: "M12 15V3" });
  } else if (name === "globe") {
    append("circle", { cx: "12", cy: "12", r: "10" });
    append("path", { d: "M12 2a14.5 14.5 0 0 0 0 20A14.5 14.5 0 0 0 12 2" });
    append("path", { d: "M2 12h20" });
  } else if (name === "scan-search") {
    append("path", { d: "M7 3H5a2 2 0 0 0-2 2v2" });
    append("path", { d: "M17 3h2a2 2 0 0 1 2 2v2" });
    append("path", { d: "M21 17v2a2 2 0 0 1-2 2h-2" });
    append("path", { d: "M7 21H5a2 2 0 0 1-2-2v-2" });
    append("circle", { cx: "11", cy: "11", r: "3" });
    append("path", { d: "m16 16-2.1-2.1" });
  } else if (name === "trash-2") {
    append("path", { d: "M3 6h18" });
    append("path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" });
    append("path", { d: "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" });
    append("path", { d: "M10 11v6" });
    append("path", { d: "M14 11v6" });
  } else {
    append("path", { d: "M18 6 6 18" });
    append("path", { d: "m6 6 12 12" });
  }

  return svg;
}

async function expandZhihuCollapsedContent(root: ParentNode): Promise<void> {
  const expanders = [
    ...root.querySelectorAll<HTMLElement>(".ContentItem-more, button"),
  ].filter(isZhihuReadMoreButton).slice(0, 40);

  if (expanders.length === 0) return;
  expanders.forEach((button) => button.click());
  await waitForDomToSettle();
}

function isZhihuReadMoreButton(node: HTMLElement): boolean {
  if (node.closest(".CommentItem, .CommentItemV2, .Comments-container, .clapback-panel, .clapback-collection-toolbar, .clapback-collection-popover")) {
    return false;
  }
  const text = node.textContent?.replace(/\s+/g, "") ?? "";
  if (!/(阅读全文|展开阅读全文|显示全部|展开全部)/.test(text) || /收起/.test(text)) return false;
  return Boolean(node.closest(".RichContent, .AnswerItem, .ArticleItem, .ContentItem, article"));
}

function waitForDomToSettle(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      resolve();
    };
    const observer = new MutationObserver(() => window.setTimeout(finish, 0));
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    window.setTimeout(finish, 80);
  });
}

function injectCollectionStyles(): void {
  if (document.getElementById("clapback-collection-style")) return;
  const style = document.createElement("style");
  style.id = "clapback-collection-style";
  style.textContent = `
    .clapback-collection-toolbar {
      --clapback-ink-focus: #1A1714;
      --clapback-ink-dense: #34302A;
      --clapback-ink-light: #7C736A;
      --clapback-paper-ivory: #FBFAF7;
      --clapback-paper-rice: #F4F2EC;
      --clapback-line-ink: #D4CFC6;
      --clapback-seal-red: #C41E3A;
      --clapback-seal-soft: #F7DDE2;
      --clapback-green: #2E8B57;
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483645;
      width: min(820px, calc(100vw - 32px));
      height: 64px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 0 16px;
      border: 1px solid var(--clapback-line-ink);
      border-radius: 8px;
      background: var(--clapback-paper-ivory);
      color: var(--clapback-ink-focus);
      font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "Microsoft YaHei", serif;
      font-size: 13px;
      line-height: 1.45;
      box-shadow: 0 10px 28px rgba(26, 26, 26, 0.12);
    }

    @media (prefers-color-scheme: dark) {
      .clapback-collection-toolbar,
      .clapback-collection-popover {
        --clapback-ink-focus: #F0EDE8;
        --clapback-ink-dense: #F0EDE8;
        --clapback-ink-light: #8A8278;
        --clapback-paper-ivory: #2B2722;
        --clapback-paper-rice: #24211D;
        --clapback-line-ink: rgba(248, 245, 240, 0.22);
        --clapback-seal-red: #E0475F;
        --clapback-seal-soft: rgba(224, 71, 95, 0.18);
        --clapback-green: #6FBE8E;
      }

      .clapback-collection-toolbar {
        background: var(--clapback-paper-ivory);
        box-shadow: 0 14px 36px rgba(0, 0, 0, 0.36);
      }
    }

    .clapback-collection-toolbar__status {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      white-space: nowrap;
      color: var(--clapback-ink-dense);
    }

    .clapback-collection-toolbar__platform {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 28px;
      padding: 5px 10px;
      border: 1px solid var(--clapback-line-ink);
      border-radius: 999px;
      background: var(--clapback-paper-rice);
      color: var(--clapback-ink-dense);
      font-weight: 600;
    }

    .clapback-collection-toolbar svg,
    .clapback-collection-popover svg {
      width: 16px;
      height: 16px;
      flex: 0 0 auto;
    }

    .clapback-collection-toolbar__source {
      color: var(--clapback-ink-light);
    }

    .clapback-collection-toolbar__divider {
      width: 1px;
      height: 24px;
      background: var(--clapback-line-ink);
      flex: 0 0 auto;
    }

    .clapback-collection-toolbar__state {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--clapback-green);
      font-weight: 600;
    }

    .clapback-collection-toolbar__count {
      color: var(--clapback-ink-dense);
    }

    .clapback-collection-toolbar__state--muted {
      color: var(--clapback-ink-light);
    }

    .clapback-collection-toolbar__spacer {
      flex: 1 1 auto;
      min-width: 16px;
    }

    .clapback-collection-toolbar__actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
    }

    .clapback-collection-toolbar__button,
    .clapback-collection-card__remove {
      border: 1px solid var(--clapback-line-ink);
      border-radius: 6px;
      background: var(--clapback-paper-rice);
      color: var(--clapback-ink-dense);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }

    .clapback-collection-toolbar__button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 44px;
      min-width: 54px;
      border-radius: 6px;
      padding: 0 10px;
    }

    .clapback-collection-toolbar__button[data-collection-action="scan"] {
      border-color: var(--clapback-seal-red);
      background: var(--clapback-seal-red);
      color: #ffffff;
      font-weight: 600;
    }

    .clapback-collection-toolbar__button[data-collection-action="exit"] {
      border-color: transparent;
      background: transparent;
      color: var(--clapback-ink-light);
    }

    .clapback-collection-toolbar__button--active {
      border-color: var(--clapback-seal-red);
      background: var(--clapback-seal-soft);
      color: var(--clapback-seal-red);
      font-weight: 600;
    }

    .clapback-collection-toolbar__button:hover,
    .clapback-collection-toolbar__button:focus-visible,
    .clapback-collection-popover__close:hover,
    .clapback-collection-popover__close:focus-visible,
    .clapback-collection-popover__rescan:hover,
    .clapback-collection-popover__rescan:focus-visible,
    .clapback-collection-card__remove:hover,
    .clapback-collection-card__remove:focus-visible {
      border-color: var(--clapback-seal-red);
      outline: none;
    }

    .clapback-collection-toolbar__feedback {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--clapback-green);
      font-size: 13px;
      font-weight: 600;
    }

    .clapback-collection-toolbar__feedback--muted {
      color: var(--clapback-ink-light);
    }

    .clapback-collection-popover {
      --clapback-ink-focus: #1A1714;
      --clapback-ink-dense: #34302A;
      --clapback-ink-light: #7C736A;
      --clapback-paper-ivory: #FBFAF7;
      --clapback-paper-rice: #F4F2EC;
      --clapback-line-ink: #D4CFC6;
      --clapback-seal-red: #C41E3A;
      --clapback-seal-soft: #F7DDE2;
      --clapback-green: #2E8B57;
      position: fixed;
      top: 88px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483644;
      width: min(820px, calc(100vw - 32px));
      box-sizing: border-box;
      padding: 16px;
      border: 1px solid var(--clapback-line-ink);
      border-radius: 8px;
      background: var(--clapback-paper-ivory);
      color: var(--clapback-ink-focus);
      font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "Microsoft YaHei", serif;
      box-shadow: 0 14px 36px rgba(26, 26, 26, 0.16);
    }

    .clapback-collection-popover__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }

    .clapback-collection-popover__heading {
      display: flex;
      align-items: baseline;
      gap: 12px;
      min-width: 0;
    }

    .clapback-collection-popover__title {
      margin: 0;
      color: var(--clapback-ink-focus);
      font-family: "ZCOOL XiaoWei", "Noto Serif SC", "Source Han Serif SC", serif;
      font-size: 22px;
      font-weight: 400;
      line-height: 1.2;
    }

    .clapback-collection-popover__summary {
      color: var(--clapback-green);
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
    }

    .clapback-collection-popover__close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: var(--clapback-ink-light);
      font: inherit;
      line-height: 1;
      cursor: pointer;
    }

    .clapback-collection-popover__list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: min(260px, 45vh);
      overflow: auto;
    }

    .clapback-collection-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 46px;
      padding: 0 12px;
      border: 1px solid var(--clapback-line-ink);
      border-radius: 6px;
      background: var(--clapback-paper-rice);
    }

    .clapback-collection-card__excerpt {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--clapback-ink-dense);
      font-family: "ZCOOL XiaoWei", "Noto Serif SC", serif;
      font-size: 14px;
    }

    .clapback-collection-card__remove {
      flex: 0 0 32px;
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      color: var(--clapback-ink-clear, var(--clapback-ink-light));
    }

    .clapback-collection-popover__empty,
    .clapback-collection-popover__target {
      margin: 0;
      color: var(--clapback-ink-light);
      font-size: 12px;
    }

    .clapback-collection-popover__target {
      margin-top: 8px;
    }

    .clapback-collection-popover__empty-panel {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 54px;
      padding: 0 10px 0 12px;
      border: 1px solid var(--clapback-line-ink);
      border-radius: 6px;
      background: var(--clapback-paper-rice);
    }

    .clapback-collection-popover__empty-message {
      margin: 0;
      color: var(--clapback-ink-light);
      font-size: 13px;
    }

    .clapback-collection-popover__rescan {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 44px;
      min-width: 78px;
      padding: 0 12px;
      border: 1px solid var(--clapback-seal-red);
      border-radius: 6px;
      background: var(--clapback-seal-red);
      color: #ffffff;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }

    @media (max-width: 720px) {
      .clapback-collection-toolbar {
        top: 10px;
        height: auto;
        min-height: 64px;
        align-items: flex-start;
        flex-wrap: wrap;
        padding: 10px 12px;
      }

      .clapback-collection-toolbar__status {
        flex: 1 1 100%;
        gap: 8px;
        overflow-x: auto;
      }

      .clapback-collection-toolbar__spacer {
        display: none;
      }

      .clapback-collection-toolbar__actions {
        width: 100%;
      }

      .clapback-collection-toolbar__button {
        flex: 1 1 0;
      }

      .clapback-collection-popover {
        top: 126px;
      }

      .clapback-collection-popover__header,
      .clapback-collection-popover__heading,
      .clapback-collection-popover__empty-panel {
        align-items: flex-start;
      }

      .clapback-collection-popover__heading,
      .clapback-collection-popover__empty-panel {
        flex-direction: column;
      }

      .clapback-collection-popover__empty-panel {
        padding: 12px;
      }
    }
  `;
  document.head.append(style);
}
