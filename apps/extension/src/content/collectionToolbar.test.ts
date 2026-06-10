import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionBasketItem, CollectionSession } from "../api/types";
import { attachCollectionToolbar } from "./collectionToolbar";

const session: CollectionSession = {
  id: "collection-1",
  tab_id: 12,
  platform: "zhihu",
  box_id: 7,
  box_name: "罗翔知乎素材",
  creator_url: "https://www.zhihu.com/people/example",
  requested_count: 50,
  status: "active",
  current_count: 0,
  imported_count: 0,
  skipped_count: 0,
  created_at: "2026-06-02T00:00:00.000Z",
  updated_at: "2026-06-02T00:00:00.000Z",
};

describe("creator collection toolbar", () => {
  const basket: CollectionBasketItem[] = [];
  const messages: Array<{ type: string; payload?: unknown }> = [];

  beforeEach(() => {
    basket.length = 0;
    messages.length = 0;
    document.body.innerHTML = `
      <main>
        <article class="AnswerItem" data-za-detail-view-id="answer-1">
          <h2 class="ContentItem-title">为什么法律不能按闹分配？</h2>
          <div class="RichContent-inner">法律不是按谁声音大来分配的，程序才是底线。</div>
        </article>
      </main>
    `;
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        sendMessage: vi.fn(async ({ type, payload }: { type: string; payload?: unknown }) => {
          messages.push({ type, payload });
          if (type === "collection:getSessionForTab") return { ok: true, data: session };
          if (type === "collection:listBasket") return { ok: true, data: [...basket] };
          if (type === "collection:addCandidates") {
            const candidates = (payload as { candidates: CollectionBasketItem[] }).candidates;
            for (const candidate of candidates) {
              basket.push({
                ...candidate,
                id: `candidate-${basket.length + 1}`,
                session_id: session.id,
                dedupe_key: candidate.sourceId ?? candidate.text,
                created_at: new Date().toISOString(),
              });
            }
            return { ok: true, data: { added: candidates.length, skipped: 0, basket_count: basket.length, limit_reached: false } };
          }
          if (type === "collection:removeCandidate") {
            const id = (payload as { candidateId: string }).candidateId;
            const index = basket.findIndex((item) => item.id === id);
            if (index >= 0) basket.splice(index, 1);
            return { ok: true, data: undefined };
          }
          if (type === "collection:importBasket") {
            const imported = basket.length;
            basket.length = 0;
            return { ok: true, data: { imported, skipped: 0, box_id: session.box_id } };
          }
          if (type === "collection:endSession") return { ok: true, data: undefined };
          return { ok: false, error: "unexpected_message" };
        }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders only for an active collection session and scans the current page", async () => {
    await attachCollectionToolbar();

    expect(document.querySelector(".clapback-collection-toolbar")?.textContent).toContain("采风中");
    expect(document.querySelector(".clapback-collection-toolbar")?.textContent).toContain("已收 0 条");
    document.querySelector<HTMLButtonElement>("[data-collection-action='scan']")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-collection-toolbar")?.textContent).toContain("新增 1 · 跳过重复 0");
      expect(document.querySelector(".clapback-collection-toolbar")?.textContent).toContain("采风中");
      expect(document.querySelector(".clapback-collection-toolbar")?.textContent).toContain("已收 1 条");
    });
    expect(messages).toContainEqual(expect.objectContaining({ type: "collection:addCandidates" }));
  });

  it("expands collapsed Zhihu content before collecting candidates", async () => {
    document.body.innerHTML = `
      <main>
        <article class="AnswerItem" data-za-detail-view-id="answer-collapsed">
          <h2 class="ContentItem-title">为什么知乎回答采不到全文？</h2>
          <div class="RichContent RichContent--unescapable is-collapsed">
            <div class="RichContent-inner">预览到这里就断了。</div>
            <button type="button" class="Button ContentItem-more">阅读全文</button>
          </div>
        </article>
      </main>
    `;
    const more = document.querySelector<HTMLButtonElement>(".ContentItem-more");
    more?.addEventListener("click", () => {
      const rich = document.querySelector<HTMLElement>(".RichContent");
      const inner = document.querySelector<HTMLElement>(".RichContent-inner");
      rich?.classList.remove("is-collapsed");
      if (inner) inner.textContent = "预览到这里就断了。展开后这里才是知乎回答的完整正文，最后一句也必须进入采风篮。";
      if (more) more.textContent = "收起";
    });

    await attachCollectionToolbar();
    document.querySelector<HTMLButtonElement>("[data-collection-action='scan']")?.click();

    await vi.waitFor(() => {
      const added = messages.find((message) => message.type === "collection:addCandidates");
      const candidates = (added?.payload as { candidates?: Array<{ text: string }> } | undefined)?.candidates ?? [];
      expect(candidates[0]?.text).toContain("展开后这里才是知乎回答的完整正文");
      expect(candidates[0]?.text).toContain("最后一句也必须进入采风篮");
      expect(more?.textContent).toBe("收起");
    });
  });

  it("keeps the creator fieldwork toolbar close to the top edge", async () => {
    await attachCollectionToolbar();

    const toolbar = document.querySelector<HTMLElement>(".clapback-collection-toolbar");
    const styleText = document.querySelector<HTMLStyleElement>("#clapback-collection-style")?.textContent ?? "";

    expect(toolbar?.textContent).toContain("知乎");
    expect(toolbar?.textContent).toContain("创作者主页");

    const actions = [...document.querySelectorAll<HTMLButtonElement>("[data-collection-action]")];
    expect(actions.map((button) => button.textContent)).toEqual(["扫描", "采风", "导入", "退出"]);
    expect(toolbar?.querySelector("[data-collection-icon='globe']")).toBeTruthy();
    expect(actions.map((button) => button.getAttribute("aria-label"))).toEqual([
      "扫描当前页",
      "打开采风篮",
      "导入素材箱",
      "退出采风",
    ]);
    expect(actions.map((button) => button.querySelector("svg")?.dataset.collectionIcon)).toEqual([
      "scan-search",
      "archive",
      "download",
      "x",
    ]);
    expect(actions.every((button) => button.querySelector(".clapback-collection-toolbar__button-label")?.textContent?.trim())).toBe(true);

    expect(styleText).toMatch(/\.clapback-collection-toolbar\s*{[^}]*top:\s*10px;/s);
    expect(styleText).toMatch(/\.clapback-collection-toolbar\s*{[^}]*left:\s*50%;/s);
    expect(styleText).toMatch(/\.clapback-collection-toolbar\s*{[^}]*transform:\s*translateX\(-50%\);/s);
    expect(styleText).toMatch(/\.clapback-collection-toolbar\s*{[^}]*width:\s*min\(820px,\s*calc\(100vw - 32px\)\);/s);
    expect(styleText).toMatch(/\.clapback-collection-toolbar\s*{[^}]*height:\s*64px;/s);
    expect(styleText).toMatch(/\.clapback-collection-toolbar\s*{[^}]*padding:\s*0 16px;/s);
    expect(styleText).toMatch(/\.clapback-collection-toolbar\s*{[^}]*gap:\s*16px;/s);
    expect(styleText).toMatch(/\.clapback-collection-toolbar__actions\s*{[^}]*display:\s*flex;/s);
    expect(styleText).toMatch(/\.clapback-collection-toolbar__actions\s*{[^}]*gap:\s*8px;/s);
    expect(styleText).toMatch(/\.clapback-collection-toolbar__button\s*{[^}]*height:\s*44px;/s);
    expect(styleText).toMatch(/\.clapback-collection-toolbar__button\s*{[^}]*border-radius:\s*6px;/s);
    expect(styleText).toMatch(/\.clapback-collection-popover\s*{[^}]*top:\s*88px;/s);
    expect(styleText).toMatch(/\.clapback-collection-popover\s*{[^}]*width:\s*min\(820px,\s*calc\(100vw - 32px\)\);/s);
  });

  it("opens a basket popover with excerpts, delete controls, and target corpus", async () => {
    basket.push({
      platform: "zhihu",
      kind: "answer",
      text: "法律不是按谁声音大来分配的，程序才是底线。",
      title: "为什么法律不能按闹分配？",
      sourceId: "answer-1",
      id: "candidate-1",
      session_id: session.id,
      dedupe_key: "answer-1",
      created_at: "2026-06-02T00:00:00.000Z",
    });

    await attachCollectionToolbar();
    document.querySelector<HTMLButtonElement>("[data-collection-action='basket']")?.click();

    expect(document.querySelector(".clapback-collection-popover")?.textContent).toContain("法律不是按谁声音大来分配的，程序才是底线。");
    expect(document.querySelector(".clapback-collection-popover__title")?.textContent).toBe("采风篮");
    expect(document.querySelector(".clapback-collection-popover__summary")?.textContent).toBe("已收 1 条");
    expect(document.querySelector(".clapback-collection-popover__target")?.textContent).toContain("罗翔知乎素材");

    document.querySelector<HTMLButtonElement>("[data-collection-popover-close]")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>(".clapback-collection-popover")?.hidden).toBe(true);
      expect(document.querySelector<HTMLButtonElement>("[data-collection-action='basket']")?.getAttribute("aria-expanded")).toBe("false");
    });

    document.querySelector<HTMLButtonElement>("[data-collection-action='basket']")?.click();

    const removeButton = document.querySelector<HTMLButtonElement>("[data-candidate-id='candidate-1']");
    expect(removeButton?.querySelector("svg")?.dataset.collectionIcon).toBe("trash-2");
    expect(removeButton?.textContent).toBe("");
    removeButton?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-collection-popover")?.textContent).not.toContain("法律不是按谁声");
      expect(document.querySelector(".clapback-collection-toolbar")?.textContent).toContain("已收 0 条");
    });
  });

  it("opens the design empty-state panel after a scan finds no content", async () => {
    document.body.innerHTML = "<main><nav>首页 推荐 登录</nav></main>";

    await attachCollectionToolbar();
    document.querySelector<HTMLButtonElement>("[data-collection-action='scan']")?.click();

    await vi.waitFor(() => {
      const toolbarText = document.querySelector(".clapback-collection-toolbar")?.textContent ?? "";
      const popover = document.querySelector<HTMLElement>(".clapback-collection-popover");
      expect(toolbarText).toContain("已扫描");
      expect(toolbarText).toContain("已收 0 条");
      expect(toolbarText).toContain("新增 0 · 跳过重复 0");
      expect(popover?.hidden).toBe(false);
      expect(popover?.textContent).toContain("当前页暂未识别到可采风内容");
      expect(popover?.textContent).toContain("请继续滚动、切换到作品列表页，或回素材箱手动导入。");
      expect(popover?.textContent).toContain("再次扫描");
      expect(toolbarText).not.toContain("选中文本");
    });

    document.querySelector<HTMLButtonElement>("[data-collection-empty-rescan]")?.click();

    await vi.waitFor(() => {
      expect(messages.filter((message) => message.type === "collection:addCandidates")).toHaveLength(0);
      expect(document.querySelector(".clapback-collection-popover")?.textContent).toContain("当前页暂未识别到可采风内容");
    });
  });

  it("shows a clear feedback message when the requested crawl count limit is reached", async () => {
    const sendMessage = chrome.runtime.sendMessage as unknown as {
      mockImplementation(fn: (message: unknown) => Promise<unknown>): void;
    };
    sendMessage.mockImplementation(async (message: unknown) => {
      const { type, payload } = message as { type: string; payload?: unknown };
      messages.push({ type, payload });
      if (type === "collection:getSessionForTab") return { ok: true, data: { ...session, requested_count: 1 } };
      if (type === "collection:listBasket") return { ok: true, data: [...basket] };
      if (type === "collection:addCandidates") {
        const candidates = (payload as { candidates: CollectionBasketItem[] }).candidates;
        basket.push({
          ...candidates[0],
          id: "candidate-1",
          session_id: session.id,
          dedupe_key: candidates[0].sourceId ?? candidates[0].text,
          created_at: new Date().toISOString(),
        });
        return { ok: true, data: { added: 1, skipped: Math.max(0, candidates.length - 1), basket_count: 1, limit_reached: true } };
      }
      return { ok: true, data: undefined };
    });

    await attachCollectionToolbar();
    document.querySelector<HTMLButtonElement>("[data-collection-action='scan']")?.click();

    await vi.waitFor(() => {
      const toolbarText = document.querySelector(".clapback-collection-toolbar")?.textContent ?? "";
      expect(toolbarText).toContain("已达爬取数量上限");
      expect(toolbarText).toContain("采风中");
      expect(toolbarText).toContain("已收 1 条");
    });
  });

  it("imports the basket and exits the active session", async () => {
    basket.push({
      platform: "zhihu",
      kind: "answer",
      text: "法律不是按谁声音大来分配的，程序才是底线。",
      id: "candidate-1",
      session_id: session.id,
      dedupe_key: "answer-1",
      created_at: "2026-06-02T00:00:00.000Z",
    });

    await attachCollectionToolbar();
    document.querySelector<HTMLButtonElement>("[data-collection-action='import']")?.click();

    await vi.waitFor(() => {
      expect(messages).toContainEqual(expect.objectContaining({ type: "collection:importBasket" }));
      expect(document.querySelector(".clapback-collection-toolbar")).toBeNull();
    });
  });

  it("ends the active session when exiting without importing", async () => {
    await attachCollectionToolbar();
    document.querySelector<HTMLButtonElement>("[data-collection-action='exit']")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-collection-toolbar")).toBeNull();
      expect(messages).toContainEqual(expect.objectContaining({ type: "collection:endSession" }));
    });
  });
});
