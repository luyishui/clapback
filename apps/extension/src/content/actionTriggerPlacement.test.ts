import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { attachWeiboClapback } from "./weiboAdapter";
import { attachXiaohongshuClapback } from "./xiaohongshuAdapter";
import { attachZhihuClapback } from "./zhihuAdapter";
import { injectGlobalTrigger } from "./globalTrigger";

function loadDomFixture(name: string): string {
  return readFileSync(resolve(process.cwd(), "../../references/dom html", name), "utf8");
}

describe("comment action trigger placement", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("appends the Zhihu trigger as the last item in the native action row", () => {
    document.body.innerHTML = `
      <div class="CommentItem" data-za-detail-view-id="zhihu-1">
        <div class="CommentItem-content">知乎评论正文。</div>
        <div class="CommentItem-footer">
          <button class="vote">赞同</button>
          <button class="reply">回复</button>
        </div>
      </div>
    `;

    attachZhihuClapback({ runtime: { generate: vi.fn() } });

    const actionRow = document.querySelector<HTMLElement>(".CommentItem-footer")!;
    expect([...actionRow.children].map((node) => node.textContent?.trim())).toEqual(["赞同", "回复", "嘴替"]);
    expect(actionRow.lastElementChild?.classList.contains("clapback-trigger")).toBe(true);
    expect(actionRow.lastElementChild?.classList.contains("clapback-trigger--zhihu")).toBe(true);
  });

  it("keeps a single Zhihu row trigger when the content script is injected twice", () => {
    document.body.innerHTML = `
      <div class="CommentItem" data-za-detail-view-id="zhihu-1">
        <div class="CommentItem-content">知乎评论正文。</div>
        <div class="CommentItem-footer">
          <button class="vote">赞同</button>
          <button class="reply">回复</button>
        </div>
      </div>
    `;

    attachZhihuClapback({ runtime: { generate: vi.fn() } });
    attachZhihuClapback({ runtime: { generate: vi.fn() } });

    const actionRow = document.querySelector<HTMLElement>(".CommentItem-footer")!;
    expect(actionRow.querySelectorAll(".clapback-trigger")).toHaveLength(1);
    expect([...actionRow.children].map((node) => node.textContent?.trim())).toEqual(["赞同", "回复", "嘴替"]);
  });

  it("appends the Zhihu trigger in the modern hash-class comment action row", () => {
    document.body.innerHTML = `
      <main>
        <article class="TopstoryItem">
          <h2>Transformer 一篇论文八个作者</h2>
          <div class="RichContent-inner">2017 年春天，八个 Google 研究员提交了一篇论文。</div>
          <div class="css-jp43l4">
            <div class="css-14nvvry">
              <a href="/people/a">sjahsj</a>
              <span class="comment-text">写的真好，这才是我喜欢的知乎的样子</span>
              <div class="css-140jo2">
                <span>05-25 · 江苏</span>
                <div class="css-18opwoy">
                  <button class="Button Button--plain Button--withIcon Button--withLabel">​ 回复</button>
                  <button class="Button Button--plain">13</button>
                </div>
              </div>
            </div>
          </div>
        </article>
      </main>
    `;

    attachZhihuClapback({ runtime: { generate: vi.fn() } });

    const actionRow = document.querySelector<HTMLElement>(".css-18opwoy")!;
    expect(actionRow.children).toHaveLength(3);
    expect(actionRow.children[0].textContent?.trim()).toContain("回复");
    expect(actionRow.children[1].textContent?.trim()).toBe("13");
    expect(actionRow.lastElementChild?.textContent?.trim()).toBe("嘴替");
    expect(actionRow.lastElementChild?.classList.contains("clapback-trigger")).toBe(true);
  });

  it("appends the Zhihu trigger to a post ContentItem action row", () => {
    document.body.innerHTML = `
      <div class="ContentItem ArticleItem" data-zop='{"itemId":"article-1"}'>
        <h2 class="ContentItem-title"><a>Transformer 一篇论文八个作者</a></h2>
        <div class="RichContent">
          <div class="RichContent-inner">2017 年春天，八个 Google 研究员提交了一篇论文。</div>
          <div class="ContentItem-actions">
            <button class="VoteButton">赞同 296</button>
            <button class="Button">收起评论</button>
            <button class="Button">收藏</button>
            <button class="Button">喜欢</button>
            <button class="Button">分享</button>
          </div>
        </div>
      </div>
    `;

    const session = attachZhihuClapback({ runtime: { generate: vi.fn() } });

    const actionRow = document.querySelector<HTMLElement>(".ContentItem-actions")!;
    expect(session.targets).toHaveLength(1);
    expect(session.targets[0].target.text).toContain("Transformer 一篇论文八个作者");
    expect(session.targets[0].target.text).toContain("2017 年春天，八个 Google 研究员提交了一篇论文。");
    expect(session.targets[0].target.text).not.toContain("赞同 296");
    expect(session.targets[0].target.text).not.toContain("收起评论");
    expect(actionRow.lastElementChild?.textContent?.trim()).toBe("嘴替");
    expect(actionRow.lastElementChild?.classList.contains("clapback-trigger")).toBe(true);
  });

  it("sends Zhihu post generation with clean post text as source context", async () => {
    const generate = vi.fn().mockResolvedValue({ candidates: ["候选一", "候选二", "候选三"] });
    document.body.innerHTML = `
      <div class="ContentItem ArticleItem" data-zop='{"itemId":"article-1"}'>
        <h2 class="ContentItem-title"><a>Transformer 一篇论文八个作者</a></h2>
        <div class="RichContent">
          <div class="RichContent-inner">2017 年春天，八个 Google 研究员提交了一篇论文。</div>
          <div class="ContentItem-actions">
            <button class="VoteButton">赞同 296</button>
            <button class="Button">收起评论</button>
            <button class="Button">收藏</button>
            <button class="Button">喜欢</button>
            <button class="Button">分享</button>
          </div>
        </div>
      </div>
    `;

    attachZhihuClapback({ runtime: { generate } });
    document.querySelector<HTMLButtonElement>(".ContentItem-actions .clapback-trigger")?.click();
    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(generate).toHaveBeenCalled();
    });

    expect(generate.mock.calls[0][0]).toEqual(expect.objectContaining({
      platform: "zhihu",
      target: expect.objectContaining({
        text: "Transformer 一篇论文八个作者 2017 年春天，八个 Google 研究员提交了一篇论文。",
      }),
      context: expect.objectContaining({
        sourceText: expect.stringContaining("2017 年春天，八个 Google 研究员提交了一篇论文。"),
      }),
    }));
    expect(generate.mock.calls[0][0].target.text).not.toContain("赞同 296");
    expect(generate.mock.calls[0][0].context.sourceText).not.toContain("收起评论");
  });

  it("opens the Zhihu comment panel as the right-bottom floating panel", () => {
    document.body.innerHTML = `
      <div class="CommentItem" data-za-detail-view-id="zhihu-1">
        <div class="CommentItem-content">知乎评论正文。</div>
        <div class="CommentItem-footer">
          <button class="reply">回复</button>
          <button class="like">喜欢</button>
        </div>
      </div>
    `;

    attachZhihuClapback({ runtime: { generate: vi.fn() } });
    document.querySelector<HTMLButtonElement>(".clapback-trigger")?.click();

    const panel = document.querySelector<HTMLElement>(".clapback-panel")!;
    expect(panel.parentElement).toBe(document.body);
    expect(panel.style.position).toBe("fixed");
    expect(panel.style.right).toBe("24px");
    expect(panel.style.bottom).toBe("88px");
    expect(panel.style.maxHeight).toBe("calc(100vh - 112px)");
    expect(panel.style.top).toBe("");
  });

  it("sends Zhihu comment generation with the source post content", async () => {
    const generate = vi.fn().mockResolvedValue({ candidates: ["候选一", "候选二", "候选三"] });
    document.body.innerHTML = `
      <div class="ContentItem ArticleItem">
        <h2 class="ContentItem-title"><a>Transformer 一篇论文八个作者</a></h2>
        <div class="RichContent-inner">2017 年春天，八个 Google 研究员提交了一篇论文。</div>
        <div class="Comments-container">
          <div class="CommentItem" data-za-detail-view-id="zhihu-comment-1">
            <div class="CommentItem-content">写的真好，这才是我喜欢的知乎。</div>
            <div class="CommentItem-footer"><button>回复</button><button>喜欢</button></div>
          </div>
        </div>
      </div>
    `;

    attachZhihuClapback({ runtime: { generate } });
    document.querySelector<HTMLButtonElement>(".CommentItem-footer .clapback-trigger")?.click();
    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(generate).toHaveBeenCalled();
    });

    expect(generate.mock.calls[0][0]).toEqual(expect.objectContaining({
      platform: "zhihu",
      target: expect.objectContaining({ text: "写的真好，这才是我喜欢的知乎。" }),
      context: expect.objectContaining({
        sourceText: expect.stringContaining("2017 年春天，八个 Google 研究员提交了一篇论文。"),
      }),
    }));
  });

  it("appends the Weibo trigger as the last item in the native action row", () => {
    document.body.innerHTML = `
      <article class="card-wrap" mid="weibo-1">
        <div class="WB_text">微博评论正文。</div>
        <div class="card-act">
          <button class="repost">转发</button>
          <button class="comment">评论</button>
          <button class="like">赞</button>
        </div>
      </article>
    `;

    attachWeiboClapback({ runtime: { generate: vi.fn() } });

    const actionRow = document.querySelector<HTMLElement>(".card-act")!;
    expect([...actionRow.children].map((node) => node.textContent?.trim())).toEqual(["转发", "评论", "赞", "嘴替"]);
    expect(actionRow.lastElementChild?.classList.contains("clapback-trigger")).toBe(true);
  });

  it("keeps a single Weibo row trigger when the content script is injected twice", () => {
    document.body.innerHTML = `
      <article class="card-wrap" mid="weibo-1">
        <div class="WB_text">微博评论正文。</div>
        <div class="card-act">
          <button class="repost">转发</button>
          <button class="comment">评论</button>
          <button class="like">赞</button>
        </div>
      </article>
    `;

    attachWeiboClapback({ runtime: { generate: vi.fn() } });
    attachWeiboClapback({ runtime: { generate: vi.fn() } });

    const actionRow = document.querySelector<HTMLElement>(".card-act")!;
    expect(actionRow.querySelectorAll(".clapback-trigger")).toHaveLength(1);
    expect([...actionRow.children].map((node) => node.textContent?.trim())).toEqual(["转发", "评论", "赞", "嘴替"]);
  });

  it("appends the Weibo trigger in the modern woo feed action row", () => {
    document.body.innerHTML = `
      <article class="woo-panel-main _wrap_m3n8j_2" mid="weibo-modern-1">
        <div class="wbpro-feed-content">
          <div class="_wbtext_velez_14">我不知道哈尔滨突然怎么了，好像在龙卷风加沙尘暴。</div>
        </div>
        <div class="woo-box-flex">
          <div class="woo-box-item-flex">
            <div class="woo-box-flex woo-box-alignCenter _left_198pe_38 _main_198pe_12">
              <div class="woo-box-item-flex _item_198pe_23 _cursor_198pe_184">86</div>
              <div class="woo-box-item-flex _item_198pe_23 _cursor_198pe_184">187</div>
              <div class="woo-box-item-flex _item_198pe_23 _cursor_198pe_184"><button class="woo-like-main">1345</button></div>
            </div>
          </div>
        </div>
      </article>
    `;

    attachWeiboClapback({ runtime: { generate: vi.fn() } });

    const actionRow = document.querySelector<HTMLElement>("._main_198pe_12")!;
    expect([...actionRow.children].map((node) => node.textContent?.trim())).toEqual(["86", "187", "1345", "嘴替"]);
    expect(actionRow.lastElementChild?.classList.contains("clapback-trigger")).toBe(true);
  });

  it("appends the Weibo trigger in the current mobile card9 footer row", () => {
    document.body.innerHTML = `
      <main>
        <div class="card m-panel card9 f-weibo" mid="mobile-1">
          <article class="weibo-main">
            <div class="weibo-og">推荐关注</div>
            <div class="weibo-text">#广西文旅辟谣# 网传消息和实际情况并不一致。</div>
            <footer class="f-footer-ctrl">
              <a>转发 12</a>
              <a>评论 3</a>
              <a>赞 8</a>
            </footer>
          </article>
        </div>
      </main>
    `;

    attachWeiboClapback({ runtime: { generate: vi.fn() } });

    const actionRow = document.querySelector<HTMLElement>(".f-footer-ctrl")!;
    expect([...actionRow.children].map((node) => node.textContent?.trim())).toEqual(["转发 12", "评论 3", "赞 8", "嘴替"]);
    expect(actionRow.lastElementChild?.classList.contains("clapback-trigger")).toBe(true);
  });

  it("appends Weibo triggers to real creator profile fixture post action rows", () => {
    document.documentElement.innerHTML = loadDomFixture("@卢伟冰 的个人主页.htm");

    const session = attachWeiboClapback({ runtime: { generate: vi.fn() } });

    expect(session.targets.length).toBeGreaterThanOrEqual(2);
    expect(document.querySelectorAll(".clapback-trigger").length).toBeGreaterThanOrEqual(2);
    const firstActionRow = document.querySelector<HTMLElement>("article [class*='_main_'][class*='_left_']");
    expect(firstActionRow?.lastElementChild?.textContent?.trim()).toBe("嘴替");
  });

  it("opens the Weibo panel as the right-bottom floating panel", () => {
    document.body.innerHTML = `
      <article class="card-wrap" mid="weibo-1">
        <div class="WB_text">微博帖子正文。</div>
        <div class="card-act">
          <button class="repost">转发</button>
          <button class="comment">评论</button>
          <button class="like">赞</button>
        </div>
      </article>
    `;

    attachWeiboClapback({ runtime: { generate: vi.fn() } });
    document.querySelector<HTMLButtonElement>(".clapback-trigger")?.click();

    const panel = document.querySelector<HTMLElement>(".clapback-panel")!;
    const actionRow = document.querySelector<HTMLElement>(".card-act")!;
    expect(panel.parentElement).toBe(document.body);
    expect(actionRow.nextElementSibling).not.toBe(panel);
    expect(panel.style.position).toBe("fixed");
    expect(panel.style.right).toBe("24px");
    expect(panel.style.bottom).toBe("88px");
    expect(panel.style.maxHeight).toBe("calc(100vh - 112px)");
  });

  it("appends Weibo triggers to single-post comments and nested replies", () => {
    document.body.innerHTML = `
      <main>
        <article class="woo-panel-main _wrap_m3n8j_2" mid="weibo-post-1">
          <div class="wbpro-feed-content"><div class="_wbtext_velez_14">微博帖子正文。</div></div>
          <div class="woo-box-flex woo-box-alignCenter _left_198pe_38 _main_198pe_12">
            <div>115</div><div>234</div><div><button class="woo-like-main" title="赞">1806</button></div>
          </div>
        </article>
        <div class="wbpro-list">
          <div class="item1">
            <div class="woo-box-item-flex con1">
              <div class="text"><a>Aaaaa懒大王-</a><span>:</span><span>主评论正文。</span></div>
              <div class="woo-box-flex woo-box-alignCenter woo-box-justifyBetween info info">
                <div>26-5-31 18:34 来自广东</div>
                <div class="woo-box-flex opt opt">
                  <div class="wbpro-iconbed optHover"></div>
                  <div class="wbpro-iconbed"></div>
                  <div class="wbpro-iconbed"></div>
                  <div class="wbpro-iconbed"><button class="woo-like-main" title="赞">16</button></div>
                </div>
              </div>
            </div>
            <div class="list2">
              <div class="item2">
                <div class="con2">
                  <div class="text"><a>王汪汪鱼</a><span>:</span><span>楼中楼回复正文。</span></div>
                  <div class="woo-box-flex woo-box-alignCenter woo-box-justifyBetween info info">
                    <div>26-5-31 18:55 来自黑龙江</div>
                    <div class="woo-box-flex opt opt">
                      <div class="wbpro-iconbed optHover"></div>
                      <div class="wbpro-iconbed optHover"></div>
                      <div class="wbpro-iconbed optHover"></div>
                      <div class="wbpro-iconbed optHover"><button class="woo-like-main optHover" title="赞">1</button></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    `;

    attachWeiboClapback({ runtime: { generate: vi.fn() } });

    expect(document.querySelector<HTMLElement>(".item1 > .con1 .opt .clapback-trigger")?.textContent).toBe("嘴替");
    expect(document.querySelector<HTMLElement>(".item2 .con2 .opt .clapback-trigger")?.textContent).toBe("嘴替");
  });

  it("sends Weibo comment generation with the source post content", async () => {
    const generate = vi.fn().mockResolvedValue({ candidates: ["候选一", "候选二", "候选三"] });
    document.body.innerHTML = `
      <main>
        <article class="woo-panel-main _wrap_m3n8j_2" mid="weibo-post-1">
          <div class="wbpro-feed-content"><div class="_wbtext_velez_14">哈尔滨突然龙卷风加沙尘暴。</div></div>
          <div class="woo-box-flex woo-box-alignCenter _left_198pe_38 _main_198pe_12">
            <div>115</div><div>234</div><div><button class="woo-like-main" title="赞">1806</button></div>
          </div>
        </article>
        <div class="wbpro-list">
          <div class="item1">
            <div class="woo-box-item-flex con1">
              <div class="text"><a>Aaaaa懒大王-</a><span>:</span><span>主评论正文。</span></div>
              <div class="woo-box-flex woo-box-alignCenter woo-box-justifyBetween info info">
                <div>26-5-31 18:34 来自广东</div>
                <div class="woo-box-flex opt opt">
                  <div class="wbpro-iconbed optHover"></div>
                  <div class="wbpro-iconbed"></div>
                  <div class="wbpro-iconbed"></div>
                  <div class="wbpro-iconbed"><button class="woo-like-main" title="赞">16</button></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    `;

    attachWeiboClapback({ runtime: { generate } });
    document.querySelector<HTMLButtonElement>(".item1 .clapback-trigger")?.click();
    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(generate).toHaveBeenCalled();
    });

    expect(generate.mock.calls[0][0]).toEqual(expect.objectContaining({
      platform: "weibo",
      target: expect.objectContaining({ text: expect.stringContaining("主评论正文。") }),
      context: expect.objectContaining({
        sourceText: expect.stringContaining("哈尔滨突然龙卷风加沙尘暴。"),
      }),
    }));
  });

  it("locks modern Weibo feed text instead of the author/header metadata", async () => {
    const generate = vi.fn().mockResolvedValue({ candidates: ["候选一", "候选二", "候选三"] });
    document.body.innerHTML = `
      <article class="woo-panel-main _wrap_m3n8j_2">
        <div class="_body_m3n8j_63">
          <header class="woo-box-flex">
            <div class="woo-box-flex woo-box-column woo-box-justifyCenter _content_wrap_ygi5b_114">
              <a>王汪汪鱼</a><span>2小时前</span><span>4666人关注了她</span>
            </div>
            <button>关注</button>
          </header>
          <div class="wbpro-feed-content">
            <div class="_wbtext_velez_14">我不知道哈尔滨突然怎么了，好像在龙卷风加沙尘暴。</div>
          </div>
        </div>
        <div class="woo-box-flex woo-box-alignCenter _left_198pe_38 _main_198pe_12">
          <div>86</div><div>187</div><div><button>1345</button></div>
        </div>
      </article>
    `;

    attachWeiboClapback({ runtime: { generate } });
    document.querySelector<HTMLButtonElement>(".clapback-trigger")?.click();
    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(generate).toHaveBeenCalled();
    });

    expect(generate.mock.calls[0][0]).toEqual(expect.objectContaining({
      platform: "weibo",
      target: expect.objectContaining({
        text: "我不知道哈尔滨突然怎么了，好像在龙卷风加沙尘暴。",
      }),
      context: expect.objectContaining({
        sourceText: expect.stringContaining("我不知道哈尔滨突然怎么了，好像在龙卷风加沙尘暴。"),
      }),
    }));
    expect(generate.mock.calls[0][0].target.text).not.toContain("4666人关注");
  });

  it("appends the Xiaohongshu trigger as the last item in the native interactions row", () => {
    document.body.innerHTML = `
      <div class="comment-item" id="xhs-1">
        <span class="note-text">小红书评论正文。</span>
        <div class="interactions">
          <div class="like">赞</div>
          <div class="reply icon-container">回复</div>
        </div>
      </div>
    `;

    attachXiaohongshuClapback({ runtime: { generate: vi.fn() } });

    const actionRow = document.querySelector<HTMLElement>(".interactions")!;
    expect([...actionRow.children].map((node) => node.textContent?.trim())).toEqual(["赞", "回复", "嘴替"]);
    expect(actionRow.lastElementChild?.classList.contains("clapback-trigger")).toBe(true);
  });

  it("keeps a single Xiaohongshu row trigger when the content script is injected twice", () => {
    document.body.innerHTML = `
      <div class="comment-item" id="xhs-1">
        <span class="note-text">小红书评论正文。</span>
        <div class="interactions">
          <div class="like">赞</div>
          <div class="reply icon-container">回复</div>
        </div>
      </div>
    `;

    attachXiaohongshuClapback({ runtime: { generate: vi.fn() } });
    attachXiaohongshuClapback({ runtime: { generate: vi.fn() } });

    const actionRow = document.querySelector<HTMLElement>(".interactions")!;
    expect(actionRow.querySelectorAll(".clapback-trigger")).toHaveLength(1);
    expect([...actionRow.children].map((node) => node.textContent?.trim())).toEqual(["赞", "回复", "嘴替"]);
  });

  it("appends the Xiaohongshu trigger to the post engage bar as a post target", () => {
    document.body.innerHTML = `
      <div id="noteContainer">
        <section class="note-content">
          <h1 class="title">大三不自量力尝试投稿 ICML</h1>
          <div id="detail-desc" class="desc">这是帖子正文，不是评论。</div>
        </section>
        <div class="interactions engage-bar">
          <div class="engage-bar-container">
            <div class="interact-container">
              <div class="buttons engage-bar-style">
                <div class="left">
                  <span class="like-wrapper">173</span>
                  <span class="collect-wrapper">收藏</span>
                  <span class="chat-wrapper">评论</span>
                </div>
                <div class="share-wrapper">分享</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const session = attachXiaohongshuClapback({ runtime: { generate: vi.fn() } });

    const actionRow = document.querySelector<HTMLElement>(".buttons.engage-bar-style")!;
    expect(session.targets).toHaveLength(1);
    expect(session.targets[0].target.text).toContain("大三不自量力尝试投稿 ICML");
    expect(actionRow.lastElementChild?.textContent?.trim()).toBe("嘴替");
    expect(actionRow.lastElementChild?.classList.contains("clapback-trigger")).toBe(true);
  });

  it("locks Xiaohongshu detail post content without login-modal title text", async () => {
    const generate = vi.fn().mockResolvedValue({ candidates: ["候选一", "候选二", "候选三"] });
    document.body.innerHTML = `
      <div class="login-modal">
        <div class="title">手机号登录</div>
        <span class="desc">刷到更懂你的优质内容</span>
      </div>
      <div class="note-container" data-note-id="xhs-note-1">
        <section class="note-content">
          <div id="detail-title" class="title">大三不自量力尝试投稿ICML</div>
          <div id="detail-desc" class="desc">
            <span class="note-text">哎哎，意料之中，说多了都是借口，基础不扎实。</span>
          </div>
        </section>
        <div class="comments-container">
          <div class="parent-comment">
            <div id="comment-1" class="comment-item">
              <span class="note-text">paper就是这样，第一次难免会感到遗憾。</span>
              <div class="interactions"><span>10+</span><span>回复</span></div>
            </div>
          </div>
        </div>
        <div class="interactions engage-bar">
          <div class="engage-bar-container">
            <div class="engage-bar">
              <div class="interact-container">
                <div class="buttons engage-bar-style">
                  <div class="left"><span>173</span><span>82</span><span>51</span></div>
                  <div class="share-wrapper">分享</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const session = attachXiaohongshuClapback({ runtime: { generate } });

    expect(session.targets[0].node.classList.contains("note-container")).toBe(true);
    expect(session.targets[0].target.text).toBe(
      "大三不自量力尝试投稿ICML 哎哎，意料之中，说多了都是借口，基础不扎实。",
    );
    expect(session.targets[0].target.text).not.toContain("手机号登录");

    document.querySelector<HTMLButtonElement>(".buttons.engage-bar-style .clapback-trigger")?.click();
    expect(document.querySelector<HTMLElement>(".clapback-panel")?.style.maxHeight).toBe("calc(100vh - 120px)");
    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    await vi.waitFor(() => {
      expect(generate).toHaveBeenCalled();
    });

    expect(generate.mock.calls[0][0]).toEqual(expect.objectContaining({
      platform: "xiaohongshu",
      target: expect.objectContaining({
        text: "大三不自量力尝试投稿ICML 哎哎，意料之中，说多了都是借口，基础不扎实。",
      }),
      context: expect.objectContaining({
        sourceText: "大三不自量力尝试投稿ICML 哎哎，意料之中，说多了都是借口，基础不扎实。",
      }),
    }));
  });

  it("keeps comment triggers compact while preserving the larger global trigger", () => {
    document.body.innerHTML = `
      <div class="CommentItem" data-za-detail-view-id="zhihu-1">
        <div class="CommentItem-content">知乎评论正文。</div>
        <div class="CommentItem-footer"><button>回复</button></div>
      </div>
    `;
    vi.stubGlobal("fetch", vi.fn());

    attachZhihuClapback({ runtime: { generate: vi.fn() } });
    injectGlobalTrigger();

    const styleText = [
      ...document.querySelectorAll<HTMLStyleElement>("#clapback-content-style, #clapback-global-style"),
    ].map((style) => style.textContent ?? "").join("\n");

    expect(styleText).toMatch(/\.clapback-trigger\s*{[^}]*min-height:\s*0;/s);
    expect(styleText).toMatch(/\.clapback-trigger\s*{[^}]*background:\s*transparent;/s);
    expect(styleText).toMatch(/\.clapback-trigger\s*{[^}]*color:\s*var\(--clapback-seal-red\);/s);
    expect(styleText).toMatch(/\.clapback-trigger--zhihu\s*{[^}]*margin-left:\s*16px;/s);
    expect(styleText).toMatch(/\.clapback-trigger--zhihu\s*{[^}]*line-height:\s*1;/s);
    expect(styleText).toMatch(/\.clapback-trigger--zhihu\s*{[^}]*transform:\s*translateY\(-1px\);/s);
    expect(styleText).toMatch(/\.clapback-trigger--global\s*{[^}]*position:\s*fixed;/s);
    expect(styleText).toMatch(/\.clapback-trigger--global\s*{[^}]*width:\s*52px;/s);
    expect(styleText).toMatch(/\.clapback-trigger--global\s*{[^}]*background:\s*var\(--clapback-seal-red\);/s);
  });

  it("opens the global panel with skill, length, and multi-select ammo controls", async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === "skills:list") {
        return {
          ok: true,
          data: [
            { id: "skill_creator", name: "Skill Creator" },
            { id: "full_fire", name: "Full Fire" },
          ],
        };
      }
      if (message.type === "ammo:listBoxes") {
        return { ok: true, data: [{ id: 7, name: "法律常识" }, { id: 9, name: "热梗" }] };
      }
      throw new Error(`unexpected message: ${message.type}`);
    });
    vi.stubGlobal(
      "chrome",
      { runtime: { sendMessage } },
    );

    injectGlobalTrigger({ settings: { activeSkillId: "default_high_fire", lengthMode: "短", ammoBoxIds: [7] } });

    document.querySelector<HTMLButtonElement>(".clapback-trigger--global")?.click();

    const panel = document.querySelector<HTMLElement>(".clapback-global-panel")!;
    await vi.waitFor(() => {
      expect(panel.querySelector<HTMLSelectElement>(".clapback-skill-select")?.value).toBe("full_fire");
      expect(panel.querySelector<HTMLSelectElement>(".clapback-length-select")?.value).toBe("短");
      expect(panel.querySelector<HTMLSelectElement>(".clapback-ammo-select")?.hidden).toBe(true);
      expect([...panel.querySelectorAll<HTMLInputElement>(".clapback-ammo-checkbox:checked")].map((item) => item.value)).toEqual(["7"]);
    });
    expect(panel).not.toBeNull();
    expect(panel.classList.contains("clapback-panel--compact")).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(
      { type: "skills:list", payload: undefined },
      expect.any(Function),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      { type: "ammo:listBoxes", payload: undefined },
      expect.any(Function),
    );
    const ammoChecks = panel.querySelectorAll<HTMLInputElement>(".clapback-ammo-checkbox");
    expect([...ammoChecks].map((option) => option.value)).toEqual(["7", "9"]);
    ammoChecks[1].click();
    expect([...panel.querySelectorAll<HTMLInputElement>(".clapback-ammo-checkbox:checked")].map((item) => item.value)).toEqual(["7", "9"]);
    expect(panel.textContent).not.toContain("技能：");
  });

  it("double-clicking a Zhihu candidate opens the reply editor and fills the candidate", async () => {
    const generate = vi.fn().mockResolvedValue({ candidates: ["先把证据摆出来。", "别跳结论。", "前提呢？"] });
    document.body.innerHTML = `
      <div class="CommentItem" data-za-detail-view-id="zhihu-1">
        <div class="CommentItem-content">你就是不懂装懂。</div>
        <div class="CommentItem-footer">
          <button class="reply">回复</button>
          <button class="like">喜欢</button>
        </div>
      </div>
    `;
    const reply = document.querySelector<HTMLButtonElement>(".reply")!;
    reply.addEventListener("click", () => {
      const editor = document.createElement("textarea");
      editor.className = "reply-editor";
      document.querySelector(".CommentItem")?.append(editor);
    });

    attachZhihuClapback({ runtime: { generate } });
    document.querySelector<HTMLButtonElement>(".clapback-trigger")?.click();
    document.querySelector<HTMLButtonElement>(".clapback-generate")?.click();

    const firstCandidate = await vi.waitFor(() => {
      const candidate = document.querySelector<HTMLButtonElement>(".clapback-candidate");
      expect(candidate).not.toBeNull();
      return candidate!;
    });
    firstCandidate.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLTextAreaElement>(".reply-editor")?.value).toBe("先把证据摆出来。");
    });
  });
});
