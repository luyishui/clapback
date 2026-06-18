import { attachZhihuClapback } from "./zhihuAdapter";
import { attachWeiboClapback } from "./weiboAdapter";
import { attachXiaohongshuClapback } from "./xiaohongshuAdapter";
import { injectGlobalTrigger } from "./globalTrigger";
import { attachCollectionToolbar } from "./collectionToolbar";

type ContentBootstrapDeps = {
  host: string;
  attachZhihuClapback: typeof attachZhihuClapback;
  attachWeiboClapback: typeof attachWeiboClapback;
  attachXiaohongshuClapback: typeof attachXiaohongshuClapback;
  injectGlobalTrigger: typeof injectGlobalTrigger;
  attachCollectionToolbar: typeof attachCollectionToolbar;
};

export function initializeContent(deps: ContentBootstrapDeps = {
  host: location.hostname,
  attachZhihuClapback,
  attachWeiboClapback,
  attachXiaohongshuClapback,
  injectGlobalTrigger,
  attachCollectionToolbar,
}): void {
  if (deps.host.includes("zhihu")) {
    deps.attachZhihuClapback();
  } else if (deps.host.includes("weibo")) {
    deps.attachWeiboClapback();
  } else if (deps.host.includes("xiaohongshu")) {
    deps.attachXiaohongshuClapback();
  }

  deps.injectGlobalTrigger();
  void deps.attachCollectionToolbar().catch(() => {
    // Collection mode is optional; normal reply generation should still load if the background is waking up.
  });
}

initializeContent();
