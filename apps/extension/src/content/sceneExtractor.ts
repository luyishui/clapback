export type SceneComment = {
  platform: "zhihu";
  id: string;
  text: string;
  authorName: string;
  authorUrl: string;
};

export type ZhihuScene = {
  platform: "zhihu";
  pageTitle: string;
  comments: SceneComment[];
};

const COMMENT_SELECTOR = "[data-id]";
const COMMENT_TEXT_SELECTOR = ".CommentContent, .CommentItem-content, .RichContent-inner";

export function extractZhihuScene(root: ParentNode): ZhihuScene {
  const comments = [...root.querySelectorAll<HTMLElement>(COMMENT_SELECTOR)]
    .map((node) => extractComment(node))
    .filter((comment): comment is SceneComment => comment !== null);

  return {
    platform: "zhihu",
    pageTitle: compact(root.querySelector("title")?.textContent ?? document.title ?? ""),
    comments,
  };
}

function extractComment(node: HTMLElement): SceneComment | null {
  const text = compact(node.querySelector<HTMLElement>(COMMENT_TEXT_SELECTOR)?.textContent ?? "");
  if (!text) {
    return null;
  }
  const authorLinks = [...node.querySelectorAll<HTMLAnchorElement>("a[href*='/people/']")];
  const author = authorLinks.find((link) => compact(link.textContent ?? "")) ?? authorLinks[0];
  const avatarAlt = authorLinks
    .map((link) => link.querySelector("img")?.getAttribute("alt") ?? "")
    .find((value) => value.trim()) ?? "";
  return {
    platform: "zhihu",
    id: node.dataset.id || node.id || text.slice(0, 24),
    text,
    authorName: compact(author?.textContent ?? avatarAlt),
    authorUrl: author?.href ?? "",
  };
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
