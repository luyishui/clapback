import { attachZhihuClapback } from "./zhihuAdapter";
import { attachWeiboClapback } from "./weiboAdapter";
import { attachXiaohongshuClapback } from "./xiaohongshuAdapter";
import { injectGlobalTrigger } from "./globalTrigger";
import { attachCollectionToolbar } from "./collectionToolbar";

const host = location.hostname;

if (host.includes("zhihu")) {
  attachZhihuClapback();
} else if (host.includes("weibo")) {
  attachWeiboClapback();
} else if (host.includes("xiaohongshu")) {
  attachXiaohongshuClapback();
}

injectGlobalTrigger();
void attachCollectionToolbar();
