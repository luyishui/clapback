import type { CollectionCandidate, CollectionPlatform } from "../api/types";

type CandidateDraft = Omit<CollectionCandidate, "platform">;

const MIN_TEXT_LENGTH = 8;

export function detectCollectionPlatform(hostname = location.hostname): CollectionPlatform {
  if (hostname.includes("weibo")) return "weibo";
  if (hostname.includes("xiaohongshu")) return "xiaohongshu";
  return "zhihu";
}

export function collectCandidates(root: ParentNode = document, platform = detectCollectionPlatform()): CollectionCandidate[] {
  const drafts = platform === "weibo"
    ? collectWeibo(root)
    : platform === "xiaohongshu"
      ? collectXiaohongshu(root)
      : collectZhihu(root);

  return dedupeCandidates(drafts
    .map((item) => normalizeCandidate(platform, item))
    .filter((item): item is CollectionCandidate => item !== null));
}

function collectZhihu(root: ParentNode): CandidateDraft[] {
  const nodes = [
    ...root.querySelectorAll<HTMLElement>(".AnswerItem, .ArticleItem, .ContentItem, article"),
  ].filter((node) => !node.closest(".CommentItem, .CommentItemV2, .Comments-container, .clapback-panel, .clapback-collection-toolbar"))
    .filter(isZhihuOwnWork);

  return nodes.map((node, index) => {
    const title = firstText(node, [".QuestionHeader-title", ".ContentItem-title", ".Post-Title", "h1", "h2"]);
    const body = firstText(node, [".RichContent-inner", ".RichText", ".ArticleItem-content", "[class*='content']"]) || compactText(node.textContent || "");
    const text = joinText(title, body);
    const articleUrl = node.querySelector<HTMLAnchorElement>("a[href*='zhuanlan.zhihu.com'], a[href*='/p/']")?.href;
    const kind = node.matches(".ArticleItem") || articleUrl ? "article" : node.matches(".AnswerItem") ? "answer" : "unknown";
    return {
      kind,
      text,
      title: title || undefined,
      sourceId: node.dataset.zaDetailViewId || node.getAttribute("data-id") || undefined,
      url: articleUrl || currentUrl(),
    };
  });
}

function collectWeibo(root: ParentNode): CandidateDraft[] {
  const nodes = [
    ...root.querySelectorAll<HTMLElement>(
      ".card.m-panel.card9.f-weibo, .card9.f-weibo, article.weibo-main, .card-wrap[mid], article[mid], article[class*='woo-panel'], .WB_feed_detail",
    ),
  ].filter((node) => !node.closest(".clapback-panel, .clapback-collection-toolbar"))
    .filter((node) => !isRedundantWeiboContainer(node))
    .filter((node, index, all) => !all.some((other) => other !== node && other.contains(node)))
    .filter((node) => Boolean(extractWeiboPostText(node)) && !isBlockedWeiboContainer(node));

  return nodes.map((node, index) => {
    const text = extractWeiboPostText(node);
    const link = node.querySelector<HTMLAnchorElement>("a[href*='/status/'], a[href*='/detail/'], a[href*='weibo.com/'][href*='/R']")?.href;
    const sourceId = stableWeiboSourceId(node) || sourceIdFromUrl(link);
    return {
      kind: "post",
      text,
      sourceId: sourceId || undefined,
      url: link || currentUrl(),
    };
  });
}

function collectXiaohongshu(root: ParentNode): CandidateDraft[] {
  const drafts: CandidateDraft[] = [];
  const note = root.querySelector<HTMLElement>("#noteContainer, .note-container, [class*='note-detail']");
  if (note) {
    const commentSelector = ".comment-item, .parent-comment, .sub-comment, .comments-container, [class*='commentItem'], [class*='CommentItem']";
    const title = firstTextOutside(note, ["#detail-title", ".note-content .title", "[class*='title']", "h1"], commentSelector);
    const body = firstTextOutside(note, [
      "#detail-desc",
      ".note-content .desc",
      ".note-content .note-text",
      ".note-text",
      "[class*='desc']",
    ], commentSelector);
    drafts.push({
      kind: "note",
      text: joinText(title, body),
      title: title || undefined,
      sourceId: note.getAttribute("data-note-id") || undefined,
      url: currentUrl(),
    });
  }

  if (drafts.length === 0) {
    const profileNotes = [
      ...root.querySelectorAll<HTMLElement>("section.note-item, .note-item"),
    ].filter((node) => !node.closest(".clapback-panel, .clapback-collection-toolbar"));

    profileNotes.forEach((node) => {
      const title = firstText(node, [".title", "[class*='title']"]) || fallbackXiaohongshuCardText(node);
      if (!title || isXiaohongshuNonContent(title)) return;
      const link = node.querySelector<HTMLAnchorElement>("a[href*='/explore/'], a[href*='/user/profile/']")?.href;
      drafts.push({
        kind: "note",
        text: title,
        title,
        sourceId: sourceIdFromXiaohongshuLink(link),
        url: link || currentUrl(),
      });
    });
  }

  return drafts;
}

function isZhihuOwnWork(node: HTMLElement): boolean {
  if (isZhihuForeignProfileWork(node)) return false;
  const status = zhihuActivityStatus(node);
  const leadingText = compactText(`${status} ${node.textContent || ""}`).slice(0, 120);
  if (/关注了|赞同了|收藏了|喜欢了|关注问题|关注专栏|关注的圆桌|圆桌/.test(leadingText)) return false;
  if (node.matches(".AnswerItem, .ArticleItem")) return true;
  if (node.querySelector("a[href*='zhuanlan.zhihu.com'], a[href*='/p/']")) return true;
  if (/回答了问题|发表了文章|发布了文章|写了文章/.test(leadingText)) return true;
  return false;
}

function zhihuActivityStatus(node: HTMLElement): string {
  const listItem = node.closest<HTMLElement>(".List-item");
  const root = listItem || node;
  return firstText(root, [
    ".ActivityItem-meta",
    ".ContentItem-status",
    ".List-itemMeta",
    "[class*='ActivityItem']",
  ]);
}

function isZhihuForeignProfileWork(node: HTMLElement): boolean {
  if (!node.closest("#Profile-activities, .ProfileActivities")) return false;
  const profileName = zhihuProfileName(node);
  const authorName = zhihuAuthorName(node);
  return Boolean(profileName && authorName && comparableName(profileName) !== comparableName(authorName));
}

function zhihuProfileName(node: HTMLElement): string {
  return firstText(node.ownerDocument, [
    ".ProfileHeader-name",
    ".ProfileHeader-contentHead .UserLink-link",
    "[class*='ProfileHeader'] [class*='name']",
  ]);
}

function zhihuAuthorName(node: HTMLElement): string {
  const raw = node.getAttribute("data-zop");
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { authorName?: unknown };
    return typeof parsed.authorName === "string" ? parsed.authorName : "";
  } catch {
    return "";
  }
}

function comparableName(value: string): string {
  return compactText(value).replace(/\s+/g, "").toLowerCase();
}

function extractWeiboPostText(node: HTMLElement): string {
  const body = queryBySelectorPriority(node, [
    ".weibo-text",
    ".wbpro-feed-content",
    ".WB_text",
    "[class*='_wbtext_']",
  ]);
  if (!body) return "";
  const clone = body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, svg, img, video, footer, [class*='toolbar'], [class*='action']").forEach((item) => item.remove());
  return compactText(clone.textContent || "");
}

function isBlockedWeiboContainer(node: HTMLElement): boolean {
  const text = compactText(node.textContent || "");
  const body = extractWeiboPostText(node);
  const combined = compactText(`${text} ${body}`);
  if (/请登录后使用|前方有点拥堵|登录后查看更多/.test(combined)) return true;
  return /^推荐关注/.test(body) || /推荐关注.*(换一换|查看更多|全部关注)/.test(text);
}

function queryBySelectorPriority(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const node = root.querySelector<HTMLElement>(selector);
    if (node && compactText(node.textContent || "")) return node;
  }
  return null;
}

function sourceIdFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return url.match(/\/(?:status|detail)\/([^/?#]+)/)?.[1]
    ?? url.match(/weibo\.com\/\d+\/([^/?#]+)/)?.[1]
    ?? undefined;
}

function stableWeiboSourceId(node: HTMLElement): string | undefined {
  return node.getAttribute("mid")
    || node.closest<HTMLElement>(".card9[mid]")?.getAttribute("mid")
    || undefined;
}

function sourceIdFromXiaohongshuLink(url?: string): string | undefined {
  if (!url) return undefined;
  return url.match(/\/explore\/([^/?#]+)/)?.[1]
    ?? url.match(/\/user\/profile\/[^/?#]+\/([^/?#]+)/)?.[1]
    ?? undefined;
}

function isXiaohongshuNonContent(text: string): boolean {
  return /登录|推荐|搜索|举报/.test(text);
}

function fallbackXiaohongshuCardText(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".author-wrapper, [class*='author-wrapper'], .cover, img, svg, button").forEach((item) => item.remove());
  return compactText(clone.textContent || "").replace(/^置顶/, "");
}

function isRedundantWeiboContainer(node: HTMLElement): boolean {
  if (!node.matches(".card-wrap[mid], .card9.f-weibo")) return false;
  const nestedPosts = [
    ...node.querySelectorAll<HTMLElement>("article.weibo-main, article[mid], article[class*='woo-panel'], .WB_feed_detail"),
  ].filter((candidate) => candidate !== node && Boolean(extractWeiboPostText(candidate)));
  return nestedPosts.length > 0;
}

function normalizeCandidate(platform: CollectionPlatform, item: CandidateDraft): CollectionCandidate | null {
  const text = compactText(item.text);
  if (text.length < minimumTextLength(platform, item.kind)) return null;
  return {
    platform,
    kind: item.kind,
    text: text.slice(0, 4000),
    title: item.title ? compactText(item.title) : undefined,
    url: item.url,
    sourceId: item.sourceId,
    publishedAt: item.publishedAt,
  };
}

function minimumTextLength(platform: CollectionPlatform, kind: CollectionCandidate["kind"]): number {
  if (platform === "xiaohongshu" && kind === "note") return 4;
  return MIN_TEXT_LENGTH;
}

function dedupeCandidates(items: CollectionCandidate[]): CollectionCandidate[] {
  const seen = new Set<string>();
  const result: CollectionCandidate[] = [];
  for (const item of items) {
    const key = item.sourceId || compactText(`${item.platform}:${item.kind}:${item.text}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function firstText(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const node = root.querySelector<HTMLElement>(selector);
    const text = compactText(node?.textContent || "");
    if (text) return text;
  }
  return "";
}

function firstTextOutside(root: ParentNode, selectors: string[], excludedSelector: string): string {
  for (const selector of selectors) {
    const node = [...root.querySelectorAll<HTMLElement>(selector)]
      .find((candidate) => !candidate.closest(excludedSelector));
    const text = compactText(node?.textContent || "");
    if (text) return text;
  }
  return "";
}

function joinText(...parts: string[]): string {
  return compactText(parts.filter(Boolean).join(" "));
}

function compactText(value: string): string {
  return value.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

function currentUrl(): string {
  try {
    return location.href;
  } catch {
    return "";
  }
}
