import { attachZhihuClapback } from "./zhihuAdapter";
import { attachWeiboClapback } from "./weiboAdapter";
import { attachXiaohongshuClapback } from "./xiaohongshuAdapter";
import { attachBilibiliClapback } from "./bilibiliAdapter";
import { attachXiaoheiheClapback } from "./xiaoheiheAdapter";
import { attachTiebaClapback } from "./tiebaAdapter";
import { injectGlobalTrigger } from "./globalTrigger";
import { attachCollectionToolbar } from "./collectionToolbar";

type ContentBootstrapDeps = {
  host: string;
  attachZhihuClapback: typeof attachZhihuClapback;
  attachWeiboClapback: typeof attachWeiboClapback;
  attachXiaohongshuClapback: typeof attachXiaohongshuClapback;
  attachBilibiliClapback: typeof attachBilibiliClapback;
  attachXiaoheiheClapback: typeof attachXiaoheiheClapback;
  attachTiebaClapback: typeof attachTiebaClapback;
  injectGlobalTrigger: typeof injectGlobalTrigger;
  attachCollectionToolbar: typeof attachCollectionToolbar;
};

export function initializeContent(deps: ContentBootstrapDeps = {
  host: location.hostname,
  attachZhihuClapback,
  attachWeiboClapback,
  attachXiaohongshuClapback,
  attachBilibiliClapback,
  attachXiaoheiheClapback,
  attachTiebaClapback,
  injectGlobalTrigger,
  attachCollectionToolbar,
}): void {
  if (deps.host.includes("zhihu")) {
    deps.attachZhihuClapback();
  } else if (deps.host.includes("weibo")) {
    deps.attachWeiboClapback();
  } else if (deps.host.includes("xiaohongshu")) {
    deps.attachXiaohongshuClapback();
  } else if (deps.host.includes("bilibili")) {
    deps.attachBilibiliClapback();
  } else if (deps.host.includes("xiaoheihe")) {
    deps.attachXiaoheiheClapback();
  } else if (deps.host.includes("tieba.baidu")) {
    deps.attachTiebaClapback();
  }

  deps.injectGlobalTrigger();
  void deps.attachCollectionToolbar().catch(() => {
    // Collection mode is optional; normal reply generation should still load if the background is waking up.
  });
}

initializeContent();
