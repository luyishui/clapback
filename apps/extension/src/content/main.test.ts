import { describe, expect, it, vi } from "vitest";
import { initializeContent } from "./main";

describe("content bootstrap", () => {
  it("keeps platform triggers loaded when collection toolbar cannot reach the background", async () => {
    const attachZhihuClapback = vi.fn();
    const injectGlobalTrigger = vi.fn();
    const attachCollectionToolbar = vi.fn().mockRejectedValue(new Error("extension_background_unavailable"));

    initializeContent({
      host: "www.zhihu.com",
      attachZhihuClapback,
      attachWeiboClapback: vi.fn(),
      attachXiaohongshuClapback: vi.fn(),
      attachBilibiliClapback: vi.fn(),
      attachXiaoheiheClapback: vi.fn(),
      attachTiebaClapback: vi.fn(),
      injectGlobalTrigger,
      attachCollectionToolbar,
    });
    await Promise.resolve();

    expect(attachZhihuClapback).toHaveBeenCalledTimes(1);
    expect(injectGlobalTrigger).toHaveBeenCalledTimes(1);
    expect(attachCollectionToolbar).toHaveBeenCalledTimes(1);
  });

  it("boots the matching adapter for newly supported reply platforms", () => {
    const cases = [
      ["www.bilibili.com", "attachBilibiliClapback"],
      ["www.xiaoheihe.cn", "attachXiaoheiheClapback"],
      ["tieba.baidu.com", "attachTiebaClapback"],
    ] as const;

    for (const [host, expected] of cases) {
      const deps = {
        host,
        attachZhihuClapback: vi.fn(),
        attachWeiboClapback: vi.fn(),
        attachXiaohongshuClapback: vi.fn(),
        attachBilibiliClapback: vi.fn(),
        attachXiaoheiheClapback: vi.fn(),
        attachTiebaClapback: vi.fn(),
        injectGlobalTrigger: vi.fn(),
        attachCollectionToolbar: vi.fn().mockResolvedValue(undefined),
      };

      initializeContent(deps);

      expect(deps[expected]).toHaveBeenCalledTimes(1);
      expect(deps.injectGlobalTrigger).toHaveBeenCalledTimes(1);
    }
  });
});
