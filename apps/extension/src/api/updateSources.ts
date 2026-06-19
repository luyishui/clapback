/**
 * 多源更新配置（单一可维护入口）。
 *
 * 设计动机：中国大陆直连 GitHub 不稳定，公益镜像域名又会定期失效/更换。
 * 因此把"检查更新源"和"下载镜像源"集中在本文件，未来某个镜像挂了只需改这里。
 *
 * 同步更新 host_permissions：新增镜像时，记得在
 * `apps/extension/public/manifest.json` 的 host_permissions 加上对应域名，
 * 否则后台 fetch 会被拦截。
 */

/** 仓库标识（owner/repo）。 */
export const GITHUB_REPO = "luyishui/clapback";

/** Release 资产文件名模板（占位 {version} 不带 v 前缀）。 */
export const RELEASE_ASSET_NAME = (version: string) => `clapback-extension-v${version}.zip`;

/**
 * 检查更新源。按数组顺序探测，命中第一个成功源即返回。
 * 顺序策略：GitHub API 最权威放首位；jsDelivr（testingcf/gcore）国内可访问作为回退。
 */
export type UpdateCheckSourceKind = "github-api" | "manifest-json";

export type UpdateCheckSource = {
  /** 源标识，用于日志/返回的 source 字段。 */
  id: string;
  /** 请求 URL。 */
  url: string;
  /** 解析方式：github-api 解析 releases/latest JSON；manifest-json 解析 manifest 的 version 字段。 */
  kind: UpdateCheckSourceKind;
};

export const UPDATE_CHECK_SOURCES: readonly UpdateCheckSource[] = [
  {
    id: "github-api",
    url: `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
    kind: "github-api",
  },
  {
    id: "jsdelivr-testingcf",
    url: `https://testingcf.jsdelivr.net/gh/${GITHUB_REPO}@master/apps/extension/public/manifest.json`,
    kind: "manifest-json",
  },
  {
    id: "jsdelivr-gcore",
    url: `https://gcore.jsdelivr.net/gh/${GITHUB_REPO}@master/apps/extension/public/manifest.json`,
    kind: "manifest-json",
  },
];

/**
 * 下载镜像源。检查更新发现新版本后，在设置页并列展示这些链接，
 * 用户自己选一个能用的点（打不开就换另一个）。
 * tag 形如 "v0.2.0"，version 形如 "0.2.0"（不带 v）。
 */
export type DownloadMirror = {
  /** 源标识。 */
  id: string;
  /** 展示名（会过 i18n，见 settings.mirror.* ）。 */
  labelKey: string;
  /** 给定 tag（形如 "v0.2.0"）生成下载 URL。 */
  url: (tag: string) => string;
};

export const DOWNLOAD_MIRRORS: readonly DownloadMirror[] = [
  {
    id: "github",
    labelKey: "settings.mirrorGithub",
    url: (tag) => assetUrl("", tag),
  },
  {
    id: "gh-proxy",
    labelKey: "settings.mirrorGhProxy",
    url: (tag) => assetUrl("https://gh-proxy.com/", tag),
  },
  {
    id: "ghfast",
    labelKey: "settings.mirrorGhfast",
    url: (tag) => assetUrl("https://ghfast.top/", tag),
  },
];

/** 拼装某个 tag 下 Release 资产的下载 URL，可加镜像前缀。 */
function assetUrl(prefix: string, tag: string): string {
  const version = tag.replace(/^v/, "");
  return `${prefix}https://github.com/${GITHUB_REPO}/releases/download/${tag}/${RELEASE_ASSET_NAME(version)}`;
}
