import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachZhihuClapback } from "./zhihuAdapter";

const fixture = `
  <main>
    <article>
      <h1>如何看待嘴替这个产品？</h1>
      <div class="RichContent-inner">这是回答正文，说明产品不会自动发布，只给人递稿。</div>
      <div class="CommentItem" data-za-detail-view-id="root-1">
        <div class="CommentItem-content">这类 AI 回复工具只会让讨论更糟。</div>
        <div class="CommentItem-footer">
          <button>赞同</button>
          <button>回复</button>
        </div>
        <textarea class="ReplyEditor"></textarea>
      </div>
      <div class="CommentItem" data-za-detail-view-id="root-2">
        <div class="CommentItem-content">如果能保持不自动发布，我倒觉得可以试试。</div>
        <div class="CommentItem-footer">
          <button>赞同</button>
          <button>回复</button>
        </div>
        <div contenteditable="true" class="RichReply"></div>
      </div>
    </article>
  </main>
`;

describe("Zhihu DOM adapter", () => {
  beforeEach(() => {
    document.body.innerHTML = fixture;
  });

  it("injects one always-visible angry action button per Zhihu comment action row", () => {
    const session = attachZhihuClapback({
      runtime: { generate: vi.fn() },
    });

    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".clapback-trigger")];

    expect(session.targets).toHaveLength(2);
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.textContent)).toEqual(["嘴替", "嘴替"]);
    expect(document.querySelectorAll(".CommentItem-footer .clapback-trigger")).toHaveLength(2);
  });

  it("injects an angry action button when a new Zhihu comment is inserted after SPA/lazy loading", async () => {
    attachZhihuClapback({
      runtime: { generate: vi.fn() },
    });

    const article = document.querySelector("article")!;
    article.insertAdjacentHTML(
      "beforeend",
      `
        <div class="CommentItem" data-za-detail-view-id="root-3">
          <div class="CommentItem-content">后加载评论也应该能嘴替。</div>
          <div class="CommentItem-footer">
            <button>赞同</button>
            <button>回复</button>
          </div>
        </div>
      `,
    );

    await vi.waitFor(() => {
      expect(document.querySelectorAll(".CommentItem-footer .clapback-trigger")).toHaveLength(3);
    });
  });

  it("locks the clicked target and opens a lightweight paper panel with generation controls", async () => {
    attachZhihuClapback({
      runtime: { generate: vi.fn() },
      settings: { activeSkillId: "默认高压嘴替", lengthMode: "短", ammoBoxIds: [] },
    });

    document.querySelectorAll<HTMLButtonElement>(".clapback-trigger")[0].click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-panel")).not.toBeNull();
    });

    const panel = document.querySelector<HTMLElement>(".clapback-panel");
    const input = document.querySelector<HTMLTextAreaElement>(".clapback-intent");

    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("目标已锁定");
    expect(panel?.textContent).toContain("这类 AI 回复工具只会让讨论更糟。");
    expect(panel?.querySelector<HTMLButtonElement>(".clapback-generate")?.textContent).toContain("生成");
    expect(panel?.querySelector<HTMLSelectElement>(".clapback-skill-select")?.value).toBe("默认高压嘴替");
    expect(panel?.querySelector<HTMLInputElement>(".clapback-custom-length")?.value).toBe("50");
    expect(panel?.querySelector<HTMLSelectElement>(".clapback-ammo-select")?.multiple).toBe(true);
    expect(panel?.textContent).not.toContain("阴阳怪气");
    expect(document.activeElement).toBe(input);
  });

  it("shows panel settings controls without unrelated presets", async () => {
    attachZhihuClapback({
      runtime: { generate: vi.fn() },
      settings: { activeSkillId: "默认高压嘴替", lengthMode: "短", ammoBoxIds: [] },
    });

    document.querySelector<HTMLButtonElement>(".clapback-trigger")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-panel")).not.toBeNull();
    });

    const settingsPanel = document.querySelector<HTMLElement>(".clapback-panel__settings")!;

    expect(settingsPanel).not.toBeNull();
    expect(settingsPanel.hidden).toBe(false);
    expect(settingsPanel.textContent).toContain("默认高压嘴替");
    expect(settingsPanel.textContent).toContain("弹药箱");
    expect(settingsPanel.textContent).not.toContain("阴阳怪气");
    expect(settingsPanel.textContent).not.toContain("梗已开");
    expect(settingsPanel.textContent).toContain("目标字数");
  });

  it("calls background generation with locked target and shows three candidates", async () => {
    const generate = vi.fn().mockResolvedValue({
      candidates: ["别把工具的问题甩给讨论质量。", "你怕的不是 AI，是没逻辑还被看见。", "不自动发布，就还是人在负责。"],
    });

    attachZhihuClapback({
      runtime: { generate },
      settings: { activeSkillId: "My Voice", lengthMode: "中", ammoBoxIds: [] },
    });

    document.querySelector<HTMLButtonElement>(".clapback-trigger")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-panel")).not.toBeNull();
    });

    document.querySelector<HTMLTextAreaElement>(".clapback-intent")!.value = "反驳工具原罪";
    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(document.querySelectorAll(".clapback-candidate")).toHaveLength(3);
    });

    expect(generate).toHaveBeenCalledWith({
      platform: "zhihu",
      target: {
        id: "root-1",
        text: "这类 AI 回复工具只会让讨论更糟。",
      },
      context: expect.objectContaining({
        pageTitle: "如何看待嘴替这个产品？",
        sourceTitle: "如何看待嘴替这个产品？",
        sourceText: "如何看待嘴替这个产品？ 这是回答正文，说明产品不会自动发布，只给人递稿。",
        nearbyComments: ["如果能保持不自动发布，我倒觉得可以试试。"],
      }),
      intent: "反驳工具原罪",
      settings: expect.objectContaining({ activeSkillId: "My Voice", lengthMode: "自定义", customLengthTarget: 50, ammoBoxIds: [] }),
    });
  });

  it("uses panel skill, length, and multi-selected ammo settings when generating", async () => {
    const generate = vi.fn().mockResolvedValue({
      candidates: ["候选一", "候选二", "候选三"],
    });

    attachZhihuClapback({
      runtime: { generate },
      settings: { activeSkillId: "default_high_fire", lengthMode: "短", ammoBoxIds: [] },
    });

    document.querySelector<HTMLButtonElement>(".clapback-trigger")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-panel")).not.toBeNull();
    });

    const skillSelect = document.querySelector<HTMLSelectElement>(".clapback-skill-select")!;
    skillSelect.append(new Option("火力全开", "full_fire"));
    skillSelect.value = "full_fire";
    document.querySelector<HTMLInputElement>(".clapback-custom-length")!.value = "90";
    const ammoSelect = document.querySelector<HTMLSelectElement>(".clapback-ammo-select")!;
    ammoSelect.append(new Option("法律常识", "7"));
    ammoSelect.append(new Option("热梗", "9"));
    ammoSelect.options[0].selected = true;
    ammoSelect.options[1].selected = true;
    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(generate).toHaveBeenCalled();
    });

    expect(generate.mock.calls[0][0].settings).toEqual({
      activeSkillId: "full_fire",
      lengthMode: "自定义",
      customLengthTarget: 90,
      ammoBoxIds: [7, 9],
    });
  });

  it("passes a custom target length from the panel into generation settings", async () => {
    const generate = vi.fn().mockResolvedValue({
      candidates: ["候选一", "候选二", "候选三"],
    });

    attachZhihuClapback({
      runtime: { generate },
      settings: { activeSkillId: "full_fire", lengthMode: "短", ammoBoxIds: [] },
    });

    document.querySelector<HTMLButtonElement>(".clapback-trigger")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-panel")).not.toBeNull();
    });

    const customLength = document.querySelector<HTMLInputElement>(".clapback-custom-length")!;
    customLength.value = "26";
    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(generate).toHaveBeenCalled();
    });

    expect(generate.mock.calls[0][0].settings).toEqual({
      activeSkillId: "full_fire",
      lengthMode: "自定义",
      customLengthTarget: 26,
      ammoBoxIds: [],
    });
  });

  it("extracts source text from the current Zhihu feed card when comments are outside article tags", async () => {
    const generate = vi.fn().mockResolvedValue({ candidates: ["候选一", "候选二", "候选三"] });
    document.body.innerHTML = `
      <main>
        <div class="ContentItem ArticleItem">
          <h2 class="ContentItem-title">Transformer 一篇论文八个作者</h2>
          <div class="RichContent-inner">2017 年春天，八个 Google 研究员提交了一篇论文。</div>
          <div class="Comments-container">
            <div class="css-jp43l4">
              <div class="css-14nvvry">
                <a>sjahsj</a>
                <span class="comment-text">写的真好，这才是我喜欢的知乎的样子</span>
                <div class="css-140jo2">
                  <span>05-25 · 江苏</span>
                  <div class="css-18opwoy">
                    <button>​ 回复</button>
                    <button>13</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="ContentItem ArticleItem">
          <h2 class="ContentItem-title">下一张卡不应进入上下文</h2>
          <div class="RichContent-inner">这是另一条 feed 的正文。</div>
        </div>
      </main>
    `;

    attachZhihuClapback({ runtime: { generate } });
    document.querySelector<HTMLButtonElement>(".clapback-trigger")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-panel")).not.toBeNull();
    });

    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(generate).toHaveBeenCalled();
    });

    expect(generate.mock.calls[0][0].context.sourceText).toContain("Transformer 一篇论文八个作者");
    expect(generate.mock.calls[0][0].context.sourceText).toContain("2017 年春天");
    expect(generate.mock.calls[0][0].context.sourceText).not.toContain("下一张卡不应进入上下文");
  });

  it("does not send unrelated Zhihu answer bodies as nearby comments for an answer target", async () => {
    const generate = vi.fn().mockResolvedValue({ candidates: ["候选一", "候选二", "候选三"] });
    document.body.innerHTML = `
      <main>
        <div class="AnswerItem" id="answer-one">
          <h2 class="ContentItem-title">传销话术为什么有效</h2>
          <div class="RichContent-inner">主回答正文只讨论传销话术和脆弱时刻，不涉及其他回答的例子。</div>
          <div class="ContentItem-actions">
            <button>赞同</button>
            <button>评论</button>
            <button>分享</button>
          </div>
        </div>
        <div class="AnswerItem" id="answer-two">
          <h2 class="ContentItem-title">另一个无关回答</h2>
          <div class="RichContent-inner">胖猫、驴肉火烧、罗素和尼采这些内容只属于另一个回答。</div>
          <div class="ContentItem-actions">
            <button>赞同</button>
            <button>评论</button>
            <button>分享</button>
          </div>
        </div>
      </main>
    `;

    attachZhihuClapback({ runtime: { generate } });
    document.querySelector<HTMLButtonElement>("#answer-one .clapback-trigger")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-panel")).not.toBeNull();
    });

    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(generate).toHaveBeenCalled();
    });

    const request = generate.mock.calls[0][0];
    expect(request.target.text).toContain("主回答正文");
    expect(request.context.sourceText).toContain("主回答正文");
    expect(request.context.sourceText).not.toContain("胖猫");
    expect(request.context.nearbyComments).toEqual([]);
  });

  it("shows an error and no selectable candidates when generation returns fewer than three candidates", async () => {
    const generate = vi.fn().mockResolvedValue({
      candidates: ["只有一条。", "只有两条。"],
    });

    attachZhihuClapback({ runtime: { generate } });

    document.querySelector<HTMLButtonElement>(".clapback-trigger")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-panel")).not.toBeNull();
    });

    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-panel__candidates")?.textContent).toContain("需要 3 条候选");
    });

    expect(document.querySelectorAll(".clapback-candidate")).toHaveLength(0);
  });

  it("shows an error and no selectable candidates when generation returns more than three candidates", async () => {
    const generate = vi.fn().mockResolvedValue({
      candidates: ["第一条。", "第二条。", "第三条。", "第四条。"],
    });

    attachZhihuClapback({ runtime: { generate } });

    document.querySelector<HTMLButtonElement>(".clapback-trigger")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-panel")).not.toBeNull();
    });

    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-panel__candidates")?.textContent).toContain("生成服务返回了 4 条");
    });

    expect(document.querySelectorAll(".clapback-candidate")).toHaveLength(0);
  });

  it("single-click copies a candidate and double-click autofills nearest reply editor without publishing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const generate = vi.fn().mockResolvedValue({ candidates: ["这不是自动开火，是先给人递稿。", "候选二", "候选三"] });

    attachZhihuClapback({ runtime: { generate } });

    document.querySelector<HTMLButtonElement>(".clapback-trigger")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-panel")).not.toBeNull();
    });

    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(document.querySelectorAll(".clapback-candidate")).toHaveLength(3);
    });

    const first = document.querySelector<HTMLButtonElement>(".clapback-candidate")!;
    first.click();
    first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(writeText).toHaveBeenCalledWith("这不是自动开火，是先给人递稿。");
    expect(document.querySelector<HTMLTextAreaElement>(".ReplyEditor")?.value).toBe("这不是自动开火，是先给人递稿。");
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "发布")).toBe(false);
  });

  it("keeps double-click autofill working when clipboard writeText rejects and the editor is outside the comment node", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    document.querySelector<HTMLTextAreaElement>(".ReplyEditor")?.remove();
    document.querySelector("[data-za-detail-view-id='root-1']")?.insertAdjacentHTML(
      "afterend",
      `<div class="ReplyLayer"><textarea class="AdjacentReply"></textarea><button>发布</button></div>`,
    );
    const generate = vi.fn().mockResolvedValue({ candidates: ["照样填进去。", "候选二", "候选三"] });

    attachZhihuClapback({ runtime: { generate } });

    document.querySelector<HTMLButtonElement>(".clapback-trigger")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-panel")).not.toBeNull();
    });

    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(document.querySelectorAll(".clapback-candidate")).toHaveLength(3);
    });

    const first = document.querySelector<HTMLButtonElement>(".clapback-candidate")!;
    first.click();
    first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLTextAreaElement>(".AdjacentReply")?.value).toBe("照样填进去。");
    });
    expect(writeText).toHaveBeenCalledWith("照样填进去。");
    expect([...document.querySelectorAll("button")].filter((button) => button.textContent === "发布")).toHaveLength(1);
  });

  it("does not autofill another locked comment when the selected comment has no local or adjacent editor", async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <div class="CommentItem" data-za-detail-view-id="root-1">
            <div class="CommentItem-content">锁定第一条，但它没有回复框。</div>
            <div class="CommentItem-footer">
              <button>赞同</button>
              <button>回复</button>
            </div>
          </div>
          <div class="CommentItem" data-za-detail-view-id="root-2">
            <div class="CommentItem-content">第二条自己的回复框不能被填。</div>
            <div class="CommentItem-footer">
              <button>赞同</button>
              <button class="PublishButton">发布</button>
            </div>
            <textarea class="OtherReply"></textarea>
          </div>
        </article>
      </main>
    `;
    const publish = vi.fn();
    document.querySelector<HTMLButtonElement>(".PublishButton")?.addEventListener("click", publish);
    const generate = vi.fn().mockResolvedValue({ candidates: ["只应该属于 root-1。", "候选二", "候选三"] });
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    Object.assign(navigator, { clipboard: { writeText } });

    attachZhihuClapback({ runtime: { generate } });

    document.querySelector<HTMLButtonElement>("[data-za-detail-view-id='root-1'] .clapback-trigger")?.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".clapback-panel")).not.toBeNull();
    });

    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(document.querySelectorAll(".clapback-candidate")).toHaveLength(3);
    });

    const first = document.querySelector<HTMLButtonElement>(".clapback-candidate")!;
    first.click();
    first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>(".clapback-panel__candidates")?.dataset.clapbackStatus).toBe("copied");
    });
    expect(document.querySelector<HTMLTextAreaElement>(".OtherReply")?.value).toBe("");
    expect(publish).not.toHaveBeenCalled();
  });
});
