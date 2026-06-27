import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectCandidates, detectCollectionPlatform } from "./collectionAdapters";

function loadDomFixture(name: string): string {
  return readFileSync(resolve(process.cwd(), "../../references/dom html", name), "utf8");
}

describe("creator collection DOM adapters", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("extracts Zhihu answers and articles from the currently loaded DOM", () => {
    document.body.innerHTML = `
      <main>
        <article class="AnswerItem" data-za-detail-view-id="answer-1">
          <h2 class="ContentItem-title">为什么法律不能按闹分配？</h2>
          <div class="RichContent-inner">法律不是按谁声音大来分配的，程序才是底线。</div>
        </article>
        <article class="ArticleItem" id="article-1">
          <a href="https://zhuanlan.zhihu.com/p/123">专栏文章</a>
          <div class="RichContent-inner">这篇文章讲清楚了公共讨论里的证据责任。</div>
        </article>
      </main>
    `;

    const items = collectCandidates(document, "zhihu");

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(expect.objectContaining({
      platform: "zhihu",
      kind: "answer",
      sourceId: "answer-1",
      title: "为什么法律不能按闹分配？",
      text: expect.stringContaining("法律不是按谁声音大"),
    }));
    expect(items[1]).toEqual(expect.objectContaining({ kind: "article" }));
    expect(items[1]?.sourceId).toBeUndefined();
  });

  it("extracts Weibo posts from loaded feed cards", () => {
    document.body.innerHTML = `
      <main>
        <article mid="weibo-1">
          <div class="wbpro-feed-content">今天这件事最离谱的是，大家把情绪当证据。</div>
        </article>
      </main>
    `;

    const items = collectCandidates(document, "weibo");

    expect(items).toEqual([
      expect.objectContaining({
        platform: "weibo",
        kind: "post",
        sourceId: "weibo-1",
        text: "今天这件事最离谱的是，大家把情绪当证据。",
      }),
    ]);
  });

  it("extracts current mobile Weibo card9 posts instead of returning an empty basket", () => {
    document.body.innerHTML = `
      <main>
        <div class="card m-panel card9 f-weibo" mid="mobile-1">
          <article class="weibo-main">
            <header>人民日报 2小时前</header>
            <div class="weibo-text">1942年，东京街头的这张照片，记录了一个被战争吞没的普通瞬间。</div>
            <footer class="f-footer-ctrl">
              <a>转发 12</a><a>评论 3</a><a>赞 8</a>
            </footer>
          </article>
        </div>
      </main>
    `;

    const items = collectCandidates(document, "weibo");

    expect(items).toEqual([
      expect.objectContaining({
        platform: "weibo",
        kind: "post",
        sourceId: "mobile-1",
        text: "1942年，东京街头的这张照片，记录了一个被战争吞没的普通瞬间。",
      }),
    ]);
  });

  it("extracts posts from real Weibo creator profile fixtures", () => {
    document.documentElement.innerHTML = loadDomFixture("@卢麒元 的个人主页.htm");

    const items = collectCandidates(document, "weibo");

    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items[0]).toEqual(expect.objectContaining({
      platform: "weibo",
      kind: "post",
      text: expect.stringContaining("三十年前"),
    }));
    expect(items.map((item) => item.text).join("\n")).not.toContain("全部关注");
    expect(items.map((item) => item.text).join("\n")).not.toContain("精选微博视频相册文章");
  });

  it("does not generate positional source ids for Weibo posts without stable mid", () => {
    document.body.innerHTML = `
      <main>
        <article class="WB_feed_detail">
          <div class="wbpro-feed-content">没有 mid 的微博卡片应该用正文和 URL 去重。</div>
        </article>
      </main>
    `;

    const items = collectCandidates(document, "weibo");

    expect(items).toHaveLength(1);
    expect(items[0]?.sourceId).toBeUndefined();
  });

  it("keeps multiple Weibo posts when a generic mid wrapper contains several articles", () => {
    document.body.innerHTML = `
      <main>
      <div class="card-wrap" mid="outer-wrapper">
        <article class="woo-panel-main _wrap_m3n8j_2">
          <div class="wbpro-feed-content">第一条微博正文，不能被外层 mid 容器吞掉。</div>
        </article>
        <article class="woo-panel-main _wrap_m3n8j_2">
          <div class="wbpro-feed-content">第二条微博正文，也应该进入采风篮。</div>
        </article>
      </div>
      </main>
    `;

    const items = collectCandidates(document, "weibo");

    expect(items.map((item) => item.text)).toEqual([
      "第一条微博正文，不能被外层 mid 容器吞掉。",
      "第二条微博正文，也应该进入采风篮。",
    ]);
    expect(items.every((item) => item.sourceId !== "outer-wrapper")).toBe(true);
  });

  it("filters Weibo recommendation and login panels even when they reuse post text classes", () => {
    document.body.innerHTML = `
      <main>
        <article mid="recommendation-1">
          <header>推荐关注</header>
          <div class="wbpro-feed-content">推荐关注科技博主，发现更多热门内容。</div>
        </article>
        <div class="card m-panel card9 f-weibo" mid="login-wall-1">
          <article class="weibo-main">
            <div class="weibo-text">登录后查看更多微博内容</div>
          </article>
        </div>
        <article mid="real-1">
          <div class="wbpro-feed-content">这是一条正常的创作者微博正文，应该留在采风篮。</div>
        </article>
      </main>
    `;

    const items = collectCandidates(document, "weibo");

    expect(items).toEqual([
      expect.objectContaining({
        platform: "weibo",
        kind: "post",
        sourceId: "real-1",
        text: "这是一条正常的创作者微博正文，应该留在采风篮。",
      }),
    ]);
  });

  it("keeps real Weibo posts when a surrounding label mentions recommendations", () => {
    document.body.innerHTML = `
      <main>
        <article mid="real-recommendation-word">
          <header>推荐关注</header>
          <div class="wbpro-feed-content">今天的行业观察是，平台越想推荐账号，创作者越要把正文边界写清楚。</div>
        </article>
      </main>
    `;

    const items = collectCandidates(document, "weibo");

    expect(items).toEqual([
      expect.objectContaining({
        sourceId: "real-recommendation-word",
        text: "今天的行业观察是，平台越想推荐账号，创作者越要把正文边界写清楚。",
      }),
    ]);
  });

  it("extracts Xiaohongshu notes from loaded note detail pages without collecting comments", () => {
    document.body.innerHTML = `
      <main id="noteContainer" data-note-id="note-1">
        <h1 id="detail-title">表达欲不是攻击性</h1>
        <div id="detail-desc">真正好的表达，是把边界说清楚。</div>
        <div class="comment-item" data-id="comment-1">
          <span class="comment-text">前十个字也要能辨认出来。</span>
        </div>
      </main>
    `;

    const items = collectCandidates(document, "xiaohongshu");

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({
      platform: "xiaohongshu",
      kind: "note",
      sourceId: "note-1",
      title: "表达欲不是攻击性",
      text: expect.stringContaining("真正好的表达"),
    }));
    expect(items.map((item) => item.text).join("\n")).not.toContain("前十个字");
  });

  it("does not fall back to Xiaohongshu comment text when note body selectors are absent", () => {
    document.body.innerHTML = `
      <main id="noteContainer" data-note-id="note-2">
        <h1 id="detail-title">短标题也可以是作者作品</h1>
        <div class="comments-container">
          <div class="comment-item" data-id="comment-2">
            <span class="note-text">这是一条评论，不应该被当成笔记正文采进去。</span>
          </div>
        </div>
      </main>
    `;

    const items = collectCandidates(document, "xiaohongshu");

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({
      kind: "note",
      text: "短标题也可以是作者作品",
    }));
    expect(items[0]?.text).not.toContain("这是一条评论");
  });

  it("does not use Xiaohongshu comment title text as a note title fallback", () => {
    document.body.innerHTML = `
      <main id="noteContainer" data-note-id="note-3">
        <section class="comments-container">
          <div class="comment-item">
            <span class="title">评论里的标题样式</span>
            <span class="note-text">评论里的正文也不应该被当作笔记。</span>
          </div>
        </section>
      </main>
    `;

    expect(collectCandidates(document, "xiaohongshu")).toEqual([]);
  });

  it("extracts author-owned notes from all Xiaohongshu creator profile fixtures", () => {
    const fixtures = [
      { name: "小雨点儿 - 小红书.htm", firstTitle: "就这样水灵灵拿到AL和希然的合影签名 五一继续逮捕" },
      { name: "赢在中高考 - 小红书.htm", firstTitle: "山东省高考第一次发布会消息" },
      { name: "超吉AI - 小红书.htm", firstTitle: "马斯克败诉后首谈，句句都在科幻片里" },
    ];

    for (const fixture of fixtures) {
      document.documentElement.innerHTML = loadDomFixture(fixture.name);

      const items = collectCandidates(document, "xiaohongshu");

      expect(items.length, fixture.name).toBeGreaterThanOrEqual(30);
      expect(items[0], fixture.name).toEqual(expect.objectContaining({
        platform: "xiaohongshu",
        kind: "note",
        title: fixture.firstTitle,
        text: fixture.firstTitle,
      }));
      expect(items.every((item) => item.kind === "note"), fixture.name).toBe(true);
      expect(items.map((item) => item.text).join("\n"), fixture.name).not.toContain("登录后推荐更懂你的笔记");
    }
  });

  it("filters Zhihu profile activity cards that are not author works", () => {
    document.body.innerHTML = `
      <main>
        <div class="ContentItem ActivityItem">
          <div class="ActivityItem-meta">关注了圆桌</div>
          <h2 class="ContentItem-title">游戏回忆故事会 · 第一季</h2>
          <div class="RichContent-inner">这不是作者自己的回答或文章。</div>
        </div>
        <div class="ContentItem AnswerItem" data-za-detail-view-id="answer-owned">
          <div class="ActivityItem-meta">回答了问题</div>
          <h2 class="ContentItem-title">如何看待创作者主页采风？</h2>
          <div class="RichContent-inner">只应该采集作者自己的回答正文，不应该采集关注动态。</div>
        </div>
        <div class="ContentItem ArticleItem" data-za-detail-view-id="article-owned">
          <div class="ActivityItem-meta">发表了文章</div>
          <a href="https://zhuanlan.zhihu.com/p/987">作者文章</a>
          <div class="RichContent-inner">这是一篇作者发布的专栏文章。</div>
        </div>
      </main>
    `;

    const items = collectCandidates(document, "zhihu");

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.sourceId)).toEqual(["answer-owned", "article-owned"]);
    expect(items.map((item) => item.text).join("\n")).not.toContain("游戏回忆故事会");
  });

  it("filters Zhihu profile answers by author when activity status is missing", () => {
    document.body.innerHTML = `
      <header class="ProfileHeader">
        <div class="ProfileHeader-name">JekyllHyde</div>
      </header>
      <main id="Profile-activities" class="ProfileActivities">
        <div class="List-item">
          <div>
            <div class="ContentItem AnswerItem" data-zop='{"authorName":"测试作者甲","itemId":"test-answer-0001","title":"测试用回答标题一","type":"answer"}'>
              <h2 class="ContentItem-title">测试用回答标题一</h2>
              <div class="RichContent-inner">这是他人回答，即使活动状态缺失也不应进入采风篮。</div>
            </div>
          </div>
        </div>
        <div class="List-item">
          <div>
            <div class="ContentItem AnswerItem" data-za-detail-view-id="answer-owned" data-zop='{"authorName":"JekyllHyde","itemId":"owned","title":"如何验证创作者采风？","type":"answer"}'>
              <h2 class="ContentItem-title">如何验证创作者采风？</h2>
              <div class="RichContent-inner">作者自己的回答即使状态缺失，也应该保留。</div>
            </div>
          </div>
        </div>
      </main>
    `;

    const items = collectCandidates(document, "zhihu");

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({
      sourceId: "answer-owned",
      text: expect.stringContaining("作者自己的回答"),
    }));
    expect(items.map((item) => item.text).join("\n")).not.toContain("测试用回答标题一");
  });

  it("filters Zhihu liked answers when the activity status lives on the outer list item", () => {
    document.body.innerHTML = `
      <main>
        <div class="List-item">
          <div class="List-itemMeta">
            <div class="ActivityItem-meta">
              <span class="ActivityItem-metaTitle">赞同了回答</span>
              <span>2026-06-04 12:35</span>
            </div>
          </div>
          <div>
            <div class="ContentItem AnswerItem" data-zop='{"authorName":"测试作者甲","itemId":"test-answer-0001","title":"测试用回答标题一","type":"answer"}'>
              <h2 class="ContentItem-title">测试用回答标题一</h2>
              <div class="RichContent-inner">这是被主页主人赞同的他人回答，不应该进入采风篮。</div>
            </div>
          </div>
        </div>
        <div class="List-item">
          <div class="List-itemMeta">
            <div class="ActivityItem-meta">
              <span class="ActivityItem-metaTitle">发表了文章</span>
            </div>
          </div>
          <div>
            <div class="ContentItem ArticleItem" data-za-detail-view-id="article-owned">
              <a href="https://zhuanlan.zhihu.com/p/test-article-1">测试用文章标题一</a>
              <div class="RichContent-inner">这是作者自己的置顶文章。</div>
            </div>
          </div>
        </div>
      </main>
    `;

    const items = collectCandidates(document, "zhihu");

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({
      kind: "article",
      sourceId: "article-owned",
      text: expect.stringContaining("作者自己的置顶文章"),
    }));
    expect(items.map((item) => item.text).join("\n")).not.toContain("测试用回答标题一");
  });

  it("does not use generic Xiaohongshu container ids as source ids", () => {
    document.body.innerHTML = `
      <main id="noteContainer">
        <h1 id="detail-title">没有平台 note id 的详情页</h1>
        <div id="detail-desc">这时应该让后台用 URL 和正文去重。</div>
      </main>
    `;

    const items = collectCandidates(document, "xiaohongshu");

    expect(items[0]?.sourceId).toBeUndefined();
  });

  it("returns an empty array when the page has no recognizable creator content", () => {
    document.body.innerHTML = `<main><nav>首页 推荐 登录</nav></main>`;

    expect(collectCandidates(document, "zhihu")).toEqual([]);
  });

  it("detects platform from hostname", () => {
    expect(detectCollectionPlatform("www.zhihu.com")).toBe("zhihu");
    expect(detectCollectionPlatform("weibo.com")).toBe("weibo");
    expect(detectCollectionPlatform("www.xiaohongshu.com")).toBe("xiaohongshu");
    expect(detectCollectionPlatform("example.com")).toBe("zhihu");
  });
});
